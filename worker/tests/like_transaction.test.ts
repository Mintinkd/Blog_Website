import { describe, expect, it } from "vitest";
import { handleToggleLike } from "../src/handlers/like";
import type { Env } from "../src/index";

/**
 * issue #72 / M9：点赞「记录写入 + 计数更新」原子化。
 *
 * 接缝：handleToggleLike —— 工单 Key interfaces 点名的 handler 接缝（D1 batch 出口）。
 * 原子性的可观测证据：走 batch 一次提交，而非两次独立 run；batch 抛错时不产生
 * 任何已提交的语句（模拟 D1 整批回滚），handler 返回错误响应而非未捕获异常。
 */

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

interface FakeOptions {
  /** 模拟 LIKE 记录是否已存在（决定点赞 / 取消分支）。 */
  existingLike?: boolean;
  /** 模拟 batch 中 UPDATE 失败；桩整批不提交（回滚语义）。 */
  failBatch?: boolean;
}

/**
 * 假 D1：分开记录「单条 run」「batch 收到」「batch 成功提交」三类语句。
 * batch 失败时丢弃收到的语句（不写入 batchCommitted），模拟整批回滚。
 */
function makeD1(opts: FakeOptions = {}): {
  db: unknown;
  batchCalls: () => number;
  batchStatements: () => RecordedStatement[];
  directRuns: () => RecordedStatement[];
  batchCommitted: () => RecordedStatement[];
} {
  const pendingInBatch: RecordedStatement[] = [];
  const directRunStatements: RecordedStatement[] = [];
  const batchCommittedStatements: RecordedStatement[] = [];
  let batchCount = 0;

  const makeStmt = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        stmt.binds = binds;
        return stmt;
      },
      async run() {
        directRunStatements.push({ sql, binds: stmt.binds });
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        return { results: [] as unknown[] };
      },
      async first() {
        if (/FROM articles\b/i.test(sql)) return { id: "a1" };
        if (/FROM article_likes\b/i.test(sql)) {
          return opts.existingLike ? { id: "like-1" } : null;
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
      batchCommittedStatements.push(...pendingInBatch);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };

  return {
    db,
    batchCalls: () => batchCount,
    batchStatements: () => [...pendingInBatch],
    directRuns: () => [...directRunStatements],
    batchCommitted: () => [...batchCommittedStatements],
  };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

function likeRequest(): Request {
  return new Request("https://example.com/api/v1/articles/a1/like", {
    method: "POST",
    headers: { "CF-Connecting-IP": "203.0.113.7" },
  });
}

async function bodyOf(res: Response): Promise<{ code: number; data: unknown }> {
  return (await res.json()) as { code: number; data: unknown };
}

describe("handleToggleLike 原子化（#72 / M9）", () => {
  it("取消点赞：DELETE 与 like_count 递减在同一 batch 提交", async () => {
    const fake = makeD1({ existingLike: true });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "a1" }
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
  });

  it("点赞：INSERT 与 like_count 递增在同一 batch 提交", async () => {
    const fake = makeD1({ existingLike: false });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "a1" }
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
  });

  it("batch 中 UPDATE 失败时整批回滚：DELETE 不生效，返回错误响应", async () => {
    const fake = makeD1({ existingLike: true, failBatch: true });
    const res = await handleToggleLike(
      likeRequest(),
      makeEnv(fake.db),
      {} as ExecutionContext,
      { article_id: "a1" }
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fake.batchCalls()).toBe(1);
    // 桩模拟回滚：batchCommitted 中既不出现 DELETE 也不出现 UPDATE
    expect(fake.batchCommitted()).toHaveLength(0);
    // 且没有任何写语句绕过 batch 单独 run
    expect(fake.directRuns()).toHaveLength(0);
    const body = await bodyOf(res);
    expect(body.code).not.toBe(0);
  });
});
