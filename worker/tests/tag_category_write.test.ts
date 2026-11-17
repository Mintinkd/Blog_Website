// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { AuthResult } from "../src/middleware/auth";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { handleCreateTag, handleUpdateTag } from "../src/handlers/tag";
import { handleDeleteCategory } from "../src/handlers/category";
import type { Env } from "../src/index";

/**
 * issue #79 / T3：标签写 API、分类删除保护（taxonomy v2 / ADR 0008 决策 1、5）。
 *
 * 接缝：handleCreateTag / handleUpdateTag / handleDeleteCategory + node:sqlite
 * 真实 D1 适配桩（SQL 真实执行）。
 *
 * 票面验收：
 * - 旧 POST /tags 不带 category 仍成功，落到未分类；
 * - 新 POST 带非法 category → 400；带合法 category → 正确归属；
 * - PUT 移动成功；越权 403；非法 category 400；name / slug 不变；
 * - 分类有标签时 DELETE 400；无标签无文章时 200。
 */

const CTX = {} as ExecutionContext;

/** node:sqlite → D1 最小适配（与 tag_category_read.test.ts 同款） */
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

const auth = (username: string, role: "admin" | "editor"): AuthResult =>
  ({ username, role }) as AuthResult;

/**
 * 种子：admin(1)；alice(2, editor, 拥有「前端」)；bob(3, editor, 拥有「后端」)；eve(4, editor, 无所有物)。
 * 分类：1 未分类(无主) / 2 前端(alice) / 3 后端(bob) / 4 空分类(无主)。
 * 标签：11 Vue(created_by=alice, 归前端)；12 旧标签(无主、无归属——迁移期遗留形态)。
 */
function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT);
    CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, description TEXT DEFAULT '', created_by INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT, category_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, category_id INTEGER, status TEXT DEFAULT 'draft');
    INSERT INTO users VALUES (1, 'adminuser', 'admin'), (2, 'alice', 'editor'), (3, 'bob', 'editor'), (4, 'eve', 'editor');
    INSERT INTO categories (id, name, slug, created_by) VALUES
      (1, '未分类', 'uncategorized', NULL), (2, '前端', 'frontend', 2), (3, '后端', 'backend', 3), (4, '空分类', 'empty-cat', NULL);
    INSERT INTO tags (id, name, slug, category_id, created_by) VALUES (11, 'Vue', 'vue', 2, 2), (12, '旧标签', 'legacy-tag', NULL, NULL), (13, '杂项', 'misc', 1, NULL);
  `);
  return db;
}

async function createTag(
  db: DatabaseSync,
  body: Record<string, unknown>,
  user?: AuthResult
) {
  const res = await handleCreateTag(
    new Request("http://localhost/api/v1/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    makeEnv(db),
    CTX,
    {},
    user
  );
  return {
    res,
    body: (await res.json()) as {
      code: number;
      message: string;
      data: Record<string, unknown> | null;
    },
  };
}

async function updateTag(
  db: DatabaseSync,
  id: string,
  body: Record<string, unknown>,
  user?: AuthResult
) {
  const res = await handleUpdateTag(
    new Request(`http://localhost/api/v1/tags/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    makeEnv(db),
    CTX,
    { id },
    user
  );
  return {
    res,
    body: (await res.json()) as {
      code: number;
      message: string;
      data: Record<string, unknown> | null;
    },
  };
}

const tagRow = (db: DatabaseSync, id: number) =>
  db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as {
    id: number;
    name: string;
    slug: string;
    category_id: number | null;
    created_by: number | null;
  };

describe("POST /tags 的归属处理（#79）", () => {
  it("旧请求体 {name, slug} 不带 category：仍成功，落到未分类（uncategorized 种子行）", async () => {
    const db = seed();
    const { res, body } = await createTag(
      db,
      { name: "新标签", slug: "new-tag" },
      auth("alice", "editor")
    );
    expect(res.status).toBe(200);
    const created = tagRow(db, body.data!.id as number);
    expect(created.category_id).toBe(1); // 未分类
    expect(created.created_by).toBe(2);
  });

  it("带合法 category：editor 归属到自己拥有的分类 → 正确落库；admin 可归属任意分类", async () => {
    const db = seed();
    const alice = await createTag(
      db,
      { name: "FE", slug: "fe", category_id: 2 },
      auth("alice", "editor")
    );
    expect(alice.res.status).toBe(200);
    expect(tagRow(db, alice.body.data!.id as number).category_id).toBe(2);

    const admin = await createTag(
      db,
      { name: "BE", slug: "be", category_id: 3 },
      auth("adminuser", "admin")
    );
    expect(admin.res.status).toBe(200);
    expect(tagRow(db, admin.body.data!.id as number).category_id).toBe(3);
  });

  it("editor 带自己不拥有的分类 → 403；分类不存在 → 400；非法 category_id 值 → 400", async () => {
    const db = seed();
    const forbiddenRes = await createTag(
      db,
      { name: "X1", slug: "x1", category_id: 3 },
      auth("alice", "editor")
    );
    expect(forbiddenRes.res.status).toBe(403);
    expect(forbiddenRes.body.code).toBe(10004);

    const missing = await createTag(
      db,
      { name: "X2", slug: "x2", category_id: 999 },
      auth("adminuser", "admin")
    );
    expect(missing.res.status).toBe(400);
    expect(missing.body.code).toBe(10002);

    for (const [i, bad] of ["abc", 0, -1, 1.5].entries()) {
      // slug 用序号，避免 "-1" 生成双连字符踩 slug 格式校验（与本用例无关的 400）
      const res = await createTag(
        db,
        { name: `X3-${i}`, slug: `x3-${i}`, category_id: bad },
        auth("adminuser", "admin")
      );
      expect(res.res.status, `category_id=${bad} 应 400`).toBe(400);
      expect(res.body.code, `category_id=${bad} 应 PARAM_ERROR`).toBe(10001);
    }
  });
});

