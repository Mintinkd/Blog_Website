/**
 * P1 复审 Spec(c)2 / issue #16：D1 旧列回退的错误判定。
 *
 * 只有「列不存在」（迁移前）这类确定性错误才允许触发降级回退；
 * 其余任何异常（瞬时故障、表缺失等）都必须按 fail-closed 向上抛，
 * 不得静默关闭「须改密」门禁或丢失锁定计数。
 */

const MISSING_COLUMN_PATTERN = /no such column|has no column named/i;

export function isMissingColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return MISSING_COLUMN_PATTERN.test(message);
}
