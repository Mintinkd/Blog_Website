import { describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #63：认证接口 `GET /articles/:id/edit` 的服务端契约。
 *
 * 覆盖工单测试清单：401 / 403 / 400 非法 id / 404 / owner / admin /
 * 返回正文 / 响应不含 content_html / 无统计写入 / 无 Set-Cookie，
 * 另加一条「与 /articles/:slug 不冲突」的对照。
 *
 * 期望值全部是手写字面量（文章行、标签、字段清单、错误码），不从被测实现
 * 反推（docs/agents/testing.md 行为锁约定）。D1 用按 SQL 分流的内存桩，
 * 记录每一条 prepare / run / batch：recordArticleView 的任何写库都会落到
 * run / batch，因此「零写库」就是把「不进入阅读统计」钉死的断言。
 * 401 / 403 / 400 / 404 走 router() 全链路鉴权接缝。
 */

const ARTICLE_ID = 7;
const ARTICLE_SLUG = "edit-detail-fixture";
const JWT_SECRET = "issue63-edit-detail-test-secret";

/** 手写字面量：D1 里那一行文章。content_html 故意非空，用来证明响应不带它 */
const ROW = {
  id: ARTICLE_ID,
  title: "编辑器取数标题",
  slug: ARTICLE_SLUG,
  content: "# 一级标题\n\n编辑器需要原始 Markdown 正文",
  content_html: "<h1>历史遗留 HTML</h1>",
  summary: "摘要文本",
  cover_image: "/api/v1/media/serve/cover.png",
  category_id: 3,
  category_name: "技术",
  category_slug: "tech",
  status: "published",
  view_count: 42,
  like_count: 1,
  comment_count: 2,
  author_id: 2,
  author_name: "作者",
  published_at: "2026-11-01T00:00:00.000Z",
  created_at: "2026-10-31T00:00:00.000Z",
  updated_at: "2026-11-10T08:00:00.000Z",
};

const TAGS = [{ id: 11, name: "Astro", slug: "astro" }];

/** 手写字面量：ArticleEditDetail 的完整字段清单（含排序，不含 content_html） */
const EXPECTED_EDIT_DETAIL_KEYS = [
  "author_id",
  "category",
  "category_id",
  "content",
  "cover_image",
  "created_at",
  "id",
  "slug",
  "status",
  "summary",
  "tags",
  "title",
  "updated_at",
];

const USER_IDS: Record<string, number> = {
  adminuser: 1,
  owneruser: 2,
  otheruser: 9,
};

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

interface Statement {
  sql: string;
  binds: unknown[];
}

interface State {
  exists: boolean;
  status: "published" | "draft";
  authorId: number | null;
  authUser?: { username: string; role: "admin" | "editor" };
  statements: Statement[];
  writes: string[];
  batches: string[][];
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    exists: true,
    status: "published",
    authorId: 2,
    statements: [],
    writes: [],
    batches: [],
    ...overrides,
  };
}

interface FakeStatement {
  sql: string;
  binds: unknown[];
  bind(...args: unknown[]): FakeStatement;
  first<T = unknown>(): Promise<T | null>;
  all(): Promise<{ results: unknown[] }>;
  run(): Promise<{
    success: boolean;
    meta: { changes: number; last_row_id: number };
  }>;
}

