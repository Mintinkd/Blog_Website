import { Env } from "../index";
import { successResponse, serverError } from "../utils/response";

/**
 * admin 计数器对账（issue #72 / M9）。
 *
 * 以关联表的 COUNT(*) 为真值，重算 articles.like_count / comment_count；
 * 差异经一条 batch 原子写回，响应返回修复条数与逐条前后值供运维确认。
 * comment_count 的真值口径与 comment.ts 一致：只计 status='approved' 的有效评论。
 */

type CounterField = "like_count" | "comment_count";

interface CounterDifference {
  article_id: string;
  field: CounterField;
  before: number;
  after: number;
}

type PreparedStatement = ReturnType<ReturnType<Env["DB"]["prepare"]>["bind"]>;

/** GROUP BY 结果 → article_id 到真实计数的映射。 */
function truthMap(results: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of results as Array<Record<string, unknown>>) {
    map.set(String(row.article_id), Number(row.cnt));
  }
  return map;
}

/**
 * 对比单个计数字段：漂移则同时产出差异记录与幂等的 UPDATE 语句。
 * 语句以 (真值, article_id) 绑定，重复执行仍收敛，不依赖旧值。
 */
function diffField(
  id: string,
  field: CounterField,
  before: number,
  truth: Map<string, number>,
  env: Env,
  differences: CounterDifference[],
  statements: PreparedStatement[]
): void {
  const after = truth.get(id) ?? 0;
  if (before === after) return;
  differences.push({ article_id: id, field, before, after });
  statements.push(
    env.DB.prepare(`UPDATE articles SET ${field} = ? WHERE id = ?`).bind(
      after,
      id
    )
  );
}

export async function handleReconcileCounters(
  _request: Request,
  env: Env
): Promise<Response> {
  try {
    const articlesResult = await env.DB.prepare(
      "SELECT id, like_count, comment_count FROM articles"
    ).all();
    const likesResult = await env.DB.prepare(
      "SELECT article_id, COUNT(*) AS cnt FROM article_likes GROUP BY article_id"
    ).all();
    const commentsResult = await env.DB.prepare(
      "SELECT article_id, COUNT(*) AS cnt FROM comments WHERE status = 'approved' GROUP BY article_id"
    ).all();

    const likeTruth = truthMap(likesResult.results ?? []);
    const commentTruth = truthMap(commentsResult.results ?? []);

    const differences: CounterDifference[] = [];
    const statements: PreparedStatement[] = [];

    for (const row of (articlesResult.results ?? []) as Array<
      Record<string, unknown>
    >) {
      const id = String(row.id);
      diffField(
        id,
        "like_count",
        Number(row.like_count),
        likeTruth,
        env,
        differences,
        statements
      );
      diffField(
        id,
        "comment_count",
        Number(row.comment_count),
        commentTruth,
        env,
        differences,
        statements
      );
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    return successResponse(
      { fixed: differences.length, differences },
      "Counters reconciled"
    );
  } catch {
    // 不回显内部异常原文 / SQL 表名（#72 验收：异常出口口径）。
    return serverError("Counter reconciliation failed");
  }
}
