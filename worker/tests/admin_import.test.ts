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

/**
 * 记录全部 prepare/bind 序列的假 D1（prepare 顺序即真实执行顺序；bind 写入同一记录对象）。
 * #86：新增 all()（COUNT 查询返回现有行数，其余返回空）与 MEDIA KV（备份 put）。
 * 所有读值默认「现有 100 行」——让常规导入不触发异常规模阈值，避免影响 #23 基线断言。
 */
function recordingDb(options: { existingCount?: number } = {}): {
  db: unknown;
  statements: RecordedStatement[];
} {
  const statements: RecordedStatement[] = [];
  const existingCount = options.existingCount ?? 100;
  const prepare = (sql: string) => {
    const stmt: RecordedStatement = { sql, binds: [] };
    statements.push(stmt);
    const api = {
      bind: (...binds: unknown[]) => {
        stmt.binds = binds;
        return api;
      },
      all: () =>
        Promise.resolve({
          results: /COUNT\(\*\)/i.test(sql)
            ? [{ count: existingCount }]
            : ([] as unknown[]),
        }),
      run: () => Promise.resolve({ success: true, meta: { last_row_id: 0 } }),
    };
    return api;
  };
  return { db: { prepare }, statements };
}

/** 记录 put 调用的假 MEDIA KV（#86 备份） */
function recordingMedia(): {
  media: Env["MEDIA"];
  puts: Array<{ key: string; value: string; options?: unknown }>;
} {
  const puts: Array<{ key: string; value: string; options?: unknown }> = [];
  const media = {
    put: (key: string, value: string, options?: unknown) => {
      puts.push({ key, value, options });
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  } as unknown as Env["MEDIA"];
  return { media, puts };
}

function makeEnv(db: unknown, media?: Env["MEDIA"]): Env {
  return { DB: db, MEDIA: media ?? recordingMedia().media } as unknown as Env;
}

/** 以给定 export_data 发起导入，返回响应、SQL 语句与 KV 备份记录 */
async function runImport(
  tables: Record<string, unknown[]>,
  options: {
    dryRun?: boolean;
    confirm?: boolean;
    existingCount?: number;
  } = {}
): Promise<{
  res: Response;
  statements: RecordedStatement[];
  puts: Array<{ key: string; value: string; options?: unknown }>;
}> {
  const { db, statements } = recordingDb({
    existingCount: options.existingCount,
  });
  const { media, puts } = recordingMedia();
  const params = new URLSearchParams();
  if (options.dryRun) params.set("dry_run", "1");
  if (options.confirm) params.set("confirm", "1");
  const query = params.toString();
  const request = new Request(
    `https://example.com/api/v1/admin/import${query ? `?${query}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ export_data: tables }),
    }
  );
  const res = await handleImport(request, makeEnv(db, media));
  return { res, statements, puts };
}

