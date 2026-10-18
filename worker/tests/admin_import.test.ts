import { describe, expect, it } from "vitest";
import { handleImport } from "../src/handlers/admin";
import type { Env } from "../src/index";

/**
 * issue #23：admin 导入（#12 安全基线）在收敛为「每表一份描述符」后的行为锁定与覆盖。
 * 覆盖工单点名的四条防御线（行为零变化）：
 *   1) 表/列白名单拒绝 —— 未知表/未知列 400，且不执行任何 DELETE/INSERT；
 *   2) site_config 密钥行跳过 —— DELETE 只清非密钥行、INSERT 漏过密钥行、响应报数；
 *   3) articles.content/content_html 与 comments.content 入库前 sanitizeHtml；
 *   4) FK 安全顺序 —— 删除先子后父、插入先父后子（与 schema FK 依赖吻合）。
 *
 * 接缝：handleImport —— 工单 Key interfaces 点名的 handler 接缝（env.DB SQL 出口）。
 * D1 以桩对象替代：按 prepare/bind 顺序记录全部语句，顺序即真实执行顺序。
 */

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

/** 记录全部 prepare/bind 序列的假 D1（prepare 顺序即真实执行顺序；bind 写入同一记录对象） */
function recordingDb(): { db: unknown; statements: RecordedStatement[] } {
  const statements: RecordedStatement[] = [];
  const prepare = (sql: string) => {
    const stmt: RecordedStatement = { sql, binds: [] };
    statements.push(stmt);
    const api = {
      bind: (...binds: unknown[]) => {
        stmt.binds = binds;
        return api;
      },
      run: () => Promise.resolve({ success: true, meta: { last_row_id: 0 } }),
    };
    return api;
  };
  return { db: { prepare }, statements };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

/** 以给定 export_data 发起导入，返回响应与全部 SQL 语句（含绑定值） */
async function runImport(tables: Record<string, unknown[]>): Promise<{
  res: Response;
  statements: RecordedStatement[];
}> {
  const { db, statements } = recordingDb();
  const request = new Request("https://example.com/api/v1/admin/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ export_data: tables }),
  });
  const res = await handleImport(request, makeEnv(db));
  return { res, statements };
}

async function bodyOf(
  res: Response
): Promise<{
  code: number;
  message: string;
  data: Record<string, unknown> | null;
}> {
  return (await res.json()) as {
    code: number;
    message: string;
    data: Record<string, unknown> | null;
  };
}

const DELETE_ORDER = [
  "article_tags",
  "comments",
  "article_likes",
  "articles",
  "tags",
  "categories",
  "media_assets",
  "friend_links",
  "site_config",
];
const INSERT_ORDER = [
  "categories",
  "tags",
  "articles",
  "article_tags",
  "comments",
  "article_likes",
  "media_assets",
  "friend_links",
  "site_config",
];

/** 一张每表一行、不踩任何校验线（全原始值、列全在白名单内）的最小合法备份 */
const minimalBackup: Record<string, unknown[]> = {
  categories: [
    {
      id: 1,
      name: "C",
      slug: "c",
      description: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
      created_by: null,
    },
  ],
  tags: [
    { id: 1, name: "T", slug: "t", created_at: "2024-01-01", created_by: null },
  ],
  articles: [
    {
      id: 1,
      title: "A",
      slug: "a",
      content: "c",
      content_html: "ch",
      summary: null,
      cover_image: null,
      category_id: 1,
      status: "published",
      view_count: 0,
      like_count: 0,
      comment_count: 0,
      published_at: null,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
      author_id: null,
    },
  ],
  article_tags: [{ article_id: 1, tag_id: 1 }],
  comments: [
    {
      id: 1,
      article_id: 1,
      nickname: "n",
      content: "c",
      status: "approved",
      ip_hash: "h",
      created_at: "2024-01-01",
    },
  ],
  article_likes: [
    { id: 1, article_id: 1, ip_hash: "h", created_at: "2024-01-01" },
  ],
  media_assets: [
    {
      id: 1,
      filename: "f",
      original_name: "f",
      mime_type: "image/png",
      file_size: 1,
      kv_key: "k",
      storage_type: "kv",
      alt_text: null,
      created_at: "2024-01-01",
      uploaded_by: null,
    },
  ],
  friend_links: [
    {
      id: 1,
      name: "F",
      url: "https://f.example",
      description: null,
      logo_url: null,
      sort_order: 0,
      is_active: 1,
      created_at: "2024-01-01",
      updated_at: "2024-01-01",
    },
  ],
  site_config: [
    { key: "site_title", value: "V", is_public: 0, updated_at: "2024-01-01" },
  ],
};

