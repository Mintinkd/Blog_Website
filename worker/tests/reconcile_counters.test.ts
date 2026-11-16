import { describe, expect, it } from "vitest";
import { handleReconcileCounters } from "../src/handlers/reconcile";
import type { Env } from "../src/index";

/**
 * issue #72 / M9：admin 对账入口把 like_count / comment_count 收敛到 COUNT(*) 真值。
 *
 * 接缝：handleReconcileCounters —— 工单 Key interfaces 点名的 handler 接缝（D1 出口）。
 * 桩以「表内行数」为独立真值源：article_likes / comments 的分组计数来自测试数据，
 * 与 articles 上记录的计数值不一致；断言 batch 把真实计数写回，且响应含差异。
 */

interface ArticleRow {
  id: string;
  like_count: number;
  comment_count: number;
}

interface ReconcileState {
  articles: ArticleRow[];
  /** article_id -> article_likes 真实行数 */
  likeCounts: Record<string, number>;
  /** article_id -> comments 有效(status=approved)真实行数 */
  commentCounts: Record<string, number>;
  failBatch?: boolean;
}

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

function makeD1(state: ReconcileState): {
  db: unknown;
  batchStatements: () => RecordedStatement[];
  committed: () => RecordedStatement[];
} {
  const batchLog: RecordedStatement[] = [];
  const committed: RecordedStatement[] = [];

  const makeStmt = (sql: string) => ({
    sql,
    binds: [] as unknown[],
    bind(...binds: unknown[]) {
      // 每次 bind 都更新同一个 stmt 对象（与 admin_import.test.ts 一致）
      this.binds = binds;
      return this;
    },
    async all() {
      if (/FROM articles\b/i.test(sql)) {
        return { results: state.articles.map((a) => ({ ...a })) };
      }
      if (/FROM article_likes\b/i.test(sql)) {
        return {
          results: Object.entries(state.likeCounts).map(
            ([article_id, cnt]) => ({
              article_id,
              cnt,
            })
          ),
        };
      }
      if (/FROM comments\b/i.test(sql)) {
        return {
          results: Object.entries(state.commentCounts).map(
            ([article_id, cnt]) => ({
              article_id,
              cnt,
            })
          ),
        };
      }
      return { results: [] as unknown[] };
    },
    async first() {
      return null;
    },
    async run() {
      committed.push({ sql, binds: this.binds });
      return { success: true, meta: { changes: 1 } };
    },
  });

  const db = {
    prepare: makeStmt,
    async batch(stmts: Array<ReturnType<typeof makeStmt>>) {
      batchLog.length = 0;
      for (const s of stmts) batchLog.push({ sql: s.sql, binds: s.binds });
      if (state.failBatch)
        throw new Error("simulated D1 batch failure: table articles");
      committed.push(...batchLog);
      return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  return {
    db,
    batchStatements: () => [...batchLog],
    committed: () => [...committed],
  };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

function reconcileRequest(): Request {
  return new Request("https://example.com/api/v1/admin/reconcile-counters", {
    method: "POST",
  });
}

interface ReconcileBody {
  code: number;
  message: string;
  data: {
    fixed: number;
    differences: Array<{
      article_id: string;
      field: string;
      before: number;
      after: number;
    }>;
  } | null;
}

async function bodyOf(res: Response): Promise<ReconcileBody> {
  return (await res.json()) as ReconcileBody;
}

describe("handleReconcileCounters 对账（#72 / M9）", () => {
  it("把漂移的 like_count / comment_count 收敛到 COUNT(*) 真值，响应含差异", async () => {
    const fake = makeD1({
      articles: [
        { id: "a1", like_count: 5, comment_count: 2 }, // like 漂移(真值3)，comment 一致
        { id: "a2", like_count: 1, comment_count: 4 }, // comment 漂移(真值2)
        { id: "a3", like_count: 0, comment_count: 0 }, // 完全一致
      ],
      likeCounts: { a1: 3, a2: 1 },
      commentCounts: { a1: 2, a2: 2 },
    });

    const res = await handleReconcileCounters(
      reconcileRequest(),
      makeEnv(fake.db)
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.code).toBe(0);
    expect(body.data?.fixed).toBe(2);
    const diffs = body.data?.differences ?? [];
    expect(diffs).toEqual(
      expect.arrayContaining([
        { article_id: "a1", field: "like_count", before: 5, after: 3 },
        { article_id: "a2", field: "comment_count", before: 4, after: 2 },
      ])
    );
    expect(diffs.some((d) => d.article_id === "a3")).toBe(false);

    // batch 里含把真值写回的 UPDATE，绑定值来自 COUNT(*) 而非原记录
    const updates = fake
      .batchStatements()
      .filter((s) => /UPDATE articles SET like_count/i.test(s.sql));
    expect(updates.some((u) => u.binds[1] === "a1" && u.binds[0] === 3)).toBe(
      true
    );
    const commentUpdates = fake
      .batchStatements()
      .filter((s) => /UPDATE articles SET comment_count/i.test(s.sql));
    expect(
      commentUpdates.some((u) => u.binds[1] === "a2" && u.binds[0] === 2)
    ).toBe(true);
  });

  it("无漂移时不发 batch，fixed=0", async () => {
    const fake = makeD1({
      articles: [{ id: "a1", like_count: 3, comment_count: 2 }],
      likeCounts: { a1: 3 },
      commentCounts: { a1: 2 },
    });
    const res = await handleReconcileCounters(
      reconcileRequest(),
      makeEnv(fake.db)
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data?.fixed).toBe(0);
    expect(fake.batchStatements()).toHaveLength(0);
  });

  it("batch 异常时返回 500，响应不回显 SQL 表名/原文", async () => {
    const fake = makeD1({
      articles: [{ id: "a1", like_count: 5, comment_count: 0 }],
      likeCounts: { a1: 3 },
      commentCounts: { a1: 0 },
      failBatch: true,
    });
    const res = await handleReconcileCounters(
      reconcileRequest(),
      makeEnv(fake.db)
    );
    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toMatch(
      /article_likes|articles|simulated D1 batch failure/i
    );
    expect(fake.committed()).toHaveLength(0);
  });
});
