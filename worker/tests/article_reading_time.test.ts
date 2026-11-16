import { describe, expect, it } from "vitest";
import {
  listArticles,
  createArticle,
  updateArticle,
} from "../src/services/article_service";
import type { Env } from "../src/index";

/**
 * issue #90 / M2：reading_time 落库 + 列表不再 select content。
 *
 * 接缝：article_service 的 listArticles / createArticle / updateArticle（D1 出口）。
 * 期望值全部手写字面量，不从被测实现反推。
 */

interface Recorded {
  sql: string;
  binds: unknown[];
}

function listRow(
  overrides: { reading_time?: number | null; content?: string } = {}
) {
  return {
    id: 1,
    title: "标题",
    slug: "slug",
    summary: "摘要",
    cover_image: "",
    status: "published",
    content: "这段正文绝不应被列表查询选中",
    view_count: 0,
    like_count: 0,
    comment_count: 0,
    published_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    author_id: 1,
    category_id: null,
    category_name: null,
    category_slug: null,
    author_name: "作者",
    reading_time: 7, // 落库值，人为设为 7 以区分「读落库」与「现算」
    tags_blob: null,
    ...overrides,
  };
}

/** 列表桩：记录 SQL，返回一行带 reading_time=7 的文章。 */
function makeListDb(row = listRow()) {
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
          return { results: [{ total: 1 }] };
        return { results: [row] };
      },
      async first() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        return { total: 1 };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown, statements: () => [...recorded] };
}

describe("listArticles 不再搬运正文（#90 / M2）", () => {
  it("列表 SQL 不 select content，reading_time 直接读落库值", async () => {
    const fake = makeListDb();
    const result = await listArticles({ DB: fake.db } as unknown as Env, {
      page: 1,
      page_size: 10,
    });
    const listSql = fake
      .statements()
      .find(
        (s) =>
          /FROM articles a/i.test(s.sql) && !/SELECT COUNT\(\*\)/i.test(s.sql)
      );
    expect(listSql).toBeDefined();
    // 不得把 content 列搬到应用层
    expect(listSql!.sql).not.toMatch(/a\.content\b/);
    expect(listSql!.sql).toMatch(/a\.reading_time\b/);
    // reading_time 来自落库字段而非现算（content="短" 现算是 1，落库是 7）
    expect(result.items[0].reading_time).toBe(7);
  });

  it("存量行 reading_time 为 null 时回退到 1（列表无 content，不现算）", async () => {
    // 列表 SQL 已不取 content，回退只能给与 schema DEFAULT 一致的 1；
    // 若误回退 calculateReadingTime(row.content) 会因拿不到正文恒得 1，此处显式钉住行为。
    const fake = makeListDb(
      listRow({ reading_time: null, content: "长".repeat(5000) })
    );
    const result = await listArticles({ DB: fake.db } as unknown as Env, {
      page: 1,
      page_size: 10,
    });
    expect(result.items[0].reading_time).toBe(1);
  });
});

/** 写桩：记录 INSERT / UPDATE 的列名与 bind，回读详情返回固定行。 */
function makeWriteDb() {
  const recorded: Recorded[] = [];
  const detail = {
    id: 1,
    title: "标题",
    slug: "new-slug",
    content: "正文",
    content_html: "",
    summary: "",
    cover_image: "",
    status: "draft",
    author_id: null,
    published_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    view_count: 0,
    like_count: 0,
    comment_count: 0,
    reading_time: 2,
    category_id: null,
    category_name: null,
    category_slug: null,
    author_name: null,
  };
  const prepare = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async first() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        if (
          /SELECT id, published_at FROM articles WHERE id = \?/.test(stmt.sql)
        ) {
          return { id: 1, published_at: null };
        }
        if (/SELECT slug FROM articles WHERE id = \?/.test(stmt.sql)) {
          return { slug: detail.slug };
        }
        if (/FROM articles a[\s\S]*WHERE a\.slug = \?/.test(stmt.sql)) {
          return detail;
        }
        if (/SELECT id FROM articles WHERE slug = \?/.test(stmt.sql))
          return null;
        return null;
      },
      async all() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        return { results: [] };
      },
      async run() {
        recorded.push({ sql: stmt.sql, binds: [...stmt.binds] });
        return { success: true, meta: { changes: 1, last_row_id: 1 } };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown, statements: () => [...recorded] };
}

function insertReadingTime(statements: Recorded[]): number | undefined {
  const insert = statements.find((s) => /INSERT INTO articles \(/i.test(s.sql));
  if (!insert) return undefined;
  const cols = insert.sql.slice(
    insert.sql.indexOf("(") + 1,
    insert.sql.indexOf(")")
  );
  const names = cols.split(",").map((c) => c.trim());
  const idx = names.indexOf("reading_time");
  return idx < 0 ? undefined : (insert.binds[idx] as number);
}

function updateReadingTime(statements: Recorded[]): number | undefined {
  const update = statements.find((s) => /UPDATE articles SET /i.test(s.sql));
  if (!update) return undefined;
  const set = update.sql.slice(
    "UPDATE articles SET ".length,
    update.sql.indexOf(" WHERE id = ?")
  );
  const names = set.split(", ").map((c) => c.split(" = ")[0]);
  const idx = names.indexOf("reading_time");
  return idx < 0 ? undefined : (update.binds[idx] as number);
}

describe("创建 / 更新时维护 reading_time（#90 / M2）", () => {
  it("createArticle 把计算出的 reading_time 写入 INSERT", async () => {
    const fake = makeWriteDb();
    // 350 个中文字符：ceil(350 / 300) = 2 分钟（手算期望值）
    await createArticle({ DB: fake.db } as unknown as Env, {
      title: "标题",
      content: "中".repeat(350),
      category_id: null,
    });
    expect(insertReadingTime(fake.statements())).toBe(2);
  });

  it("updateArticle 内容变化时重算 reading_time 并写入 UPDATE", async () => {
    const fake = makeWriteDb();
    // 500 个中文字符：ceil(500 / 300) = 2 分钟；1000 → 4 分钟
    await updateArticle({ DB: fake.db } as unknown as Env, 1, {
      content: "中".repeat(1000),
    });
    expect(updateReadingTime(fake.statements())).toBe(4);
  });

  it("updateArticle 未改正文时不触碰 reading_time", async () => {
    const fake = makeWriteDb();
    await updateArticle({ DB: fake.db } as unknown as Env, 1, {
      title: "只改标题",
    });
    expect(updateReadingTime(fake.statements())).toBeUndefined();
  });
});
