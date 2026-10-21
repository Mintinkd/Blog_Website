// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ARTICLE_BODY_ATTRS,
  ARTICLE_BODY_DOMPURIFY_CONFIG,
  ARTICLE_BODY_FORBID_CONTENT_TAGS,
  ARTICLE_BODY_SANITIZE_HTML_OPTIONS,
  ARTICLE_BODY_TAGS,
  ARTICLE_BODY_URI_ATTRS,
  ARTICLE_BODY_URI_SCHEMES,
} from "../src/utils/markdownPolicy";

/**
 * #37：正文白名单是安全契约。期望值手写而非从被测常量推导，
 * 防止误删标签 / 属性或放行新 scheme 时测试跟着实现一起漂移。
 */
const EXPECTED_TAGS = [
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
];

const EXPECTED_ATTRS = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "target",
  "rel",
];

const EXPECTED_SCHEMES = [
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
];

const EXPECTED_URI_ATTRS = ["href", "src", "target", "rel"];

/** 逐字对齐 DOMPurify 默认的 FORBID_CONTENTS（dompurify 3.x）。 */
const EXPECTED_FORBID_CONTENT_TAGS = [
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
];

describe("文章正文白名单策略", () => {
  it("标签 / 属性 / scheme 与评审基线一致", () => {
    expect([...ARTICLE_BODY_TAGS]).toEqual(EXPECTED_TAGS);
    expect([...ARTICLE_BODY_ATTRS]).toEqual(EXPECTED_ATTRS);
    expect([...ARTICLE_BODY_URI_SCHEMES]).toEqual(EXPECTED_SCHEMES);
    expect([...ARTICLE_BODY_URI_ATTRS]).toEqual(EXPECTED_URI_ATTRS);
    expect([...ARTICLE_BODY_FORBID_CONTENT_TAGS]).toEqual(
      EXPECTED_FORBID_CONTENT_TAGS
    );
  });

  it("DOMPurify 与 sanitize-html 消费同一份白名单", () => {
    expect(ARTICLE_BODY_DOMPURIFY_CONFIG.ALLOWED_TAGS).toEqual(EXPECTED_TAGS);
    expect(ARTICLE_BODY_DOMPURIFY_CONFIG.ALLOWED_ATTR).toEqual(EXPECTED_ATTRS);

    expect(ARTICLE_BODY_SANITIZE_HTML_OPTIONS.allowedTags).toEqual(
      EXPECTED_TAGS
    );
    const allowedAttributes =
      ARTICLE_BODY_SANITIZE_HTML_OPTIONS.allowedAttributes;
    if (!allowedAttributes) {
      throw new Error("sanitize-html 配置必须显式给出属性白名单");
    }
    expect(allowedAttributes["*"]).toEqual([
      ...EXPECTED_ATTRS,
      "data-*",
      "aria-*",
    ]);
    expect(ARTICLE_BODY_SANITIZE_HTML_OPTIONS.allowedSchemes).toEqual(
      EXPECTED_SCHEMES
    );
    expect(
      ARTICLE_BODY_SANITIZE_HTML_OPTIONS.allowedSchemesAppliedToAttributes
    ).toEqual(EXPECTED_URI_ATTRS);
    expect(ARTICLE_BODY_SANITIZE_HTML_OPTIONS.allowedSchemesByTag).toEqual({
      img: [...EXPECTED_SCHEMES, "data"],
    });
    expect(ARTICLE_BODY_SANITIZE_HTML_OPTIONS.nonTextTags).toEqual(
      EXPECTED_FORBID_CONTENT_TAGS
    );
  });

  it("DOMPurify URI 正则接受白名单 scheme 与相对地址，拒绝危险 scheme", () => {
    const uriRegexp = ARTICLE_BODY_DOMPURIFY_CONFIG.ALLOWED_URI_REGEXP!;

    for (const scheme of EXPECTED_SCHEMES) {
      expect(uriRegexp.test(`${scheme}:resource`)).toBe(true);
    }
    expect(uriRegexp.test("/relative/path")).toBe(true);
    expect(uriRegexp.test("#anchor")).toBe(true);
    expect(uriRegexp.test("javascript:alert(1)")).toBe(false);
    expect(uriRegexp.test("data:text/html,<b>x</b>")).toBe(false);
    expect(uriRegexp.test("vbscript:msgbox(1)")).toBe(false);
  });
});
