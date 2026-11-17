import { describe, expect, it } from "vitest";
import {
  handleImport,
  MAX_IMPORT_BATCH_STATEMENTS,
} from "../src/handlers/admin";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #23：admin 导入（#12 安全基线）在收敛为「每表一份描述符」后的行为锁定与覆盖。
 * 覆盖工单点名的四条防御线（行为零变化）：
 *   1) 表/列白名单拒绝 —— 未知表/未知列 400，且不执行任何 DELETE/INSERT；
 *   2) site_config 密钥行跳过 —— DELETE 只清非密钥行、INSERT 漏过密钥行、响应报数；
 *   3) 只有 `content_html`（真正的 HTML 列）入库前 sanitizeHtml；Markdown `content`
 *      与纯文本评论正文原样还原（#92 范围修正：白名单会吃掉 Markdown 里的
 *      `<https://…>` / `<T>` / 围栏 HTML，破坏「备份可还原」）；
 *   4) FK 安全顺序 —— 删除先子后父、插入先父后子（与 schema FK 依赖吻合）。
 *
 * 接缝：handleImport —— 工单 Key interfaces 点名的 handler 接缝（env.DB SQL 出口）。
 * D1 以桩对象替代：按 prepare/bind 顺序记录全部语句，顺序即真实执行顺序。
 */

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

interface RecordingDbOptions {
  existingCount?: number;
  /** SELECT 返回值（按表名），供 #87 快照/孤儿清理测试构造存量数据 */
  selectRows?: Record<string, unknown[]>;
  /** 在第 N 次 batch（0 基）且语句满足条件时抛错——模拟 D1 事务失败 */
  failBatchOn?: (batchIndex: number, stmts: RecordedStatement[]) => boolean;
  /** 批提交成功后逐句应用到外部状态；失败批次在抛错前不应用，模拟整批回滚 */
  apply?: (stmt: RecordedStatement) => void;
}

/**
 * 记录全部 prepare/bind/batch 序列的假 D1（prepare 顺序即真实执行顺序）。
 * #86：all() 返回 COUNT/快照数据；MEDIA KV 记录 put。
 * #87：batch() 按调用批次记录，可选失败注入与状态应用，用于原子性断言。
 * 所有读值默认「现有 100 行」——让常规导入不触发异常规模阈值，避免影响 #23 基线断言。
 */
function recordingDb(options: RecordingDbOptions = {}): {
  db: unknown;
  statements: RecordedStatement[];
  batches: RecordedStatement[][];
} {
  const statements: RecordedStatement[] = [];
  const batches: RecordedStatement[][] = [];
  const records = new WeakMap<object, RecordedStatement>();
  const existingCount = options.existingCount ?? 100;
  const prepare = (sql: string) => {
    const stmt: RecordedStatement = { sql, binds: [] };
    statements.push(stmt);
    const resolveResults = (): Promise<{ results: unknown[] }> => {
      if (/COUNT\(\*\)/i.test(sql))
        return Promise.resolve({ results: [{ count: existingCount }] });
      const table = /FROM\s+(\w+)/i.exec(sql)?.[1];
      return Promise.resolve({
        results: (table && options.selectRows?.[table]) || ([] as unknown[]),
      });
    };
    const api = {
      bind: (...binds: unknown[]) => {
        stmt.binds = binds;
        return api;
      },
      all: () => resolveResults(),
      first: async <T = unknown>() => {
        const { results } = await resolveResults();
        return (results[0] ?? null) as T | null;
      },
      run: () => Promise.resolve({ success: true, meta: { last_row_id: 0 } }),
    };
    records.set(api, stmt);
    return api;
  };
  const batch = async (stmts: unknown[]) => {
    const recorded = stmts.map(
      (s) => records.get(s as object) ?? { sql: "UNKNOWN", binds: [] }
    );
    const batchIndex = batches.length;
    batches.push(recorded);
    if (options.failBatchOn?.(batchIndex, recorded)) {
      throw new Error("simulated D1 batch failure");
    }
    for (const stmt of recorded) options.apply?.(stmt);
  };
  return { db: { prepare, batch }, statements, batches };
}

