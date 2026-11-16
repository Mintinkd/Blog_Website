import sanitizeHtmlLib from "sanitize-html";
import {
  RICH_TEXT_TAGS,
  RICH_TEXT_ATTRIBUTES,
  RICH_TEXT_ATTRIBUTE_GLOBS,
  RICH_TEXT_URI_ATTRIBUTES,
  RICH_TEXT_SCHEMES,
  RICH_TEXT_IMG_EXTRA_SCHEMES,
  RICH_TEXT_FORBID_CONTENT_TAGS,
} from "../generated/rich-text-policy";

/**
 * Worker 侧 HTML 消毒（issue #92 / M6 + #99 / M19）。
 *
 * 旧实现是 8 条正则黑名单（<script> / on\w+= / javascript: ...），天然可绕过
 * （实体编码、未闭合标签、SVG 命名空间、meta/base 等），且导出的 ALLOWED_TAGS /
 * ALLOWED_ATTR 白名单常量全仓零引用——制造了「有白名单在生效」的假象。
 *
 * 现改为 sanitize-html 白名单消毒，白名单来自 rich-text-policy.json 单一源
 * （生成物 ../generated/rich-text-policy.ts），与前端 markdownPolicy.ts 对齐。
 * sanitizeHtml() 对外签名不变，comment.ts / admin.ts 调用点无需改动。
 *
 * 与前端 DOMPurify 的分工：Worker 消毒是入库第一道（防存储型 XSS），
 * 前台渲染再用 markdownPolicy + DOMPurify 二次消毒；两端口径一致性由
 * tests/rich-text-policy.test.ts 守卫。
 */

/**
 * 白名单常量（与生成物同源）——作为下方 sanitize-html 配置的唯一输入被真正消费，
 * 不再是「定义后零引用」的死常量。票面 #92 点名这两个常量须作为
 * allowedTags / allowedAttributes 消费，故保留其名字与导出。
 */
export const ALLOWED_TAGS: readonly string[] = RICH_TEXT_TAGS;
export const ALLOWED_ATTR: Record<string, string[]> = Object.freeze({
  "*": [...RICH_TEXT_ATTRIBUTES, ...RICH_TEXT_ATTRIBUTE_GLOBS],
});

const SANITIZE_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: ALLOWED_ATTR,
  allowedSchemes: [...RICH_TEXT_SCHEMES],
  allowedSchemesByTag: {
    img: [...RICH_TEXT_SCHEMES, ...RICH_TEXT_IMG_EXTRA_SCHEMES],
  },
  allowedSchemesAppliedToAttributes: [...RICH_TEXT_URI_ATTRIBUTES],
  allowProtocolRelative: true,
  nonTextTags: [...RICH_TEXT_FORBID_CONTENT_TAGS],
  disallowedTagsMode: "discard",
};

/**
 * 白名单消毒：只保留策略允许的标签/属性/scheme，其余整段丢弃。
 * @param dirty 不可信输入（评论正文 / 导入的文章 content、content_html）
 */
export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLib(String(dirty ?? ""), SANITIZE_OPTIONS).trim();
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
