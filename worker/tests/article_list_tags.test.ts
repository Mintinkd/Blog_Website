import { describe, expect, it } from "vitest";
import { listArticles } from "../src/services/article_service";
import type { Env } from "../src/index";

/**
 * issue #89 / M1：列表 N+1 消除。
 *
 * 接缝：listArticles —— 工单 Key interfaces 点名的列表服务（D1 出口）。
 * 桩记录 prepare 的 SQL 与绑定值，断言：
 *   ① 一次列表请求只发 1 条"取文章 + 标签"查询，不再逐篇 `WHERE at.article_id = ?`；
 *   ② group_concat blob 解析结果与旧实现逐字段一致（空标签 / 多标签 / 特殊字符名 / 稳定顺序）。
 *
 * 期望值全部手写，不从被测函数反推。
 */

interface Recorded {
  sql: string;
  binds: unknown[];
}

interface ArticleRow {
  id: number;
  title: string;
  slug: string;
  summary: string;
  cover_image: string;
  status: string;
  content: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  created_at: string;
  author_id: number | null;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  author_name: string | null;
  tags_blob?: string | null;
}

/**
 * 有状态 D1 桩：count 查询返回 total，列表查询返回给定行，
 * 任何针对单篇的标签查询 `WHERE at.article_id = ?` 都会落到一个会 fail 的分支（返回空）。
 */
function makeListDb(rows: ArticleRow[], total: number) {
  const recorded: Recorded[] = [];
  const prepare = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async all() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        if (/SELECT COUNT\(\*\)/i.test(stmt.sql))
          return { results: [{ total }] };
        return { results: rows };
      },
      async first() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        if (/SELECT COUNT\(\*\)/i.test(stmt.sql)) return { total };
        return rows[0] ?? null;
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown, statements: () => [...recorded] };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

function row(id: number, tagsBlob: string | null): ArticleRow {
  return {
    id,
    title: `文章 ${id}`,
    slug: `post-${id}`,
    summary: "摘要",
    cover_image: "",
    status: "published",
    content: "正文内容",
    view_count: 1,
    like_count: 2,
    comment_count: 3,
    published_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    author_id: 1,
    category_id: 2,
    category_name: "技术",
    category_slug: "tech",
    author_name: "作者",
    tags_blob: tagsBlob,
  };
}

describe("listArticles 标签批量解析（#89 / M1）", () => {
  it("50 篇列表只发 count + 1 条列表查询，不再逐篇查标签（D1 往返与文章数无关）", async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row(i + 1, "1^_技术^_tech^^2^_生活^_life")
    );
    const fake = makeListDb(rows, 50);
    const result = await listArticles(makeEnv(fake.db), {
      page: 1,
      page_size: 50,
    });

    expect(result.items).toHaveLength(50);
    // count 一条 + 列表一条；绝不出现逐篇标签查询
    const stmts = fake.statements();
    const listSelects = stmts.filter(
      (s) =>
        /FROM articles a/i.test(s.sql) && !/SELECT COUNT\(\*\)/i.test(s.sql)
    );
    expect(listSelects).toHaveLength(1);
    expect(listSelects[0].sql).toMatch(/group_concat/i);
    // 顺序稳定：SQL 内层按 t.id 排序；分隔符约定 ^_ 字段 / ^^ 标签（守卫拼接格式不漂移）
    expect(listSelects[0].sql).toMatch(/ORDER\s+BY\s+t\.id/i);
    expect(listSelects[0].sql).toMatch(/'\^\^'/);
    expect(listSelects[0].sql).toMatch(/'\^_'/);
    const perArticleTagQueries = stmts.filter((s) =>
      /WHERE\s+at\.article_id\s*=\s*\?/i.test(s.sql)
    );
    expect(perArticleTagQueries).toHaveLength(0);
    expect(stmts).toHaveLength(2);
  });

  it("标签 blob 解析逐字段一致：空标签、单标签、多标签、稳定顺序", async () => {
    // id 升序拼接 => 解析后顺序稳定为 id 1,2,3
    const rows = [
      row(1, null), // 空标签
      row(2, "1^_技术^_tech"), // 单标签
      row(3, "3^_生活^_life^^1^_技术^_tech^^2^_编程^_code"), // 多标签
    ];
    const fake = makeListDb(rows, 3);
    const result = await listArticles(makeEnv(fake.db), {
      page: 1,
      page_size: 10,
    });

    expect(result.items[0].tags).toEqual([]);
    expect(result.items[1].tags).toEqual([
      { id: 1, name: "技术", slug: "tech" },
    ]);
    expect(result.items[2].tags).toEqual([
      { id: 3, name: "生活", slug: "life" },
      { id: 1, name: "技术", slug: "tech" },
      { id: 2, name: "编程", slug: "code" },
    ]);
  });

  it("特殊字符标签名（含分隔符、空格、中文、斜杠）逐字段无损解析", async () => {
    // 约定：id^_name^_slug，标签间 ^^；id/slug 不含分隔符，name 可含 ^_ 组合。
    // 解析策略：首个 ^_ 切出 id、末个 ^_ 切出 slug，中间整段归 name。
    const blob = [
      "1^_a^_b^_cpp", // name 含字段分隔符 ^_
      "2^_a b c^_a-b-c", // 空格 + 连字符 slug
      "3^_中文 标签^_zh-tag", // 中文 + 空格
      "4^_C/C++^_cplusplus", // 斜杠与单个 ^
      "5^_x^y^_xy", // name 含单个 ^（非 ^^ 分隔符），不应被切分
    ].join("^^");
    const fake = makeListDb([row(1, blob)], 1);
    const result = await listArticles(makeEnv(fake.db), {
      page: 1,
      page_size: 10,
    });

    expect(result.items[0].tags).toEqual([
      { id: 1, name: "a^_b", slug: "cpp" },
      { id: 2, name: "a b c", slug: "a-b-c" },
      { id: 3, name: "中文 标签", slug: "zh-tag" },
      { id: 4, name: "C/C++", slug: "cplusplus" },
      { id: 5, name: "x^y", slug: "xy" },
    ]);
  });

  it("响应形状不变：ArticleListItem 全部字段仍在，category 缺省回退保留", async () => {
    const fake = makeListDb([row(1, "1^_技术^_tech")], 1);
    const result = await listArticles(makeEnv(fake.db), {
      page: 1,
      page_size: 10,
    });
    const item = result.items[0];
    expect(Object.keys(item).sort()).toEqual(
      [
        "id",
        "title",
        "slug",
        "summary",
        "cover_image",
        "category",
        "tags",
        "status",
        "view_count",
        "like_count",
        "comment_count",
        "author_id",
        "author_name",
        "published_at",
        "created_at",
        "reading_time",
      ].sort()
    );
    expect(item.category).toEqual({ id: 2, name: "技术", slug: "tech" });
    expect(item.reading_time).toBe(1);
  });
});