/** 记录 put/delete 调用的假 MEDIA KV（#86 备份 + #87 孤儿清理） */
function recordingMedia(): {
  media: Env["MEDIA"];
  puts: Array<{ key: string; value: string; options?: unknown }>;
  deletes: string[];
} {
  const puts: Array<{ key: string; value: string; options?: unknown }> = [];
  const deletes: string[] = [];
  const media = {
    put: (key: string, value: string, options?: unknown) => {
      puts.push({ key, value, options });
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    delete: (key: string) => {
      deletes.push(key);
      return Promise.resolve();
    },
  } as unknown as Env["MEDIA"];
  return { media, puts, deletes };
}

function makeEnv(db: unknown, media?: Env["MEDIA"]): Env {
  return { DB: db, MEDIA: media ?? recordingMedia().media } as unknown as Env;
}

/** 以给定 export_data 发起导入，返回响应、SQL 语句、batch 分组与 KV 记录 */
async function runImport(
  tables: Record<string, unknown[]>,
  options: {
    dryRun?: boolean;
    confirm?: boolean;
    dbOptions?: RecordingDbOptions;
  } = {}
): Promise<{
  res: Response;
  statements: RecordedStatement[];
  batches: RecordedStatement[][];
  puts: Array<{ key: string; value: string; options?: unknown }>;
  deletes: string[];
}> {
  const { db, statements, batches } = recordingDb(options.dbOptions);
  const { media, puts, deletes } = recordingMedia();
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
  return { res, statements, batches, puts, deletes };
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

describe("handleImport tags category_id 归一化（#79 / taxonomy v2）", () => {
  it("旧备份 tags 行缺 category_id / 显式 null → INSERT 归一化到未分类 id；显式值原样保留", async () => {
    const { batches } = await runImport(
      {
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
          // 旧备份形态：无 category_id 列
          {
            id: 1,
            name: "T1",
            slug: "t1",
            created_at: "2024-01-01",
            created_by: null,
          },
          // 新备份形态：显式归属原样保留
          {
            id: 2,
            name: "T2",
            slug: "t2",
            category_id: 7,
            created_at: "2024-01-01",
            created_by: null,
          },
          // 显式 null（异常备份）→ 同样归一化，保证导入后 null category 为 0
          {
            id: 3,
            name: "T3",
            slug: "t3",
            category_id: null,
            created_at: "2024-01-01",
            created_by: null,
          },
        ],
      },
      { dbOptions: { selectRows: { categories: [{ id: 5 }] } } }
    );

    const tagInserts = batches
      .flat()
      .filter((s) => s.sql.startsWith("INSERT INTO tags"));
    expect(tagInserts).toHaveLength(3);
    for (const s of tagInserts) {
      expect(s.sql, "tags INSERT 应含 category_id 列").toContain("category_id");
    }
    // 未分类 id = 5（来自 selectRows 桩的 uncategorized 查询结果）
    expect(tagInserts[0].binds).toContain(5); // 缺列 → 归一化
    expect(tagInserts[1].binds).toContain(7); // 显式 7 → 保留
    expect(tagInserts[2].binds).toContain(5); // null → 归一化
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

describe("handleImport 内容净化（issue #23 / #12 基线；#92 范围修正）", () => {
  it("只净化 content_html；Markdown 源文与纯文本评论原样还原（#92 修正）", async () => {
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
    // `content` 是 Markdown 源文：过 HTML 白名单会吃掉 `<https://…>` 自动链接、
    // `<T>` 泛型与围栏里的 HTML，破坏「备份可还原」。XSS 由渲染链兜底
    // （markdownServer 消毒 + 前台 DOMPurify），故这里必须逐字原样。
    expect(articleInsert!.binds).toContain("<img src=x onerror=alert(1)>ok");
    // `content_html` 是真正的 HTML 列，仍按白名单净化
    expect(articleInsert!.binds).toContain("<p>hi</p>");
    expect(articleInsert!.binds).not.toContain("<script>bad()</script>");

    const commentInsert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO comments")
    );
    expect(commentInsert).toBeDefined();
    // 评论正文是纯文本（渲染时由 Vue 插值转义），导入不再改写实体
    expect(commentInsert!.binds).toContain('<a href="javascript:x()">c</a>');
  });

  it("Markdown 里的自动链接 / 泛型 / 围栏 HTML 经导入后逐字保留", async () => {
    const markdown = [
      "see <https://example.com/x> for more",
      "use <T> generic in TS",
      "```html",
      '<div class="x">hi</div>',
      "```",
      "a < b && c > d",
    ].join("\n");

    const { res, statements } = await runImport({
      articles: [
        {
          id: 1,
          title: "A",
          slug: "a",
          content: markdown,
          content_html: "",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      ],
    });

    expect(res.status).toBe(200);
    const articleInsert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO articles")
    );
    expect(articleInsert!.binds).toContain(markdown);
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
      dbOptions: { existingCount: 3 },
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
    const denied = await runImport(big, { dbOptions: { existingCount: 10 } });
    expect(denied.res.status).toBe(400);

    const allowed = await runImport(big, {
      dbOptions: { existingCount: 10 },
      confirm: true,
    });
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
    expect(
      (await runImport(exact, { dbOptions: { existingCount: 10 } })).res.status
    ).toBe(200);
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

/**
 * issue #87（H9）：batch 原子替换 + KV 孤儿清理。
 * fake D1 的 batch 在「失败注入」命中时抛错且不应用任何语句（对齐 D1 batch 事务语义），
 * 从而可以直接断言「DELETE 不生效、库保持导入前状态」。
 */
describe("handleImport batch 原子替换（issue #87 / H9）", () => {
  type Row = Record<string, unknown>;
  const oldRow: Row = {
    key: "site_title",
    value: "OLD",
    is_public: 0,
    updated_at: "2024-01-01",
  };

  it("batch 中某条 INSERT 失败时 DELETE 不生效，快照回滚后库保持导入前状态", async () => {
    const state: Record<string, Row[]> = { site_config: [{ ...oldRow }] };
    const apply = (stmt: RecordedStatement) => {
      const table = tableOf(stmt.sql);
      if (stmt.sql.startsWith("DELETE")) {
        state[table] = [];
        return;
      }
      const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(stmt.sql)?.[1] ?? "";
      (state[table] ??= []).push(
        Object.fromEntries(
          cols.split(", ").map((col, i) => [col, stmt.binds[i]])
        )
      );
    };

    const { res, batches, deletes } = await runImport(
      {
        site_config: [
          {
            key: "site_title",
            value: "NEW",
            is_public: 0,
            updated_at: "2024-01-02",
          },
        ],
      },
      {
        dbOptions: {
          selectRows: { site_config: [{ ...oldRow }] },
          failBatchOn: (index, stmts) =>
            index === 0 &&
            stmts.some((s) => s.sql.startsWith("INSERT INTO site_config")),
          apply,
        },
      }
    );

    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.message).toBe("Import failed: internal error");
    expect(body.message).not.toMatch(/site_config|INSERT|DELETE|SELECT/);
    expect(body.data).toMatchObject({ restored: true });
    expect(body.data?.backup_key).toEqual(
      expect.stringMatching(/^backup:\d{4}-\d{2}-\d{2}T/)
    );

    // 第一批含 DELETE + 新 INSERT（整批失败，未应用）；第二批为快照回滚
    expect(batches).toHaveLength(2);
    expect(
      batches[0].some((s) => s.sql.startsWith("DELETE FROM site_config"))
    ).toBe(true);
    expect(
      batches[1].some((s) => s.sql.startsWith("INSERT INTO site_config"))
    ).toBe(true);
    expect(state.site_config).toEqual([oldRow]);
    // DB 未提交，KV 对象不得提前清理
    expect(deletes).toEqual([]);
  });

  it("跨表 batch 顺序满足外键约束：DELETE 先子后父、INSERT 先父后子，且顺序与输入顺序无关", async () => {
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

    const { res, batches } = await runImport(scrambled);
    expect(res.status).toBe(200);
    const flat = batches.flat();
    expect(
      flat.filter((s) => s.sql.startsWith("DELETE")).map((s) => tableOf(s.sql))
    ).toEqual(DELETE_ORDER);
    expect(
      flat.filter((s) => s.sql.startsWith("INSERT")).map((s) => tableOf(s.sql))
    ).toEqual(INSERT_ORDER);
  });

  it(`大导入按 ${MAX_IMPORT_BATCH_STATEMENTS} 条/批切分，每批都是一次 batch 调用且顺序不乱`, async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({
      key: `k${i}`,
      value: "v",
      is_public: 0,
      updated_at: "2024-01-01",
    }));
    const { res, batches } = await runImport({ site_config: rows });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).data?.batches).toBe(3);
    expect(batches.map((b) => b.length)).toEqual([
      MAX_IMPORT_BATCH_STATEMENTS,
      MAX_IMPORT_BATCH_STATEMENTS,
      51,
    ]);
    expect(batches[0][0].sql).toBe(
      "DELETE FROM site_config WHERE key NOT IN (?, ?, ?, ?, ?)"
    );
    expect(
      batches.flat().filter((s) => s.sql.startsWith("INSERT"))
    ).toHaveLength(450);
  });
});

describe("handleImport KV 孤儿清理（issue #87 / H9）", () => {
  it("替换 media_assets 时逐个删除旧 kv_key，跳过新导入复用的 key 与非 kv 存储", async () => {
    const oldRows = [
      { id: 1, kv_key: "old-1", storage_type: "kv" },
      { id: 2, kv_key: "reused", storage_type: "kv" },
      { id: 3, kv_key: "remote-url", storage_type: "remote" },
      { id: 4, kv_key: null, storage_type: "kv" },
    ];
    const imported = [
      {
        id: 2,
        filename: "f",
        original_name: "f",
        mime_type: "image/png",
        file_size: 1,
        kv_key: "reused",
        storage_type: "kv",
        alt_text: null,
        created_at: "2024-01-01",
        uploaded_by: null,
      },
      {
        id: 5,
        filename: "g",
        original_name: "g",
        mime_type: "image/png",
        file_size: 2,
        kv_key: "new-1",
        storage_type: "kv",
        alt_text: null,
        created_at: "2024-01-01",
        uploaded_by: null,
      },
    ];

    const { res, deletes, batches } = await runImport(
      { media_assets: imported },
      { dbOptions: { selectRows: { media_assets: oldRows } } }
    );

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).data).toMatchObject({
      kv_orphans_deleted: 1,
      kv_cleanup_failed: 0,
    });
    expect(deletes).toEqual(["old-1"]);
    expect(
      batches.flat().some((s) => s.sql === "DELETE FROM media_assets")
    ).toBe(true);
  });

  it("media_assets 为空数组时不清理 KV（旧行未被删，key 仍被引用）", async () => {
    // #87 修正：DELETE 对空表跳过，旧 media_assets 行仍在库里，
    // 此时若按快照清理 KV 会留下「有记录、无文件」的破图。
    // 真实触发场景：一次只导入文章、没带 media_assets 的导入。
    const oldRows = [{ id: 1, kv_key: "live-1", storage_type: "kv" }];
    const { res, deletes, batches } = await runImport(
      {
        articles: [
          {
            id: 1,
            title: "A",
            slug: "a",
            content: "body",
            content_html: "",
            created_at: "2024-01-01",
            updated_at: "2024-01-01",
          },
        ],
        media_assets: [],
      },
      { dbOptions: { selectRows: { media_assets: oldRows } } }
    );

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).data).toMatchObject({
      kv_orphans_deleted: 0,
      kv_cleanup_failed: 0,
    });
    expect(deletes).toEqual([]);
    expect(
      batches.flat().some((s) => s.sql === "DELETE FROM media_assets")
    ).toBe(false);
  });

  it("articles 导入列含 reading_time：备份往返不把阅读时长打回默认 1", async () => {
    // #73 / M22 补列时的回归点：descriptor 漏列会让 export 丢列、import 落 DEFAULT 1。
    const { res, statements } = await runImport({
      articles: [
        {
          id: 1,
          title: "A",
          slug: "a",
          content: "body",
          content_html: "",
          reading_time: 7,
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      ],
    });

    expect(res.status).toBe(200);
    const articleInsert = statements.find((s) =>
      s.sql.startsWith("INSERT INTO articles")
    );
    expect(articleInsert).toBeDefined();
    expect(articleInsert!.sql).toContain("reading_time");
    expect(articleInsert!.binds).toContain(7);
  });

  it("KV 删除失败不影响已提交的 DB 导入，响应如实报数且不含异常原文", async () => {
    const { db, statements } = recordingDb({
      selectRows: {
        media_assets: [{ id: 1, kv_key: "old-1", storage_type: "kv" }],
      },
    });
    const media = {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      delete: () => Promise.reject(new Error("KV service unavailable")),
    } as unknown as Env["MEDIA"];
    const request = new Request("https://example.com/api/v1/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        export_data: {
          media_assets: [
            {
              id: 2,
              kv_key: "new-1",
              storage_type: "kv",
              created_at: "2024-01-01",
            },
          ],
        },
      }),
    });

    const res = await handleImport(request, makeEnv(db, media));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toMatchObject({
      kv_orphans_deleted: 0,
      kv_cleanup_failed: 1,
    });
    expect(JSON.stringify(body)).not.toContain("KV service unavailable");
    expect(
      statements.some((s) => s.sql.startsWith("DELETE FROM media_assets"))
    ).toBe(true);
  });
});

