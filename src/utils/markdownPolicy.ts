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
 * 需要做 URL scheme 校验的属性。DOMPurify 会检查所有非 URI 安全属性；
 * 正文白名单中除 `href` / `src` 外，只有 `target` / `rel` 不在其
 * URI_SAFE_ATTRIBUTES 内，因此这里与 DOMPurify 的实际校验面一致。
 */
export const ARTICLE_BODY_URI_ATTRS = ["href", "src", "target", "rel"] as const;

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

/**
 * 内容随标签一起丢弃的标签：逐字对齐 DOMPurify 默认的 `FORBID_CONTENTS`。
 * DOMPurify 剥除这些标签时不保留子树文本（script / iframe / template / svg 等），
 * sanitize-html 需通过 `nonTextTags` 复现同一口径。
 *
 * 注：`thead` 虽在正文白名单内，但 sanitize-html 只对未放行标签应用
 * nonTextTags，因此不会影响 GFM 表格的表头。
 */
export const ARTICLE_BODY_FORBID_CONTENT_TAGS = [
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
] as const;

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
 * DOM clobbering 高危 id：与 document / form 上会遮蔽应用代码的属性同名。
 *
 * DOMPurify 默认按 `value in document || value in formElement` 动态丢弃这类
 * `id`；sanitize-html 运行在无 DOM 的 Workers 环境，无法做同样的动态检查。
 * 这里维护一份保守名单（另在 transformTags 中丢弃 `on*` 事件处理器名），
 * 覆盖会直接遮蔽常用 DOM API 的 id；普通锚点 id（如 `section-1`）原样保留。
 * 新增依赖的 DOM API 时需同步补充此表与回归测试。
 */
export const ARTICLE_BODY_FORBIDDEN_IDS = [
  // Document / Window
  "URL",
  "activeElement",
  "adoptNode",
  "anchors",
  "applets",
  "body",
  "characterSet",
  "charset",
  "compatMode",
  "contentType",
  "cookie",
  "createAttribute",
  "createAttributeNS",
  "createComment",
  "createDocumentFragment",
  "createElement",
  "createElementNS",
  "createEvent",
  "createNodeIterator",
  "createProcessingInstruction",
  "createRange",
  "createTextNode",
  "createTreeWalker",
  "currentScript",
  "defaultView",
  "designMode",
  "dir",
  "doctype",
  "documentElement",
  "documentURI",
  "domain",
  "embeds",
  "execCommand",
  "forms",
  "getElementById",
  "getElementsByClassName",
  "getElementsByName",
  "getElementsByTagName",
  "getElementsByTagNameNS",
  "getSelection",
  "head",
  "images",
  "implementation",
  "importNode",
  "inputEncoding",
  "lastModified",
  "links",
  "location",
  "plugins",
  "querySelector",
  "querySelectorAll",
  "readyState",
  "referrer",
  "scripts",
  "styleSheets",
  "title",
  "visibilityState",
  "write",
  "writeln",
  // Element / Node
  "appendChild",
  "attributes",
  "baseURI",
  "childElementCount",
  "childNodes",
  "children",
  "classList",
  "className",
  "clientHeight",
  "clientLeft",
  "clientTop",
  "clientWidth",
  "cloneNode",
  "closest",
  "compareDocumentPosition",
  "contains",
  "firstChild",
  "firstElementChild",
  "getAttribute",
  "getAttributeNS",
  "getAttributeNames",
  "getAttributeNode",
  "getAttributeNodeNS",
  "getBoundingClientRect",
  "getClientRects",
  "getRootNode",
  "hasAttribute",
  "hasAttributeNS",
  "hasAttributes",
  "hasChildNodes",
  "id",
  "innerHTML",
  "insertAdjacentElement",
  "insertAdjacentHTML",
  "insertAdjacentText",
  "insertBefore",
  "isConnected",
  "isDefaultNamespace",
  "isEqualNode",
  "isSameNode",
  "lastChild",
  "lastElementChild",
  "localName",
  "matches",
  "namespaceURI",
  "nextElementSibling",
  "nextSibling",
  "nodeName",
  "nodeType",
  "nodeValue",
  "normalize",
  "outerHTML",
  "ownerDocument",
  "parentElement",
  "parentNode",
  "previousElementSibling",
  "previousSibling",
  "removeAttribute",
  "removeAttributeNS",
  "removeAttributeNode",
  "removeChild",
  "replaceChild",
  "replaceChildren",
  "scrollHeight",
  "scrollLeft",
  "scrollTop",
  "scrollWidth",
  "setAttribute",
  "setAttributeNS",
  "setAttributeNode",
  "setAttributeNodeNS",
  "shadowRoot",
  "slot",
  "tagName",
  "textContent",
  "toggleAttribute",
  // EventTarget
  "addEventListener",
  "dispatchEvent",
  "removeEventListener",
  // HTMLFormElement
  "acceptCharset",
  "action",
  "autocomplete",
  "checkValidity",
  "elements",
  "encoding",
  "enctype",
  "length",
  "method",
  "name",
  "noValidate",
  "rel",
  "reportValidity",
  "requestSubmit",
  "reset",
  "submit",
  "target",
  // Object.prototype
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
] as const;

const ARTICLE_BODY_FORBIDDEN_ID_SET = new Set<string>(
  ARTICLE_BODY_FORBIDDEN_IDS
);

/**
 * 服务端渲染器用配置（sanitize-html）。
 * `img` 额外放行 `data:`，与 DOMPurify 对媒体标签的 data URI 处理保持一致；
 * 链接上的 `data:` 仍会被剥除。
 *
 * `transformTags` 复现 DOMPurify 的 DOM clobbering 防护：`id` 与 document /
 * form 属性同名时整条属性丢弃，`on*` 事件处理器名同样丢弃。
 */
export const ARTICLE_BODY_SANITIZE_HTML_OPTIONS: IOptions = {
  allowedTags: [...ARTICLE_BODY_TAGS],
  allowedAttributes: {
    "*": [...ARTICLE_BODY_ATTRS, ...ARTICLE_BODY_ATTR_GLOBS],
  },
  allowedSchemes: [...ARTICLE_BODY_URI_SCHEMES],
  allowedSchemesByTag: { img: [...ARTICLE_BODY_URI_SCHEMES, "data"] },
  allowedSchemesAppliedToAttributes: [...ARTICLE_BODY_URI_ATTRS],
  allowProtocolRelative: true,
  nonTextTags: [...ARTICLE_BODY_FORBID_CONTENT_TAGS],
  disallowedTagsMode: "discard",
  transformTags: {
    "*": (tagName, attribs) => {
      const id = attribs.id;
      if (
        typeof id === "string" &&
        (ARTICLE_BODY_FORBIDDEN_ID_SET.has(id) || /^on[a-z]+$/.test(id))
      ) {
        delete attribs.id;
      }
      return { tagName, attribs };
    },
  },
};

/** Markdown 解析选项：预览与服务端渲染共用，保证 GFM 输出一致。 */
export const MARKDOWN_PARSE_OPTIONS = {
  gfm: true,
  breaks: false,
} as const;