describe("PUT /tags/:id 仅移动归属（#79）", () => {
  it("标签创建者可移动；name / slug 不变；只消费 category_id", async () => {
    const db = seed();
    const { res, body } = await updateTag(
      db,
      "11",
      { category_id: 3, name: "改名企图", slug: "rename-attempt" },
      auth("alice", "editor")
    );
    expect(res.status).toBe(200);
    const row = tagRow(db, 11);
    expect(row.category_id).toBe(3);
    expect(body.data).toMatchObject({ id: 11, category_id: 3 });
    // name / slug 刻意不变（首批不改名，ADR 0008 决策 3）
    expect(row.name).toBe("Vue");
    expect(row.slug).toBe("vue");
  });

  it("目标分类所有者可把别人的标签移进自己的分类", async () => {
    const db = seed();
    const { res } = await updateTag(
      db,
      "11",
      { category_id: 3 },
      auth("bob", "editor")
    );
    expect(res.status).toBe(200);
    expect(tagRow(db, 11).category_id).toBe(3);
  });

  it("无关 editor 越权 403（既非创建者，也不拥有目标分类）", async () => {
    const db = seed();
    const { res, body } = await updateTag(
      db,
      "11",
      { category_id: 3 },
      auth("eve", "editor")
    );
    expect(res.status).toBe(403);
    expect(body.code).toBe(10004);
    expect(tagRow(db, 11).category_id).toBe(2); // 未被移动
  });

  it("无主（迁移期遗留）标签：admin 可移动，无关 editor 一律 403", async () => {
    const db = seed();
    const admin = await updateTag(
      db,
      "12",
      { category_id: 3 },
      auth("adminuser", "admin")
    );
    expect(admin.res.status).toBe(200);
    expect(tagRow(db, 12).category_id).toBe(3);

    const db2 = seed();
    const eve = await updateTag(
      db2,
      "12",
      { category_id: 3 },
      auth("eve", "editor")
    );
    expect(eve.res.status).toBe(403);
    expect(tagRow(db2, 12).category_id).toBeNull();
  });

  it("非法请求：缺 category_id / 非法值 → 400；分类不存在 → 400；标签不存在 → 404", async () => {
    const db = seed();
    const noBody = await updateTag(db, "11", {}, auth("adminuser", "admin"));
    expect(noBody.res.status).toBe(400);
    expect(noBody.body.code).toBe(10001);

    for (const bad of ["abc", 0, -1]) {
      const res = await updateTag(
        db,
        "11",
        { category_id: bad },
        auth("adminuser", "admin")
      );
      expect(res.res.status, `category_id=${bad} 应 400`).toBe(400);
    }

    const missingCat = await updateTag(
      db,
      "11",
      { category_id: 999 },
      auth("adminuser", "admin")
    );
    expect(missingCat.res.status).toBe(400);
    expect(missingCat.body.code).toBe(10002);

    const missingTag = await updateTag(
      db,
      "999",
      { category_id: 2 },
      auth("adminuser", "admin")
    );
    expect(missingTag.res.status).toBe(404);
    expect(missingTag.body.code).toBe(10005);
  });
});

describe("DELETE /categories/:id 的标签保护（#79）", () => {
  async function deleteCategory(db: DatabaseSync, id: string) {
    const res = await handleDeleteCategory(
      new Request(`http://localhost/api/v1/categories/${id}`, {
        method: "DELETE",
      }),
      makeEnv(db),
      { id }
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

  it("分类名下仍有标签 → 400，提示先移动或批量移到未分类", async () => {
    const db = seed();
    const { res, body } = await deleteCategory(db, "2");
    expect(res.status).toBe(400);
    expect(body.code).toBe(10002);
    expect(body.message).toContain("1 tags");
    expect(body.message).toContain("uncategorized");
    // 未分类（无主种子分类）同样受保护——有标签就不能删
    const unc = await deleteCategory(db, "1");
    expect(unc.res.status).toBe(400);
  });

  it("无标签无文章的分类 → 200 正常删除", async () => {
    const db = seed();
    const { res } = await deleteCategory(db, "4");
    expect(res.status).toBe(200);
    expect(
      db.prepare("SELECT COUNT(*) n FROM categories WHERE id = 4").get()
    ).toEqual({ n: 0 });
  });
});
