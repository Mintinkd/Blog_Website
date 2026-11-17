// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { router } from "../src/router";
import type { Env } from "../src/index";

/**
 * issue #78 / T2：标签读 API 与文章内嵌标签分类（taxonomy v2 / ADR 0008）。
 *
 * 接缝：router() 全链路 + node:sqlite 真实 D1 适配桩（SQL 真实执行，不做结果自证）。
 *
 * 票面验收：
 * - GET /tags 返回 category_id / category / article_count，草稿不计入；
 * - ?category_slug= 只返回该分类标签；
 * - GET /tags/:slug 200/404，响应含分类与计数，未知 slug 不 500；
 * - GET /search 的 FTS 与 LIKE 两条路径都返回 category，无分类文章为 null；
 * - 旧字段（id / name / slug）不变，迁移期 category 允许为 null。
 */

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as Parameters<typeof router>[2];

/** node:sqlite → D1 最小适配（prepare/bind/all/first/run；测试内 SQL 真实执行）。 */
function makeD1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      let bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound = args;
          return api;
        },
        async all() {
          return {
            results: stmt.all(...(bound as Parameters<typeof stmt.all>)),
          };
        },
        async first<T = unknown>() {
          const rows = stmt.all(
            ...(bound as Parameters<typeof stmt.all>)
          ) as T[];
          return (rows[0] ?? null) as T | null;
        },
        async run() {
          const info = stmt.run(...(bound as Parameters<typeof stmt.run>));
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid ?? 0),
            },
          };
        },
      };
      return api;
    },
    async batch(items: unknown[]) {
      return items;
    },
  };
}

function makeEnv(db: DatabaseSync): Env {
  return {
    API_PREFIX: "/api/v1",
    DB: makeD1(db),
    RATE_LIMIT: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
  } as unknown as Env;
}

async function get(env: Env, path: string) {
  const res = await router(
    new Request(`http://localhost/api/v1${path}`),
    env,
    CTX
  );
  return {
    res,
    body: (await res.json()) as {
      code: number;
      message: string;
      data: unknown;
    },
  };
}

/**
 * 种子（手写，不从实现推回）：
 * 分类 1 未分类 / 2 前端 / 3 后端；标签 11 Vue→前端、12 Node→后端、13 孤儿→NULL；
 * 文章 101 已发布(前端)、102 草稿(前端)、103 已发布(后端)。
 * 关联：101-11、102-11（草稿引用，计数须排除）、103-12。
 */
