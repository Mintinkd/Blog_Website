import { describe, expect, it } from "vitest";
import { handleGetArticle } from "../src/handlers/article";
import type { Env } from "../src/index";

/**
 * #40：`GET /articles/:slug` 的阅读量契约（SSR 只负责转发 Cookie，不改变计数）。
 *
 * 接缝：handler + 真实 service，D1 用记录 prepare/bind 顺序的桩。
 * 断言外部可观察行为：Set-Cookie 属性、同 Cookie 不重复计数、其他 Cookie 不影响去重。
 */

const VIEW_COOKIE = "view_7=1; Path=/; Max-Age=86400; SameSite=Lax";

const articleRow = {
  id: 7,
  title: "服务端渲染",
  slug: "ssr",
  content: "正文",
  content_html: "",
  summary: "摘要",
  cover_image: "",
  category_id: null,
  category_name: null,
  category_slug: null,
  status: "published",
  view_count: 1,
  like_count: 0,
  comment_count: 0,
  author_id: null,
  author_name: null,
  published_at: "2026-10-22T00:00:00.000Z",
  created_at: "2026-10-22T00:00:00.000Z",
};

interface Statement {
  sql: string;
  binds: unknown[];
}

function makeEnv(): { env: Env; statements: Statement[] } {
  const statements: Statement[] = [];
  const prepare = (sql: string) => {
    const statement: Statement = { sql, binds: [] };
    statements.push(statement);
    const api = {
      bind: (...binds: unknown[]) => {
        statement.binds = binds;
        return api;
      },
      first: () =>
        Promise.resolve(sql.includes("FROM articles a") ? articleRow : null),
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
    };
    return api;
  };

  return { env: { DB: { prepare } } as unknown as Env, statements };
}

function incrementCount(statements: Statement[]): number {
  return statements.filter((s) =>
    s.sql.startsWith("UPDATE articles SET view_count = view_count + 1")
  ).length;
}

async function visit(env: Env, cookie?: string): Promise<Response> {
  const headers = cookie ? { cookie } : undefined;
  return handleGetArticle(
    new Request("https://api.example.test/api/v1/articles/ssr", { headers }),
    env,
    { slug: "ssr" }
  );
}

describe("文章阅读量 Cookie", () => {
  it("同一 Cookie 连续访问只计一次；无 Cookie 的新访客计一次并收到 24 小时 Cookie", async () => {
    const { env, statements } = makeEnv();

    const first = await visit(env);
    const second = await visit(env, "view_7=1");
    const otherCookie = await visit(env, "theme=dark");

    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBe(VIEW_COOKIE);
    expect(second.status).toBe(200);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(otherCookie.headers.get("set-cookie")).toBe(VIEW_COOKIE);
    expect(incrementCount(statements)).toBe(2);
  });

  it("Cookie 去重按文章 id 隔离：其他文章的 view Cookie 不影响本文章", async () => {
    const { env, statements } = makeEnv();

    await visit(env, "view_8=1");

    expect(incrementCount(statements)).toBe(1);
  });
});
