import { Env } from "../index";
import { successResponse, serverError } from "../utils/response";

/**
 * admin 计数器对账（issue #72 / M9）。
 *
 * 以关联表的 COUNT(*) 为真值，重算 articles.like_count / comment_count；
 * 差异经一条 batch 原子写回，响应返回修复条数与逐条前后值供运维确认。
 * comment_count 的真值口径与 comment.ts 一致：只计 status='approved' 的有效评论。
 */

interface CounterDifference {
  article_id: string;
  field: "like_count" | "comment_count";
  before: number;
  after: number;
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

    const likeTruth = new Map<string, number>();
    for (const row of (likesResult.results ?? []) as Array<
      Record<string, unknown>
    >) {
      likeTruth.set(String(row.article_id), Number(row.cnt));
    }
    const commentTruth = new Map<string, number>();
    for (const row of (commentsResult.results ?? []) as Array<
      Record<string, unknown>
    >) {
      commentTruth.set(String(row.article_id), Number(row.cnt));
    }

    const differences: CounterDifference[] = [];
    const statements: ReturnType<ReturnType<Env["DB"]["prepare"]>["bind"]>[] =
      [];

    for (const row of (articlesResult.results ?? []) as Array<
      Record<string, unknown>
    >) {
      const id = String(row.id);
      const likeBefore = Number(row.like_count);
      const likeAfter = likeTruth.get(id) ?? 0;
      if (likeBefore !== likeAfter) {
        differences.push({
          article_id: id,
          field: "like_count",
          before: likeBefore,
          after: likeAfter,
        });
        statements.push(
          env.DB.prepare(
            "UPDATE articles SET like_count = ? WHERE id = ?"
          ).bind(likeAfter, id)
        );
      }

      const commentBefore = Number(row.comment_count);
      const commentAfter = commentTruth.get(id) ?? 0;
      if (commentBefore !== commentAfter) {
        differences.push({
          article_id: id,
          field: "comment_count",
          before: commentBefore,
          after: commentAfter,
        });
        statements.push(
          env.DB.prepare(
            "UPDATE articles SET comment_count = ? WHERE id = ?"
          ).bind(commentAfter, id)
        );
      }
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
