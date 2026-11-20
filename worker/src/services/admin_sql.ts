/**
 * Admin 导入 / 导出 SQL 构造模块（#112 item 13）。
 *
 * 从 admin.ts 下沉的 SQL 拼接逻辑。handler 只编排（调用 D1、处理响应），
 * SQL 字符串构造集中在此模块，便于审计与单测。
 *
 * 语义不变：导入事务、KV 孤儿清理、回滚、密钥行跳过等行为完全保持。
 */

/** 导出查询：SELECT 指定列 + 分页 */
export function exportQuerySql(table: string, cols: string): string {
  return `SELECT ${cols} FROM ${table} LIMIT ? OFFSET ?`;
}

/** 计数查询：dry-run 时统计现有行数 */
export function countQuerySql(table: string): string {
  return `SELECT COUNT(*) AS count FROM ${table}`;
}

/** 备份查询：导入前全量读取 */
export function backupQuerySql(table: string, cols: string): string {
  return `SELECT ${cols} FROM ${table}`;
}

/** 全表删除（无 skipKeys 的表） */
export function deleteAllSql(table: string): string {
  return `DELETE FROM ${table}`;
}

/** 跳过密钥行的删除（有 skipKeys 的表） */
export function deleteSkipSql(table: string, skipKeyCount: number): string {
  return `DELETE FROM ${table} WHERE key NOT IN (${Array.from({ length: skipKeyCount }, () => "?").join(", ")})`;
}

/** 插入语句 */
export function insertSql(table: string, cols: string[]): string {
  const placeholders = cols.map(() => "?").join(", ");
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
}

/** 查找「未分类」分类 id（taxonomy v2 / #79） */
export const UNCATEGORIZED_LOOKUP_SQL =
  "SELECT id FROM categories WHERE slug = 'uncategorized'";