function makeEnv(state: State): Env {
  const prepare = (sql: string): FakeStatement => {
    const stmt: FakeStatement = {
      sql,
      binds: [],
      bind(...args: unknown[]) {
        stmt.binds = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        state.statements.push({ sql, binds: stmt.binds });
        if (
          sql.includes("SELECT value FROM site_config WHERE key = 'jwt_secret'")
        ) {
          return { value: JWT_SECRET } as T;
        }
        if (sql.includes("SELECT role, must_change_password FROM users")) {
          return state.authUser
            ? ({ role: state.authUser.role, must_change_password: 0 } as T)
            : null;
        }
        if (sql.includes("SELECT id FROM users WHERE username = ?")) {
          return { id: USER_IDS[String(stmt.binds[0])] ?? null } as T;
        }
        if (sql.includes("SELECT author_id FROM articles WHERE id = ?")) {
          return state.exists ? ({ author_id: state.authorId } as T) : null;
        }
        if (sql.includes("FROM articles a")) {
          return state.exists ? ({ ...ROW, status: state.status } as T) : null;
        }
        return null;
      },
      async all() {
        state.statements.push({ sql, binds: stmt.binds });
        if (sql.includes("FROM tags t")) return { results: TAGS };
        return { results: [] };
      },
      async run() {
        state.statements.push({ sql, binds: stmt.binds });
        state.writes.push(sql);
        return {
          success: true,
          meta: { changes: 1, last_row_id: ARTICLE_ID },
        };
      },
    };
    return stmt;
  };

  const db = {
    prepare,
    async batch(statements: FakeStatement[]) {
      state.batches.push(statements.map((item) => item.sql));
      return [];
    },
  };

  return {
    API_PREFIX: "/api/v1",
    DB: db,
    RATE_LIMIT: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
  } as unknown as Env;
}

interface ApiBody {
  code: number;
  message: string;
  data: Record<string, unknown> | null;
}

function editRequest(
  id: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://api.example.test/api/v1/articles/${id}/edit`, {
    headers,
  });
}

async function bearer(username: string): Promise<string> {
  return `Bearer ${await generateToken(username, JWT_SECRET)}`;
}

async function callEdit(
  state: State,
  id: string,
  username?: string
): Promise<Response> {
  const headers = username
    ? { Authorization: await bearer(username) }
    : undefined;
  return router(editRequest(id, headers), makeEnv(state), CTX);
}

async function readData(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as ApiBody;
  expect(body.code).toBe(0);
  if (!body.data) throw new Error("Expected data in response");
  return body.data;
}

