/**
 * 生成物 —— Worker 富文本消毒白名单（issue #92 / M6 + #99 / M19）。禁止手工编辑。
 *
 * 单一事实源：仓库根 rich-text-policy.json。
 * 本文件由 npm run gen:rich-text（scripts/generate-rich-text-policy.mjs）生成；
 * 前端 markdownPolicy.ts 与本策略的一致性由 tests/rich-text-policy.test.ts 守卫。
 * 漂移修复流程：改 rich-text-policy.json → npm run gen:rich-text → 一并提交。
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

export const RICH_TEXT_TAGS: readonly string[] = Object.freeze([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "del",
  "ins",
  "sup",
  "sub",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "br",
  "span",
  "div",
]);

export const RICH_TEXT_ATTRIBUTES: readonly string[] = Object.freeze([
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "target",
  "rel",
]);

export const RICH_TEXT_ATTRIBUTE_GLOBS: readonly string[] = Object.freeze([
  "data-*",
  "aria-*",
]);

export const RICH_TEXT_URI_ATTRIBUTES: readonly string[] = Object.freeze([
  "href",
  "src",
  "target",
  "rel",
]);

export const RICH_TEXT_SCHEMES: readonly string[] = Object.freeze([
  "ftp",
  "ftps",
  "http",
  "https",
  "mailto",
  "tel",
  "callto",
  "sms",
  "cid",
  "xmpp",
  "matrix",
]);

export const RICH_TEXT_IMG_EXTRA_SCHEMES: readonly string[] = Object.freeze([
  "data",
]);

export const RICH_TEXT_FORBID_CONTENT_TAGS: readonly string[] = Object.freeze([
  "annotation-xml",
  "audio",
  "colgroup",
  "desc",
  "foreignobject",
  "head",
  "iframe",
  "math",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "selectedcontent",
  "style",
  "svg",
  "template",
  "thead",
  "title",
  "video",
  "xmp",
]);