function tableOf(sql: string): string {
  return sql.replace(/^(DELETE FROM|INSERT INTO) (\S+).*/, "$2");
}

describe("handleImport 表/列白名单拒绝（issue #23 / #12 基线）", () => {
  it("未知表被拒绝，且不执行任何 SQL（阶段 1 全量校验、零副作用）", async () => {
    const { res, statements } = await runImport({ unknown_table: [{ id: 1 }] });

    expect(res.status).toBe(400);
    await expect(bodyOf(res)).resolves.toMatchObject({
      code: 10002,
      message: expect.stringContaining(
        `未知表 ${JSON.stringify("unknown_table")}`
      ),
    });
    expect(statements).toEqual([]);
  });

  it("未知列被拒绝，且不执行任何 SQL", async () => {
    const { res, statements } = await runImport({
      categories: [{ id: 1, evil_col: "payload" }],
    });

    expect(res.status).toBe(400);
    await expect(bodyOf(res)).resolves.toMatchObject({
      code: 10002,
      message: expect.stringContaining("未知列 evil_col"),
    });
    expect(statements).toEqual([]);
  });
});

describe("handleImport site_config 密钥行跳过（issue #23 / #12 基线）", () => {
  it("DELETE 只清非密钥行（NOT IN 名单为三个密钥键）；INSERT 漏过密钥行；响应报 skipped_secret_rows", async () => {
    const { res, statements } = await runImport({
      site_config: [
        {
          key: "jwt_secret",
          value: "super-secret",
          is_public: 0,
          updated_at: "2024-01-01",
        },
        {
          key: "site_title",
          value: "Blog",
          is_public: 0,
          updated_at: "2024-01-01",
        },
      ],
    });

    await expect(bodyOf(res)).resolves.toMatchObject({
      code: 0,
      data: { skipped_secret_rows: ["jwt_secret"] },
    });

    const deletes = statements.filter((s) =>
      s.sql.startsWith("DELETE FROM site_config")
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toContain("WHERE key NOT IN");
    expect(deletes[0].binds).toEqual([
      "jwt_secret",
      "admin_password_hash",
      "admin_username",
    ]);

    const inserts = statements.filter((s) =>
      s.sql.startsWith("INSERT INTO site_config")
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].binds).toEqual(["site_title", "Blog", 0, "2024-01-01"]);
    expect(inserts[0].sql).not.toContain("jwt_secret");
  });
});

describe("handleImport 内容净化（issue #23 / #12 基线）", () => {
  it("articles content/content_html 与 comments content 入库前过 sanitizeHtml（XSS 载荷剥离）", async () => {
    const { res, statements } = await runImport({
      articles: [
        {
          id: 1,
          title: "A",
          slug: "a",
          content: "<img src=x onerror=alert(1)>ok",
          content_html: "<p>hi</p><script>bad()</script>",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      ],
      comments: [
        {
          id: 1,
          article_id: 1,
          nickname: "n",
          content: '<a href="javascript:x()">c</a>',
          status: "approved",
          ip_hash: "h",
          created_at: "2024-01-01",
        },
      ],
    });

    expect(res.status).toBe(200);
    const articleInsert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO articles")
    );
    expect(articleInsert).toBeDefined();
    expect(articleInsert!.binds).toContain("<img src=x >ok");
    expect(articleInsert!.binds).toContain("<p>hi</p>");
    expect(articleInsert!.binds).not.toContain("<script>bad()</script>");

    const commentInsert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO comments")
    );
    expect(commentInsert).toBeDefined();
    expect(commentInsert!.binds).toContain('<a href="x()">c</a>');
  });
});

describe("handleImport FK 安全顺序（issue #23 / #12 基线）", () => {
  it("删除先子后父、插入先父后子；顺序自结构派生、与备份中的输入顺序无关", async () => {
    // 故意把 site_config 放最先、categories 放最后，证明顺序不来自输入顺序
    const scrambled: Record<string, unknown[]> = {
      site_config: minimalBackup.site_config,
      media_assets: minimalBackup.media_assets,
      friend_links: minimalBackup.friend_links,
      comments: minimalBackup.comments,
      articles: minimalBackup.articles,
      article_likes: minimalBackup.article_likes,
      tags: minimalBackup.tags,
      article_tags: minimalBackup.article_tags,
      categories: minimalBackup.categories,
    };

    const { res, statements } = await runImport(scrambled);

    expect(res.status).toBe(200);
    expect(
      statements
        .filter((s) => s.sql.startsWith("DELETE"))
        .map((s) => tableOf(s.sql))
    ).toEqual(DELETE_ORDER);
    expect(
      statements
        .filter((s) => s.sql.startsWith("INSERT"))
        .map((s) => tableOf(s.sql))
    ).toEqual(INSERT_ORDER);
  });
});
