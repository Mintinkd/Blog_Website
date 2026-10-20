import { describe, expect, it } from "vitest";
import { buildScrapeDraft, decodeHtmlBytes } from "../src/utils/scrape";

/**
 * #34：抓取字节解码接缝。GBK/GB2312 fixture 直接写 GBK 字节（ASCII 部分
 * 逐字符取码），不依赖外部字典；未知字符集必须回退 UTF-8 并给出警告。
 */

// GBK：中文文章 / 正文内容
const GBK_TITLE = [0xd6, 0xd0, 0xce, 0xc4, 0xce, 0xc4, 0xd5, 0xc2];
const GBK_BODY = [0xd5, 0xfd, 0xce, 0xc4, 0xc4, 0xda, 0xc8, 0xdd];

function bytes(parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (let i = 0; i < part.length; i++) out.push(part.charCodeAt(i));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
}

function gbkPage(extraHead = ""): Uint8Array {
  return bytes([
    "<!doctype html><html><head>",
    extraHead,
    "<title>",
    GBK_TITLE,
    "</title></head><body><article><h1>",
    GBK_TITLE,
    "</h1><p>",
    GBK_BODY,
    "</p></article></body></html>",
  ]);
}

describe("decodeHtmlBytes", () => {
  it("按 Content-Type 的 charset 解码 GBK 字节", () => {
    const decoded = decodeHtmlBytes(gbkPage(), "text/html; charset=GBK");

    expect(decoded.charset).toBe("gbk");
    expect(decoded.warnings).toEqual([]);
    expect(decoded.html).toContain("中文文章");
    expect(decoded.html).toContain("正文内容");
  });

  it("Content-Type 没有 charset 时按 <meta charset=gb2312> 解码", () => {
    const decoded = decodeHtmlBytes(
      gbkPage('<meta charset="gb2312" />'),
      "text/html"
    );

    expect(decoded.charset).toBe("gb2312");
    expect(decoded.warnings).toEqual([]);
    expect(decoded.html).toContain("中文文章");
    expect(decoded.html).toContain("正文内容");
  });

  it("Content-Type 优先于文档里的 <meta charset>", () => {
    const decoded = decodeHtmlBytes(
      gbkPage('<meta charset="utf-8" />'),
      "text/html; charset=gbk"
    );

    expect(decoded.html).toContain("中文文章");
    expect(decoded.warnings).toEqual([]);
  });

  it("未知字符集回退 UTF-8 并给 charset_fallback 警告", () => {
    const html = bytes([
      "<!doctype html><html><head><title>Plain</title></head>",
      "<body><article><h1>Plain</h1><p>ASCII body.</p></article></body></html>",
    ]);

    const decoded = decodeHtmlBytes(html, "text/html; charset=x-unknown");

    expect(decoded.charset).toBe("utf-8");
    expect(decoded.warnings).toContain("charset_fallback");
    expect(decoded.html).toContain("ASCII body.");
  });

  it("UTF-8 BOM 覆盖错误的 Content-Type 声明", () => {
    const html = bytes([
      [0xef, 0xbb, 0xbf],
      "<!doctype html><html><head><title>BOM</title></head>",
      "<body><article><h1>BOM</h1><p>Body.</p></article></body></html>",
    ]);

    const decoded = decodeHtmlBytes(html, "text/html; charset=gbk");

    expect(decoded.charset).toBe("utf-8");
    expect(decoded.warnings).toEqual([]);
    expect(decoded.html.startsWith("<!doctype html>")).toBe(true);
  });

  it("GBK 页面经解码后进入管线，标题与正文保持中文", () => {
    const decoded = decodeHtmlBytes(gbkPage(), "text/html; charset=gbk");
    const draft = buildScrapeDraft(
      decoded.html,
      "https://publisher.example/post"
    );

    expect(draft.title).toBe("中文文章");
    expect(draft.markdown).toContain("正文内容");
    expect(draft.warnings).toEqual([]);
  });
});