describe("issue #63：鉴权与错误语义（router 全链路）", () => {
  it("无 token → 401，且完全不查文章", async () => {
    const state = makeState();
    const response = await callEdit(state, String(ARTICLE_ID));

    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiBody).code).toBe(10003);
    expect(
      state.statements.filter((item) => item.sql.includes("FROM articles a"))
    ).toHaveLength(0);
  });

  it("无效 token → 401", async () => {
    const state = makeState();
    const response = await router(
      editRequest(String(ARTICLE_ID), { Authorization: "Bearer not-a-token" }),
      makeEnv(state),
      CTX
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiBody).code).toBe(10003);
  });

  it.each(["abc", "0", "-1", "1.5", "01", "1e3", "99999999999999999999", " 7"])(
    "非法 id %j → 400，且不查文章",
    async (id) => {
      const state = makeState({
        authUser: { username: "adminuser", role: "admin" },
      });
      const response = await callEdit(
        state,
        encodeURIComponent(id),
        "adminuser"
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiBody).code).toBe(10001);
      expect(
        state.statements.filter((item) => item.sql.includes("FROM articles a"))
      ).toHaveLength(0);
    }
  );

  it("文章不存在 → 404（admin）", async () => {
    const state = makeState({
      exists: false,
      authUser: { username: "adminuser", role: "admin" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "adminuser");

    expect(response.status).toBe(404);
    const body = (await response.json()) as ApiBody;
    expect(body.code).toBe(10005);
    expect(body.data).toBeNull();
  });

  it("editor 读他人文章 → 403，且不返回正文", async () => {
    const state = makeState({
      authorId: 2,
      authUser: { username: "otheruser", role: "editor" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "otheruser");

    expect(response.status).toBe(403);
    const body = (await response.json()) as ApiBody;
    expect(body.code).toBe(10004);
    expect(body.data).toBeNull();
  });
});

describe("issue #63：读取权限与响应形状", () => {
  it("owner（editor 读自己的）→ 200 且返回原始 Markdown 正文", async () => {
    const state = makeState({
      authorId: 2,
      authUser: { username: "owneruser", role: "editor" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "owneruser");

    expect(response.status).toBe(200);
    const data = await readData(response);
    expect(data.content).toBe(ROW.content);
    expect(data.id).toBe(ARTICLE_ID);
    expect(data.slug).toBe(ARTICLE_SLUG);
  });

  it("admin 可读他人文章 → 200 且返回正文", async () => {
    const state = makeState({
      authorId: 2,
      authUser: { username: "adminuser", role: "admin" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "adminuser");

    expect(response.status).toBe(200);
    expect((await readData(response)).content).toBe(ROW.content);
  });

  it("草稿也可按 id 读取（编辑器不受 published 过滤限制）", async () => {
    const state = makeState({
      status: "draft",
      authorId: 2,
      authUser: { username: "owneruser", role: "editor" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "owneruser");

    expect(response.status).toBe(200);
    const data = await readData(response);
    expect(data.status).toBe("draft");
    expect(data.content).toBe(ROW.content);
  });

  it("响应字段清单与 PUT 请求体对齐，且不含 content_html / 统计字段", async () => {
    const state = makeState({
      authUser: { username: "adminuser", role: "admin" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "adminuser");
    const data = await readData(response);

    expect(Object.keys(data).sort()).toEqual(EXPECTED_EDIT_DETAIL_KEYS);
    expect(data).not.toHaveProperty("content_html");
    expect(data).not.toHaveProperty("view_count");
    expect(data).not.toHaveProperty("reading_time");
  });

  it("status / tags / category / category_id / updated_at 值正确", async () => {
    const state = makeState({
      authUser: { username: "adminuser", role: "admin" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "adminuser");
    const data = await readData(response);

    expect(data.status).toBe("published");
    expect(data.tags).toEqual([{ id: 11, name: "Astro", slug: "astro" }]);
    expect(data.category).toEqual({ id: 3, name: "技术", slug: "tech" });
    expect(data.category_id).toBe(3);
    expect(data.updated_at).toBe("2026-11-10T08:00:00.000Z");
    expect(data.title).toBe("编辑器取数标题");
    expect(data.summary).toBe("摘要文本");
    expect(data.cover_image).toBe("/api/v1/media/serve/cover.png");
  });
});

describe("issue #63：无统计副作用 / 无 Cookie / 路由不冲突", () => {
  it("新接口零写库、无 analytics SQL、无 view_count 更新、无 Set-Cookie", async () => {
    const state = makeState({
      authorId: 2,
      authUser: { username: "owneruser", role: "editor" },
    });
    const response = await callEdit(state, String(ARTICLE_ID), "owneruser");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(state.writes).toEqual([]);
    expect(state.batches).toEqual([]);
    expect(
      state.statements.filter((item) => /analytics_|view_count/i.test(item.sql))
    ).toEqual([]);
    // 全部是只读查询
    expect(
      state.statements.every((item) => /^\s*SELECT/.test(item.sql.trim()))
    ).toBe(true);
  });

  it("对照：/articles/:slug 仍走公开详情（含 content_html + view Cookie），新接口不走", async () => {
    const state = makeState({
      authUser: { username: "adminuser", role: "admin" },
    });
    const env = makeEnv(state);

    // 无 X-Real-IP + Sec-Purpose: prefetch → 命中 §4.1 bot 过滤，不产生写库
    const publicResponse = await router(
      new Request(`https://api.example.test/api/v1/articles/${ARTICLE_SLUG}`, {
        headers: { "sec-purpose": "prefetch" },
      }),
      env,
      CTX
    );
    expect(publicResponse.status).toBe(200);
    const publicBody = (await publicResponse.json()) as ApiBody;
    expect(publicBody.data).toHaveProperty("content_html");
    expect(publicResponse.headers.get("set-cookie")).toContain(
      `view_${ARTICLE_ID}=1`
    );
    expect(state.writes).toEqual([]);

    const editResponse = await router(
      editRequest(String(ARTICLE_ID), {
        Authorization: await bearer("adminuser"),
      }),
      env,
      CTX
    );
    expect(editResponse.status).toBe(200);
    const editBody = (await editResponse.json()) as ApiBody;
    expect(editBody.data).not.toHaveProperty("content_html");
    expect(editBody.data).toHaveProperty("updated_at");
    expect(editResponse.headers.get("set-cookie")).toBeNull();
  });
});
