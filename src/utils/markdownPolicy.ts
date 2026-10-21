import type { Config } from "dompurify";
import type { IOptions } from "sanitize-html";

/**
 * 文章正文白名单：后台预览（DOMPurify，浏览器 / jsdom）与服务端渲染器
 * （sanitize-html，Workers）共用同一份标签、属性与 URL scheme 策略，
 * 避免预览与线上正文消毒口径漂移。
 */

/** 正文允许的标签。顺序与既有预览一致，新增标签需同时评估两种消毒器。 */
export const ARTICLE_BODY_TAGS = [
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
] as const;

/** 正文允许的属性；`on*` 不在名单内，事件处理器一律剥除。 */
export const ARTICLE_BODY_ATTRS = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "target",
  "rel",
] as const;

/**
 * 正文允许的属性通配（与后台预览的 DOMPurify 默认口径一致：
 * data-* / aria-* 是惰性属性，不执行脚本）。
 */
const ARTICLE_BODY_ATTR_GLOBS = ["data-*", "aria-*"] as const;

/**
 * 正文 URL scheme 白名单。与既有后台预览的 DOMPurify 默认口径保持一致，
 * 仅放行明确安全的协议；相对 URL / 锚点由各消毒器按自身规则放行。
 */
export const ARTICLE_BODY_URI_SCHEMES = [
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
] as const;

/**
 * DOMPurify 的 URI 校验正则：scheme 白名单 + 相对 URL / 锚点。
 * 与 DOMPurify 默认值同构，但由上面的 scheme 列表派生。
 */
const ARTICLE_BODY_URI_REGEXP = new RegExp(
  `^(?:(?:${ARTICLE_BODY_URI_SCHEMES.join("|")}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`,
  "i"
);

/** 后台预览用配置（DOMPurify）。 */
export const ARTICLE_BODY_DOMPURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [...ARTICLE_BODY_TAGS],
  ALLOWED_ATTR: [...ARTICLE_BODY_ATTRS],
  ALLOWED_URI_REGEXP: ARTICLE_BODY_URI_REGEXP,
  // 与 sanitize-html 的 data-* / aria-* 通配保持一致。
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
};

/**
 * 服务端渲染器用配置（sanitize-html）。
 * `img` 额外放行 `data:`，与 DOMPurify 对媒体标签的 data URI 处理保持一致；
 * 链接上的 `data:` 仍会被剥除。
 */
export const ARTICLE_BODY_SANITIZE_HTML_OPTIONS: IOptions = {
  allowedTags: [...ARTICLE_BODY_TAGS],
  allowedAttributes: {
    "*": [...ARTICLE_BODY_ATTRS, ...ARTICLE_BODY_ATTR_GLOBS],
  },
  allowedSchemes: [...ARTICLE_BODY_URI_SCHEMES],
  allowedSchemesByTag: { img: [...ARTICLE_BODY_URI_SCHEMES, "data"] },
  allowProtocolRelative: true,
  disallowedTagsMode: "discard",
};

/** Markdown 解析选项：预览与服务端渲染共用，保证 GFM 输出一致。 */
export const MARKDOWN_PARSE_OPTIONS = {
  gfm: true,
  breaks: false,
} as const;
