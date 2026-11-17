// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { router } from "../src/router";
import type { Env } from "../src/index";

/**
 * issue #78 / T2：分类读 API（taxonomy v2 / ADR 0008）。
 *
 * 接缝：router() 全链路 + node:sqlite 真实 D1 适配桩。
 *
 * 票面验收：
 * - GET /categories 返回 tag_count（COUNT(DISTINCT t.id)，不受文章状态影响）；
 * - GET /categories/:slug 200/404；article_count 仍只算已发布文章。
 */

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as Parameters<typeof router>[2];

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
 * 种子：分类 1 未分类 / 2 前端 / 3 后端 / 4 转载；
 * 标签 11 Vue→前端、12 Node→后端、13 孤儿→未分类(1)、14 备用→转载(4)；
 * 文章 101 已发布(前端)、102 草稿(前端)、103 已发布(后端)。
 * 期望计数：前端 article_count=1（草稿排除）tag_count=1；后端 1/1；未分类 0/1；转载 0/1。
 */
function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, description TEXT DEFAULT '', created_by INTEGER, created_at TEXT DEFAULT '2026-01-01', updated_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, category_id INTEGER, created_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, slug TEXT, content TEXT DEFAULT '', summary TEXT DEFAULT '', category_id INTEGER, status TEXT, published_at TEXT, created_at TEXT, view_count INTEGER DEFAULT 0, reading_time INTEGER DEFAULT 1);
    CREATE TABLE article_tags (article_id INTEGER, tag_id INTEGER, PRIMARY KEY (article_id, tag_id));
    INSERT INTO categories (id, name, slug) VALUES (1, '未分类', 'uncategorized'), (2, '前端', 'frontend'), (3, '后端', 'backend'), (4, '转载', 'repost');
    INSERT INTO tags (id, name, slug, category_id) VALUES (11, 'Vue', 'vue', 2), (12, 'Node', 'node', 3), (13, '孤儿', 'orphan-tag', 1), (14, '备用', 'spare', 4);
    INSERT INTO articles (id, title, slug, category_id, status) VALUES
      (101, 'Vue 3 入门', 'vue-3-intro', 2, 'published'),
      (102, 'Vue 草稿', 'vue-draft', 2, 'draft'),
      (103, 'Node 部署', 'node-deploy', 3, 'published');
  `);
  return db;
}

describe("GET /categories（#78 taxonomy v2）", () => {
  it("返回 tag_count（不受文章状态影响），article_count 仍只算已发布，旧字段不变", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/categories");
    expect(res.status).toBe(200);
    const cats = body.data as Array<Record<string, unknown>>;
    const bySlug = Object.fromEntries(cats.map((c) => [c.slug as string, c]));

    expect(bySlug["frontend"]).toEqual({
      id: 2,
      name: "前端",
      slug: "frontend",
      description: "",
      created_by: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      article_count: 1, // 101 已发布；102 草稿不计入
      tag_count: 1, // Vue
    });
    expect(bySlug["backend"]).toMatchObject({ article_count: 1, tag_count: 1 });
    expect(bySlug["uncategorized"]).toMatchObject({
      article_count: 0,
      tag_count: 1,
    });
    expect(bySlug["repost"]).toMatchObject({ article_count: 0, tag_count: 1 });
  });
});

describe("GET /categories/:slug（#78 taxonomy v2）", () => {
  it("200：返回分类详情（article_count / tag_count）", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/categories/frontend");
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 2,
      name: "前端",
      slug: "frontend",
      article_count: 1,
      tag_count: 1,
    });
  });

  it("404：未知 slug 返回 notFound JSON（不 500）", async () => {
    const env = makeEnv(seed());
    const { res, body } = await get(env, "/categories/no-such-cat");
    expect(res.status).toBe(404);
    expect(body.code).toBe(10005);
    expect(body.data).toBeNull();
  });
});
