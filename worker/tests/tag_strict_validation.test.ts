// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { AuthResult } from "../src/middleware/auth";
import {
  handleCreateArticle,
  handleUpdateArticle,
} from "../src/handlers/article";
import type { Env } from "../src/index";

/**
 * issue #82 / T6：严格校验开关（taxonomy v2 / ADR 0008 决策 2）。
 *
 * 开关 = site_config 行 `strict_tag_category_validation`，值 `1` 才开启，**默认关**。
 * 接缝：handleCreateArticle / handleUpdateArticle + node:sqlite 真实 D1 适配。
 *
 * 票面验收：
 * - 严格校验默认关闭：关闭时合法文章不受影响（跨分类标签也能写入）；
 * - 开启时合法文章不受影响；冲突文章 400 且提示具体标签；
 * - 覆盖 create / update（含只改 category_id 不传 tags 的情况）。
 */

const admin = { username: "adminuser", role: "admin" } as AuthResult;

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
  return { API_PREFIX: "/api/v1", DB: makeD1(db) } as unknown as Env;
}

/**
 * 种子：分类 1 未分类 / 2 前端 / 3 后端；标签 Vue→前端(2)、Node→后端(3)；
 * 文章 101（前端、挂 Vue）。
 */
function seed(strictValue?: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT);
    CREATE TABLE site_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, description TEXT DEFAULT '');
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, category_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, slug TEXT UNIQUE, content TEXT DEFAULT '',
      content_html TEXT DEFAULT '', summary TEXT DEFAULT '', cover_image TEXT DEFAULT '',
      category_id INTEGER, author_id INTEGER, status TEXT DEFAULT 'draft',
      view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 1, published_at TEXT, created_at TEXT DEFAULT '2026-01-01', updated_at TEXT DEFAULT '2026-01-01'
    );
    CREATE TABLE article_tags (article_id INTEGER, tag_id INTEGER, PRIMARY KEY (article_id, tag_id));
    INSERT INTO users VALUES (1, 'adminuser', 'Admin');
    INSERT INTO categories VALUES (1, '未分类', 'uncategorized', ''), (2, '前端', 'frontend', ''), (3, '后端', 'backend', '');
    INSERT INTO tags (id, name, slug, category_id) VALUES (11, 'Vue', 'vue', 2), (12, 'Node', 'node', 3);
    INSERT INTO articles (id, title, slug, content, category_id, status, author_id) VALUES (101, '已有文章', 'existing', '正文', 2, 'published', 1);
    INSERT INTO article_tags VALUES (101, 11);
  `);
  if (strictValue !== undefined) {
    db.prepare(
      "INSERT INTO site_config (key, value) VALUES ('strict_tag_category_validation', ?)"
    ).run(strictValue);
  }
  return db;
}

async function createArticle(db: DatabaseSync, body: Record<string, unknown>) {
  const res = await handleCreateArticle(
    new Request("http://localhost/api/v1/articles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    makeEnv(db),
    {},
    admin
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

async function updateArticle(db: DatabaseSync, body: Record<string, unknown>) {
  const res = await handleUpdateArticle(
    new Request("http://localhost/api/v1/articles/101", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    makeEnv(db),
    // handleUpdateArticle 是 4 参签名（request, env, params, authResult），无 ctx
    { id: "101" },
    admin
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

describe("严格校验开关（#82，默认关）", () => {
  it("默认关闭（无配置行）：跨分类标签仍可写入（合法文章不受影响）", async () => {
    const db = seed();
    const { res } = await createArticle(db, {
      title: "T",
      content: "C",
      category_id: 2,
      tags: ["Node"], // Node 属于后端(3)，文章在前端(2) → 跨分类
      status: "draft",
    });
    expect(res.status).toBe(200);
    const row = db
      .prepare(
        "SELECT COUNT(*) n FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE t.name = 'Node'"
      )
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("关闭（value='0'）：显式关也是放行", async () => {
    const db = seed("0");
    const { res } = await createArticle(db, {
      title: "T0",
      content: "C",
      category_id: 2,
      tags: ["Node"],
      status: "draft",
    });
    expect(res.status).toBe(200);
  });

  it("开启（value='1'）：create 冲突 → 400 且提示具体标签；合法标签正常创建", async () => {
    const db = seed("1");
    const conflict = await createArticle(db, {
      title: "T1",
      content: "C",
      category_id: 2,
      tags: ["Vue", "Node"], // Node 冲突
      status: "draft",
    });
    expect(conflict.res.status).toBe(400);
    expect(conflict.body.code).toBe(10002);
    expect(conflict.body.message).toContain("Node");
    expect(conflict.body.message).toContain("不属于文章分类");
    // 冲突时不落任何写
    expect(
      (
        db
          .prepare("SELECT COUNT(*) n FROM articles WHERE title = 'T1'")
          .get() as { n: number }
      ).n
    ).toBe(0);

    // 合法（标签 Vue 属于前端，文章在前端）→ 正常创建
    const ok = await createArticle(db, {
      title: "T2",
      content: "C",
      category_id: 2,
      tags: ["Vue"],
      status: "draft",
    });
    expect(ok.res.status).toBe(200);
  });

  it("开启：update 只改 category_id 不传 tags —— 库内现有标签与新分类冲突 → 400；改回一致分类 → 200", async () => {
    const db = seed("1");
    // 文章 101（前端）挂 Vue(前端)；只改分类到后端(3) → Vue 冲突
    const conflict = await updateArticle(db, { category_id: 3 });
    expect(conflict.res.status).toBe(400);
    expect(conflict.body.code).toBe(10002);
    expect(conflict.body.message).toContain("Vue");
    // 分类未被改写
    expect(
      (
        db
          .prepare("SELECT category_id c FROM articles WHERE id = 101")
          .get() as { c: number }
      ).c
    ).toBe(2);

    // 改到一致分类（前端）→ 正常
    const ok = await updateArticle(db, { category_id: 2 });
    expect(ok.res.status).toBe(200);
  });

  it("开启：update 显式传 tags —— 冲突标签 → 400 并提示；替换为一致标签 → 200", async () => {
    const db = seed("1");
    const conflict = await updateArticle(db, { tags: ["Node"] });
    expect(conflict.res.status).toBe(400);
    expect(conflict.body.message).toContain("Node");

    const ok = await updateArticle(db, { tags: ["Vue"] });
    expect(ok.res.status).toBe(200);
  });
});
