import DOMPurify from 'dompurify';

/**
 * 前端输出编码 / 消毒工具（渗透报告 I1/I2 修复）
 *
 * 约定：凡 API 返回的文本字段（标题、摘要、标签/分类名等）
 * 需要拼进 innerHTML 时，必须先过 escapeHtml / escapeAttr；
 * 富文本（搜索高亮）只允许 <mark> 标签，走 sanitizeHighlight。
 */

/** 文本节点转义：& < > " ' */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[m] as string));
}

/** 属性值转义（与 escapeHtml 同规则，单独命名便于审计调用点） */
export function escapeAttr(s: unknown): string {
  return escapeHtml(s);
}

/** 拼 URL 路径段用：slug 等先 encodeURIComponent，防 javascript: / 路径注入 */
export function safePathSegment(s: unknown): string {
  return encodeURIComponent(String(s ?? ''));
}

/**
 * 搜索高亮消毒：仅保留 <mark>（后端 highlightText/sanitizeSnippet 已转义原文，
 * 这里再做一层前端兜底，防未来后端改动回退）
 */
export function sanitizeHighlight(html: unknown): string {
  return DOMPurify.sanitize(String(html ?? ''), {
    ALLOWED_TAGS: ['mark'],
    ALLOWED_ATTR: [],
  });
}
