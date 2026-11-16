import { describe, expect, it } from "vitest";
import { handleLikeStatus, handleToggleLike } from "../src/handlers/like";
import { matchRoute } from "../src/router";
import { ErrorCodes } from "../src/utils/response";
import type { Env } from "../src/index";

/**
 * issue #107 / L9：点赞端点的错误码语义。
 *
 * 接缝：handleToggleLike / handleLikeStatus —— 工单 Key interfaces 点名的 handler 分支；
 * 另有 router 接缝用于锁定「非数字 id 在路由层就不匹配」的既有裁定（#100 / M20）。
 *
 * 契约（本票定案，见关票评论）：
 * - 文章不存在 → 404 + ErrorCodes.NOT_FOUND（与其余接口一致，此前是 400）；
 * - 纯数字但违契约（0 / 前导零 / 超安全整数）→ 400 + PARAM_ERROR，且不查库
 *   （与 `article.ts` 的 `^[1-9]\d*$` 同口径）；
 * - 非数字 id → 路由 `:id` 分型不匹配（#100 裁定，改回 400 会推翻 M20 既有测试）。
 */

interface RecordedQuery {
  sql: string;
  binds: unknown[];
}

interface FakeDb {
  db: unknown;
  queries: () => RecordedQuery[];
}

/** 有记录能力的 D1 桩：articles 查询恒返回 null（文章不存在），like 查询不应发生。 */
function makeMissingArticleDb(): FakeDb {
  const queries: RecordedQuery[] = [];
  const makeStmt = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async first() {
        queries.push({ sql, binds: stmt.binds });
        return null;
      },
      async all() {
        queries.push({ sql, binds: stmt.binds });
        return { results: [] as unknown[] };
      },
      async run() {
        queries.push({ sql, binds: stmt.binds });
        return { success: true, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  return {
    db: {
      prepare: makeStmt,
      async batch(stmts: unknown[]) {
        return (stmts as unknown[]).map(() => ({
          success: true,
          meta: { changes: 0 },
        }));
      },
    },
    queries: () => [...queries],
  };
}

function makeEnv(db: unknown): Env {
  // #104 / L5：ip_hash 的盐来自服务端 secret，桩环境必须提供，否则 fail-closed。
  return { DB: db, IP_HASH_SECRET: "test-ip-hash-secret" } as unknown as Env;
}

function request(method: "POST" | "GET", id: string): Request {
  return new Request(`https://example.com/api/v1/articles/${id}/like`, {
    method,
    headers: { "CF-Connecting-IP": "203.0.113.7" },
  });
}

async function bodyOf(res: Response): Promise<{
  code: number;
  message: string;
  data: unknown;
}> {
  return (await res.json()) as {
    code: number;
    message: string;
    data: unknown;
  };
}

describe("点赞端点错误码（#107 / L9）", () => {
  it("文章不存在：toggle 返回 404 + NOT_FOUND，且未继续查询点赞记录", async () => {
    const fake = makeMissingArticleDb();
    const res = await handleToggleLike(
      request("POST", "999999"),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "999999" }
    );

    expect(res.status).toBe(404);
    const body = await bodyOf(res);
    expect(body.code).toBe(ErrorCodes.NOT_FOUND);
    expect(body.message).toBe("Article not found");
    expect(body.data).toBeNull();

    // 只发了一次文章存在性查询；没有落到 article_likes
    const sqls = fake.queries().map((q) => q.sql);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toMatch(/FROM articles\b/i);
    // 不回显 SQL / 表名之外的内部信息（错误消息固定）
    expect(body.message).not.toMatch(/article_likes|SELECT/i);
  });

  it.each(["0", "007", "99999999999999999999"])(
    "纯数字违契约 id %j：toggle 返回 400 + PARAM_ERROR，且不查库",
    async (id) => {
      const fake = makeMissingArticleDb();
      const res = await handleToggleLike(
        request("POST", id),
        makeEnv(fake.db),
        {} as ExecutionContext,
        { article_id: id }
      );

      expect(res.status).toBe(400);
      const body = await bodyOf(res);
      expect(body.code).toBe(ErrorCodes.PARAM_ERROR);
      expect(fake.queries()).toHaveLength(0);
    }
  );

  it.each(["0", "007"])(
    "纯数字违契约 id %j：status 返回同样的 400 口径",
    async (id) => {
      const fake = makeMissingArticleDb();
      const res = await handleLikeStatus(request("GET", id), makeEnv(fake.db), {
        article_id: id,
      });

      expect(res.status).toBe(400);
      const body = await bodyOf(res);
      expect(body.code).toBe(ErrorCodes.PARAM_ERROR);
      expect(fake.queries()).toHaveLength(0);
    }
  );

  it("非数字 id 由路由层拦截：`:id` 编译为 \\d+ 后不匹配（#100 / M20 既有裁定）", () => {
    expect(matchRoute("POST", "/articles/abc/like")).toBeNull();
    expect(matchRoute("GET", "/articles/abc/like")).toBeNull();
    // 合法数字 id 仍匹配，参数解码为字符串
    const matched = matchRoute("POST", "/articles/42/like");
    expect(matched?.params.article_id).toBe("42");
  });
});