function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, description TEXT DEFAULT '');
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, category_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, slug TEXT, content TEXT DEFAULT '', summary TEXT DEFAULT '', category_id INTEGER, status TEXT, published_at TEXT, created_at TEXT, view_count INTEGER DEFAULT 0, reading_time INTEGER DEFAULT 1, category_name TEXT DEFAULT '', tag_names TEXT DEFAULT '');
    CREATE TABLE article_tags (article_id INTEGER, tag_id INTEGER, PRIMARY KEY (article_id, tag_id));
    INSERT INTO categories VALUES (1, '未分类', 'uncategorized', ''), (2, '前端', 'frontend', ''), (3, '后端', 'backend', '');
    INSERT INTO tags (id, name, slug, category_id) VALUES (11, 'Vue', 'vue', 2), (12, 'Node', 'node', 3), (13, '孤儿', 'orphan-tag', NULL);
    INSERT INTO articles (id, title, slug, summary, content, category_id, status) VALUES
      (101, 'Vue 3 入门', 'vue-3-intro', 'Alpha Vue 摘要', 'Alpha Vue 正文', 2, 'published'),
      (102, 'Vue 草稿', 'vue-draft', '', '草稿正文', 2, 'draft'),
      (103, 'Node 部署', 'node-deploy', '', 'Node 正文', 3, 'published'),
      (104, '独立开发周记', 'indie-weekly', '', 'Alpha 独立开发记录', NULL, 'published');
    INSERT INTO article_tags VALUES (101, 11), (102, 11), (103, 12);
  `);
  return db;
}

describe("GET /tags（#78 taxonomy v2）", () => {
  it("返回 category_id / category / article_count，草稿不计入，旧字段不变，无归属标签 category 为 null", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/tags");
    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    const tags = body.data as Array<Record<string, unknown>>;
    expect(tags).toHaveLength(3);
    const bySlug = Object.fromEntries(tags.map((t) => [t.slug, t]));

    expect(bySlug["vue"]).toEqual({
      id: 11,
      name: "Vue",
      slug: "vue",
      created_by: null,
      created_at: "2026-01-01",
      category_id: 2,
      category: { id: 2, name: "前端", slug: "frontend" },
      article_count: 1, // 101 已发布计入；102 草稿不计入（旧口径 COUNT(at.article_id) 会得 2）
    });
    expect(bySlug["node"]).toEqual({
      id: 12,
      name: "Node",
      slug: "node",
      created_by: null,
      created_at: "2026-01-01",
      category_id: 3,
      category: { id: 3, name: "后端", slug: "backend" },
      article_count: 1,
    });
    // 迁移期语义：无归属标签 category / category_id 为 null，不 500
    expect(bySlug["orphan-tag"]).toMatchObject({
      id: 13,
      name: "孤儿",
      slug: "orphan-tag",
      category_id: null,
      category: null,
      article_count: 0,
    });
  });

  it("?category_slug= 只返回该分类标签；未知分类返回空数组", async () => {
    const env = makeEnv(seed());
    const frontend = await get(env, "/tags?category_slug=frontend");
    expect(
      (frontend.body.data as Array<{ slug: string }>).map((t) => t.slug)
    ).toEqual(["vue"]);

    const backend = await get(env, "/tags?category_slug=backend");
    expect(
      (backend.body.data as Array<{ slug: string }>).map((t) => t.slug)
    ).toEqual(["node"]);

    // 无归属（NULL）标签不匹配任何 category_slug
    const missing = await get(env, "/tags?category_slug=no-such-cat");
    expect(missing.body.data).toEqual([]);
  });
});

describe("GET /tags/:slug（#78 taxonomy v2）", () => {
  it("200：返回标签详情（含分类与计数）", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/tags/vue");
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 11,
      name: "Vue",
      slug: "vue",
      category_id: 2,
      category: { id: 2, name: "前端", slug: "frontend" },
      article_count: 1,
    });
  });

  it("404：未知 slug 返回 notFound JSON（不 500）", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/tags/no-such-tag");
    expect(res.status).toBe(404);
    expect(body.code).toBe(10005);
    expect(body.data).toBeNull();
  });
});

describe("GET /search 搜索项分类（#78 taxonomy v2）", () => {
  it("FTS 路径：结果项带 category（分类 badge 数据源）", async () => {
    const db = seed();
    // 外部内容 FTS5：测试内手工灌索引行（与生产触发器写入等价的索引状态）
    db.exec(`
      CREATE VIRTUAL TABLE articles_fts USING fts5(
        title, content, category_name, tag_names,
        content=articles, content_rowid=id
      );
      INSERT INTO articles_fts(rowid, title, content, category_name, tag_names)
        VALUES (101, 'Vue 3 入门', 'Alpha Vue 正文', '前端', 'Vue');
    `);
    const env = makeEnv(db);
    const { res, body } = await get(env, "/search?q=Vue");
    expect(res.status).toBe(200);
    const data = body.data as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    expect(data.total).toBeGreaterThan(0);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: 101,
      category: { id: 2, name: "前端", slug: "frontend" },
    });
  });

  it("LIKE 回退路径：结果项带 category，无分类文章为 null", async () => {
    const env = makeEnv(seed()); // 不建 articles_fts → FTS 查询失败 → LIKE 回退
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, body } = await get(env, "/search?q=Alpha");
    expect(res.status).toBe(200);
    const data = body.data as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    const byId = Object.fromEntries(data.items.map((i) => [i.id as number, i]));
    expect(byId[101]).toMatchObject({
      category: { id: 2, name: "前端", slug: "frontend" },
    });
    // 无分类文章（迁移期 / NULL 分类）category 为 null，不 500
    expect(byId[104]).toMatchObject({ category: null });
    errSpy.mockRestore();
  });
});
