import { describe, expect, it } from "vitest";
import { handleToggleLike } from "../src/handlers/like";
import type { Env } from "../src/index";

/**
 * issue #72 / M9：点赞「记录写入 + 计数更新」原子化。
 *
 * 接缝：handleToggleLike —— 工单 Key interfaces 点名的 handler 接缝（D1 batch 出口）。
 *
 * 桩为有状态的 in-memory D1：likes 集合是「点赞记录」的独立真值源，likeCount 是
 * articles.like_count（被测代码维护）。batch 成功才把语句应用到状态，失败则整批不应用
 * （回滚）。这样断言 likeCount === likes.size 时，期望值来自独立来源（记录行数），
 * 而非被测代码自己写入的计数字段。
 */

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

interface FakeOptions {
  /** 初始是否已有当前 IP 的点赞记录（决定点赞 / 取消分支）。 */
  existingLike?: boolean;
  /** 模拟 batch 中 UPDATE 失败；桩整批不应用（回滚语义）。 */
  failBatch?: boolean;
}

interface FakeState {
  /** 真值：当前已点赞的 ip_hash 集合。 */
  likes: Set<string>;
  /** 被测值：articles.like_count。 */
  likeCount: number;
}

function makeD1(opts: FakeOptions = {}): {
  db: unknown;
  batchCalls: () => number;
  batchStatements: () => RecordedStatement[];
  directRuns: () => RecordedStatement[];
  state: () => FakeState;
} {
  const pendingInBatch: RecordedStatement[] = [];
  const directRunStatements: RecordedStatement[] = [];
  let batchCount = 0;
  const state: FakeState = {
    likes: new Set(),
    likeCount: opts.existingLike ? 1 : 0,
  };

  /** 把一条已提交的写语句应用到内存状态（模拟 D1 执行）。 */
  const applyWrite = (sql: string, binds: unknown[]): void => {
    if (/DELETE FROM article_likes/i.test(sql)) {
      state.likes.delete(String(binds[1]));
    } else if (/INSERT INTO article_likes/i.test(sql)) {
      state.likes.add(String(binds[1]));
    } else if (/UPDATE articles SET like_count = like_count - 1/i.test(sql)) {
      state.likeCount -= 1;
    } else if (/UPDATE articles SET like_count = like_count \+ 1/i.test(sql)) {
      state.likeCount += 1;
    }
  };

  const makeStmt = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async run() {
        // 单条 run 是「绕过 batch」的路径：也算应用，供 directRuns 断言捕获。
        directRunStatements.push({ sql, binds: stmt.binds });
        applyWrite(sql, stmt.binds);
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        return { results: [] as unknown[] };
      },
      async first() {
        if (/FROM articles\b/i.test(sql)) return { id: 1 };
        if (/FROM article_likes\b/i.test(sql)) {
          const ipHash = String(stmt.binds[1]);
          if (opts.existingLike) {
            // 首次查询时把当前 IP 记入真值集合，模拟「库中已有这条记录」。
            state.likes.add(ipHash);
            return { id: "like-1" };
          }
          return state.likes.has(ipHash) ? { id: "like-1" } : null;
        }
        return null;
      },
    };
    return stmt;
  };

  const db = {
    prepare: makeStmt,
    async batch(stmts: Array<ReturnType<typeof makeStmt>>) {
      batchCount += 1;
      pendingInBatch.length = 0;
      for (const s of stmts)
        pendingInBatch.push({ sql: s.sql, binds: s.binds });
      if (opts.failBatch) throw new Error("simulated D1 batch failure");
      // 整批成功才逐条应用；失败时上面的 throw 已保证这里不执行（回滚）。
      for (const s of pendingInBatch) applyWrite(s.sql, s.binds);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };

  return {
    db,
    batchCalls: () => batchCount,
    batchStatements: () => [...pendingInBatch],
    directRuns: () => [...directRunStatements],
    state: () => ({ likes: new Set(state.likes), likeCount: state.likeCount }),
  };
}

function makeEnv(db: unknown): Env {
  // #104 / L5：ip_hash 的盐来自服务端 secret，桩环境必须提供，否则 fail-closed。
  return { DB: db, IP_HASH_SECRET: "test-ip-hash-secret" } as unknown as Env;
}

function likeRequest(): Request {
  return new Request("https://example.com/api/v1/articles/1/like", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.7" },
  });
}

async function bodyOf(res: Response): Promise<{ code: number; data: unknown }> {
  return (await res.json()) as { code: number; data: unknown };
}

describe("handleToggleLike 原子化（#72 / M9）", () => {
  it("取消点赞：DELETE 与 like_count 递减在同一 batch 提交，计数与记录一致", async () => {
    const fake = makeD1({ existingLike: true });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "1" }
    );

    expect(res.status).toBe(200);
    expect(fake.batchCalls()).toBe(1);
    const sqls = fake.batchStatements().map((s) => s.sql);
    expect(sqls.some((s) => /DELETE FROM article_likes/i.test(s))).toBe(true);
    expect(
      sqls.some((s) =>
        /UPDATE articles SET like_count = like_count - 1/i.test(s)
      )
    ).toBe(true);
    // 没有任何写语句绕过 batch 单独 run
    expect(fake.directRuns()).toHaveLength(0);
    // 真值读回：记录已删空，计数递减到 0，二者一致
    const after = fake.state();
    expect(after.likes.size).toBe(0);
    expect(after.likeCount).toBe(0);
    expect(after.likeCount).toBe(after.likes.size);
  });

  it("点赞：INSERT 与 like_count 递增在同一 batch 提交，计数与记录一致", async () => {
    const fake = makeD1({ existingLike: false });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "1" }
    );

    expect(res.status).toBe(200);
    expect(fake.batchCalls()).toBe(1);
    const sqls = fake.batchStatements().map((s) => s.sql);
    expect(sqls.some((s) => /INSERT INTO article_likes/i.test(s))).toBe(true);
    expect(
      sqls.some((s) =>
        /UPDATE articles SET like_count = like_count \+ 1/i.test(s)
      )
    ).toBe(true);
    expect(fake.directRuns()).toHaveLength(0);
    const after = fake.state();
    expect(after.likes.size).toBe(1);
    expect(after.likeCount).toBe(1);
    expect(after.likeCount).toBe(after.likes.size);
  });

  it("batch 中 UPDATE 失败时整批回滚：DELETE 不生效，计数与记录仍一致，返回错误响应", async () => {
    const fake = makeD1({ existingLike: true, failBatch: true });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "1" }
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fake.batchCalls()).toBe(1);
    expect(fake.directRuns()).toHaveLength(0);
    // 回滚后：记录仍在(1)、计数仍为 1，没有产生漂移
    const after = fake.state();
    expect(after.likes.size).toBe(1);
    expect(after.likeCount).toBe(1);
    expect(after.likeCount).toBe(after.likes.size);
    const body = await bodyOf(res);
    expect(body.code).not.toBe(0);
  });
});
