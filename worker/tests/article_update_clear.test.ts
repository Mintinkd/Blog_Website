import { describe, expect, it, vi } from "vitest";
import { handleUpdateArticle } from "../src/handlers/article";
import { generateToken } from "../src/middleware/auth";
import { router } from "../src/router";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";

/**
 * issue #70（T2b）：`PUT /articles/:id` 的空字符串清空语义。
 *
 * 契约：字段存在即写入，`""` 表示清空；字段缺失才保持原值。
 * title / slug / status / category_id / tags 的既有校验与语义不变。
 *
 * 期望值全部是手写字面量（初始行、完整 UPDATE SQL、bind 值），不从被测实现
 * 反推；D1 用按 SQL 语义落库的有状态内存桩，覆盖 handler → updateArticle →
 * getArticleBySlug → 响应的完整链路。401 / 403 走 router() 全链路鉴权接缝
 * （工单测试清单点名，见 docs/agents/testing.md）。
 */

const ARTICLE_ID = 7;
const ARTICLE_SLUG = "clear-fields-fixture";
const JWT_SECRET = "issue70-put-clear-test-secret";

/** 手写字面量：更新前的文章状态 */
const INITIAL = {
  title: "原始标题",
  content: "# 原始正文\n\n第二段",
  summary: "原始摘要",
  cover_image: "/api/v1/media/serve/cover.png",
  status: "draft" as const,
  author_id: 1,
};

const ADMIN: AuthResult = {
  username: "adminuser",
  role: "admin",
  mustChangePassword: false,
};

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

interface ArticleRow {
  id: number;
  title: string;
  slug: string;
  content: string;
  content_html: string;
  summary: string;
  cover_image: string;
  category_id: number | null;
  status: "draft" | "published";
  author_id: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
}

interface Statement {
  sql: string;
  binds: unknown[];
}

interface State {
  article: ArticleRow;
  statements: Statement[];
  /** router 全链路鉴权时的用户行（editor 的 id 固定为 2，与 author_id=1 不同） */
  authUser?: { username: string; role: "admin" | "editor" };
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    article: {
      id: ARTICLE_ID,
      title: INITIAL.title,
      slug: ARTICLE_SLUG,
      content: INITIAL.content,
      content_html: "",
      summary: INITIAL.summary,
      cover_image: INITIAL.cover_image,
      category_id: null,
      status: INITIAL.status,
      author_id: INITIAL.author_id,
      published_at: null,
      created_at: "2026-10-22T00:00:00.000Z",
      updated_at: "2026-10-22T00:00:00.000Z",
      view_count: 0,
      like_count: 0,
      comment_count: 0,
    },
    statements: [],
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

/** 按 UPDATE 的 SET 子句列名与 bind 顺序落库；SQL 改写法时测试必须跟着失败 */
function applyUpdate(state: State, sql: string, binds: unknown[]): void {
  const setClause = sql.slice(
    "UPDATE articles SET ".length,
    sql.indexOf(" WHERE id = ?")
  );
  const columns = setClause.split(", ").map((part) => part.split(" = ")[0]);
  if (columns.length !== binds.length - 1) {
    throw new Error(`Unexpected UPDATE binding count: ${sql}`);
  }
  const row = state.article as unknown as Record<string, unknown>;
  for (const [index, column] of columns.entries()) {
    if (!(column in row)) {
      throw new Error(`Unexpected UPDATE column: ${column}`);
    }
    row[column] = binds[index];
  }
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
          return { id: 2 } as T;
        }
        if (sql.includes("SELECT author_id FROM articles WHERE id = ?")) {
          return { author_id: state.article.author_id } as T;
        }
        if (sql.includes("SELECT * FROM articles WHERE id = ?")) {
          return { ...state.article } as T;
        }
        if (sql.includes("SELECT slug FROM articles WHERE id = ?")) {
          return { slug: state.article.slug } as T;
        }
        if (
          sql.includes("FROM articles a") &&
          sql.includes("WHERE a.slug = ?")
        ) {
          return {
            ...state.article,
            category_id: null,
            category_name: null,
            category_slug: null,
            author_name: null,
          } as T;
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        state.statements.push({ sql, binds: stmt.binds });
        if (sql.startsWith("UPDATE articles SET ")) {
          applyUpdate(state, sql, stmt.binds);
        }
        return {
          success: true,
          meta: { changes: 1, last_row_id: ARTICLE_ID },
        };
      },
    };
    return stmt;
  };

  return {
    API_PREFIX: "/api/v1",
    DB: { prepare },
    RATE_LIMIT: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
  } as unknown as Env;
}

interface ArticlePayload {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary: string;
  cover_image: string;
  status: string;
}

interface ApiBody {
  code: number;
  message: string;
  data: ArticlePayload;
}

function putRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://api.example.test/api/v1/articles/${ARTICLE_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function putAsAdmin(
  body: Record<string, unknown>,
  state: State = makeState()
): Promise<{ response: Response; state: State }> {
  const response = await handleUpdateArticle(
    putRequest(body),
    makeEnv(state),
    { id: String(ARTICLE_ID) },
    ADMIN
  );
  return { response, state };
}

function updateStatement(state: State): Statement {
  const statement = state.statements.find((item) =>
    item.sql.startsWith("UPDATE articles SET ")
  );
  if (!statement) throw new Error("No UPDATE statement recorded");
  return statement;
}

async function readArticle(response: Response): Promise<ArticlePayload> {
  const body = (await response.json()) as ApiBody;
  expect(body.code).toBe(0);
  return body.data;
}