async function bodyOf(res: Response): Promise<{
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
  it("DELETE 只清非密钥/心跳行（NOT IN 名单为五个键）；INSERT 漏过这些行；响应报 skipped_secret_rows", async () => {
    const { res, statements } = await runImport({
      site_config: [
        {
          key: "jwt_secret",
          value: "super-secret",
          is_public: 0,
          updated_at: "2024-01-01",
        },
        {
          key: "analytics_hmac_secret",
          value: "analytics-secret",
          is_public: 0,
          updated_at: "2024-01-01",
        },
        {
          key: "analytics_last_job_at",
          value: "2024-01-01 00:00:00",
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
      data: {
        skipped_secret_rows: [
          "jwt_secret",
          "analytics_hmac_secret",
          "analytics_last_job_at",
        ],
      },
    });

    const deletes = statements.filter((s) =>
      s.sql.startsWith("DELETE FROM site_config")
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0].sql).toContain("WHERE key NOT IN");
    expect(deletes[0].binds).toEqual([
      "jwt_secret",
      "analytics_hmac_secret",
      "admin_password_hash",
      "admin_username",
      "analytics_last_job_at",
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

/**
 * issue #86（H5）：全量导入三道刹车——dry-run / KV 备份 / 异常规模二次确认。
 * 复用上方 recordingDb / recordingMedia 接缝，期望值取自票面字面量。
 */
describe("handleImport 破坏性操作刹车（issue #86 / H5）", () => {
  it("dry_run=1 只返回将要删除/插入行数，不执行任何 DELETE/INSERT、不写 KV", async () => {
    const { res, statements, puts } = await runImport(minimalBackup, {
      dryRun: true,
      existingCount: 3,
    });

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toMatchObject({
      dry_run: true,
      total_inserting: 9,
      needs_confirm: false,
      backup_key: null,
    });
    expect(body.data?.would_delete).toMatchObject({ articles: 3 });
    expect(statements.some((s) => /^\s*(DELETE|INSERT)\b/i.test(s.sql))).toBe(
      false
    );
    expect(puts).toEqual([]);
  });

  it("正常导入前写 KV 备份（key backup:<ISO>，TTL 7 天），响应返回 backup_key", async () => {
    const { res, puts } = await runImport({
      site_config: minimalBackup.site_config,
    });

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data?.backup_key).toEqual(
      expect.stringMatching(/^backup:\d{4}-\d{2}-\d{2}T/)
    );
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(body.data?.backup_key);
    expect(puts[0].options).toMatchObject({ expirationTtl: 7 * 24 * 60 * 60 });
    expect(JSON.parse(puts[0].value).tables.site_config).toBeDefined();
  });

  it("空导入（0 行）无 confirm 被拒 400，带 confirm=1 放行", async () => {
    const denied = await runImport({});
    expect(denied.res.status).toBe(400);
    expect((await bodyOf(denied.res)).message).toContain("confirm=1");
    expect(denied.puts).toEqual([]); // 被拒时连备份都不写

    const allowed = await runImport({}, { confirm: true });
    expect(allowed.res.status).toBe(200);
    expect(allowed.puts).toHaveLength(1);
  });

  it("超量导入（>10× 现有行数）无 confirm 被拒，带 confirm 放行", async () => {
    const big: Record<string, unknown[]> = {
      categories: Array.from({ length: 101 }, (_, i) => ({
        id: i + 1,
        name: `C${i}`,
        slug: `c${i}`,
      })),
    };
    const denied = await runImport(big, { existingCount: 10 });
    expect(denied.res.status).toBe(400);

    const allowed = await runImport(big, { existingCount: 10, confirm: true });
    expect(allowed.res.status).toBe(200);
  });

  it("10× 边界值本身不触发确认（101 > 100 触发，100 不触发）", async () => {
    const exact: Record<string, unknown[]> = {
      categories: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `C${i}`,
        slug: `c${i}`,
      })),
    };
    expect((await runImport(exact, { existingCount: 10 })).res.status).toBe(
      200
    );
  });

  it("dry-run 也报告 needs_confirm=true（供调用方预判）", async () => {
    const { res } = await runImport({}, { dryRun: true });
    expect(await bodyOf(res)).toMatchObject({
      data: { needs_confirm: true, total_inserting: 0 },
    });
  });

  it("备份写失败时中止导入（不留无备份的破坏性操作，且无 DELETE/INSERT）", async () => {
    const { db, statements } = recordingDb();
    const failingMedia = {
      put: () => Promise.reject(new Error("KV quota exceeded")),
      get: () => Promise.resolve(null),
      delete: () => Promise.resolve(),
    } as unknown as Env["MEDIA"];
    const request = new Request("https://example.com/api/v1/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        export_data: { site_config: minimalBackup.site_config },
      }),
    });
    const res = await handleImport(request, makeEnv(db, failingMedia));
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.message).not.toContain("KV quota");
    expect(body.message).not.toMatch(/INSERT|DELETE|SELECT/);
    // 备份失败在阶段 2 之前：只有只读的 COUNT/SELECT（备份读取），无任何写
    expect(statements.some((s) => /^\s*(DELETE|INSERT)\b/i.test(s.sql))).toBe(
      false
    );
  });
});