/** #87 验收：路由层鉴权口径未因事务化改造而退化 */
describe("admin/import 路由鉴权（issue #87 / H9）", () => {
  const JWT_SECRET = "issue87-import-test-secret";

  function authEnv(role?: "admin" | "editor"): Env {
    const prepare = (sql: string) => {
      const stmt = {
        sql,
        binds: [] as unknown[],
        bind(...binds: unknown[]) {
          stmt.binds = binds;
          return stmt;
        },
        first: () => {
          if (sql.includes("key = 'jwt_secret'"))
            return Promise.resolve({ value: JWT_SECRET });
          if (sql.includes("FROM users"))
            return Promise.resolve(
              role ? { role, must_change_password: 0 } : null
            );
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: [] as unknown[] }),
        run: () => Promise.resolve({ success: true, meta: {} }),
      };
      return stmt;
    };
    return {
      DB: {
        prepare,
        batch: () => Promise.resolve([]),
      },
      MEDIA: recordingMedia().media,
      RATE_LIMIT: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(),
      },
    } as unknown as Env;
  }

  async function callImport(role?: "admin" | "editor"): Promise<Response> {
    const headers: Record<string, string> = {};
    if (role) {
      headers.Authorization = `Bearer ${await generateToken(
        role === "admin" ? "adminuser" : "editoruser",
        JWT_SECRET
      )}`;
    }
    const request = new Request(
      "https://api.example.test/api/v1/admin/import",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ export_data: { site_config: [] } }),
      }
    );
    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return router(request, authEnv(role), ctx);
  }

  it("未登录返回 401", async () => {
    expect((await callImport()).status).toBe(401);
  });

  it("editor 返回 403", async () => {
    expect((await callImport("editor")).status).toBe(403);
  });
});