describe("issue #70：空字符串清空正文 / 摘要 / 封面", () => {
  it('content: "" 清空正文并返回空正文，其余字段保持原值', async () => {
    const { response, state } = await putAsAdmin({ content: "" });

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.content).toBe("");
    expect(article.summary).toBe(INITIAL.summary);
    expect(article.cover_image).toBe(INITIAL.cover_image);
    expect(article.title).toBe(INITIAL.title);

    const update = updateStatement(state);
    expect(update.sql).toBe(
      "UPDATE articles SET content = ?, updated_at = ? WHERE id = ?"
    );
    expect(update.binds[0]).toBe("");
    expect(update.binds[2]).toBe(ARTICLE_ID);
  });

  it('summary: "" 清空摘要', async () => {
    const { response, state } = await putAsAdmin({ summary: "" });

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.summary).toBe("");
    expect(article.content).toBe(INITIAL.content);

    const update = updateStatement(state);
    expect(update.sql).toBe(
      "UPDATE articles SET summary = ?, updated_at = ? WHERE id = ?"
    );
    expect(update.binds[0]).toBe("");
  });

  it('cover_image: "" 清空封面', async () => {
    const { response, state } = await putAsAdmin({ cover_image: "" });

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.cover_image).toBe("");
    expect(article.content).toBe(INITIAL.content);

    const update = updateStatement(state);
    expect(update.sql).toBe(
      "UPDATE articles SET cover_image = ?, updated_at = ? WHERE id = ?"
    );
    expect(update.binds[0]).toBe("");
  });

  it('三个字段同时传 "" 一起清空', async () => {
    const { response, state } = await putAsAdmin({
      content: "",
      summary: "",
      cover_image: "",
    });

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.content).toBe("");
    expect(article.summary).toBe("");
    expect(article.cover_image).toBe("");

    const update = updateStatement(state);
    expect(update.sql).toBe(
      "UPDATE articles SET content = ?, summary = ?, cover_image = ?, updated_at = ? WHERE id = ?"
    );
    expect(update.binds.slice(0, 3)).toEqual(["", "", ""]);
  });

  it("非空值仍按原语义写入（清空修复不破坏普通更新）", async () => {
    const { response, state } = await putAsAdmin({ content: "新正文" });

    expect(response.status).toBe(200);
    expect((await readArticle(response)).content).toBe("新正文");
    expect(updateStatement(state).binds[0]).toBe("新正文");
  });
});

describe("issue #70：未传字段保持原值 / 既有语义不变", () => {
  it("空请求体只写 updated_at，正文 / 摘要 / 封面 / 标题全部保持原值", async () => {
    const { response, state } = await putAsAdmin({});

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.content).toBe(INITIAL.content);
    expect(article.summary).toBe(INITIAL.summary);
    expect(article.cover_image).toBe(INITIAL.cover_image);
    expect(article.title).toBe(INITIAL.title);
    expect(article.slug).toBe(ARTICLE_SLUG);
    expect(article.status).toBe("draft");
    expect(updateStatement(state).sql).toBe(
      "UPDATE articles SET updated_at = ? WHERE id = ?"
    );
  });

  it("只更新标题时，三个文本字段不出现在 SET 子句中", async () => {
    const { response, state } = await putAsAdmin({ title: "新标题" });

    expect(response.status).toBe(200);
    const article = await readArticle(response);
    expect(article.title).toBe("新标题");
    expect(article.content).toBe(INITIAL.content);
    expect(article.summary).toBe(INITIAL.summary);
    expect(article.cover_image).toBe(INITIAL.cover_image);
    expect(updateStatement(state).sql).toBe(
      "UPDATE articles SET title = ?, updated_at = ? WHERE id = ?"
    );
  });

  it("空标题仍被拒绝写入：保持原值，SET 子句不含 title", async () => {
    // PUT 既有实现不对 title 做 400 校验（工单要求「校验与语义不变」）：
    // 空标题按「未提供」跳过写入，即「拒绝把空标题落库」。
    const { response, state } = await putAsAdmin({ title: "" });

    expect(response.status).toBe(200);
    expect((await readArticle(response)).title).toBe(INITIAL.title);
    expect(updateStatement(state).sql).toBe(
      "UPDATE articles SET updated_at = ? WHERE id = ?"
    );
  });
});

describe("issue #70：既有权限行为不变", () => {
  it("无 token 的 PUT 返回 401，且不写库", async () => {
    const state = makeState();
    const response = await router(
      putRequest({ content: "" }),
      makeEnv(state),
      CTX
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as ApiBody).code).toBe(10003);
    expect(
      state.statements.filter((item) =>
        item.sql.startsWith("UPDATE articles SET ")
      )
    ).toHaveLength(0);
  });

  it("editor 非 owner 的 PUT 返回 403，且不写库", async () => {
    const state = makeState({
      authUser: { username: "editoruser", role: "editor" },
    });
    const token = await generateToken("editoruser", JWT_SECRET);
    const response = await router(
      putRequest({ content: "" }, { Authorization: `Bearer ${token}` }),
      makeEnv(state),
      CTX
    );

    expect(response.status).toBe(403);
    expect(((await response.json()) as ApiBody).code).toBe(10004);
    expect(
      state.statements.filter((item) =>
        item.sql.startsWith("UPDATE articles SET ")
      )
    ).toHaveLength(0);
  });

  it("admin 经 router 全链路也能清空正文", async () => {
    const state = makeState({
      authUser: { username: "adminuser", role: "admin" },
    });
    const token = await generateToken("adminuser", JWT_SECRET);
    const response = await router(
      putRequest({ content: "" }, { Authorization: `Bearer ${token}` }),
      makeEnv(state),
      CTX
    );

    expect(response.status).toBe(200);
    expect((await readArticle(response)).content).toBe("");
    expect(updateStatement(state).binds[0]).toBe("");
  });
});
