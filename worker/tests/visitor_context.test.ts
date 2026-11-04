import { describe, expect, it } from "vitest";
import { readVisitorContext } from "../src/utils/visitor_context";

/**
 * issue #54：SSR 转发契约的 Worker 侧还原。
 *
 * 接缝：readVisitorContext(request) —— 只读 SSR 白名单头；
 * 缺失 / 空值归 null，不合成默认 UA/Accept；IP 只认 X-Real-IP，
 * 国家只认 X-Visitor-Country（不读第二跳的 CF-Connecting-IP / CF-IPCountry）。
 */
describe("访客上下文还原", () => {
  it("还原白名单头与 Sec-CH-UA* 客户端提示", () => {
    const context = readVisitorContext(
      new Request("https://api.example.test/api/v1/articles/ssr", {
        headers: {
          "x-real-ip": " 203.0.113.9 ",
          "user-agent": "Mozilla/5.0 Test",
          accept: "text/html,application/xhtml+xml",
          referer: "https://news.example.test/post",
          "accept-language": "zh-CN,zh;q=0.9",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-purpose": "prefetch",
          purpose: "prefetch",
          "x-visitor-country": "cn",
          "sec-ch-ua": '"Chromium";v="130"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-ch-ua-full-version-list": '"Chromium";v="130.0.0.0"',
          // 白名单外：不进入访客上下文。
          "sec-fetch-site": "same-origin",
        },
      })
    );

    expect(context).toEqual({
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0 Test",
      accept: "text/html,application/xhtml+xml",
      referer: "https://news.example.test/post",
      acceptLanguage: "zh-CN,zh;q=0.9",
      secFetchMode: "navigate",
      secFetchDest: "document",
      secPurpose: "prefetch",
      purpose: "prefetch",
      country: "CN",
      clientHints: {
        "sec-ch-ua": '"Chromium";v="130"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-full-version-list": '"Chromium";v="130.0.0.0"',
      },
    });
  });

  it("缺失或空值归 null，不合成默认 UA / Accept", () => {
    expect(
      readVisitorContext(new Request("https://api.example.test/x"))
    ).toEqual({
      ip: null,
      userAgent: null,
      accept: null,
      referer: null,
      acceptLanguage: null,
      secFetchMode: null,
      secFetchDest: null,
      secPurpose: null,
      purpose: null,
      country: null,
      clientHints: {},
    });

    const blank = readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: { "user-agent": "", accept: "   ", "x-real-ip": "  " },
      })
    );
    expect(blank.userAgent).toBeNull();
    expect(blank.accept).toBeNull();
    expect(blank.ip).toBeNull();
  });

  it("只认 SSR 转发的 X-Real-IP / X-Visitor-Country，不读 Cloudflare 直连头", () => {
    const context = readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "cf-ipcountry": "CN",
        },
      })
    );

    expect(context.ip).toBeNull();
    expect(context.country).toBeNull();
  });

  it("国家码归一为大写两位字母/数字；非法值归 null", () => {
    const cases: Array<[string, string | null]> = [
      [" cn ", "CN"],
      ["T1", "T1"],
      ["CHN", null],
      ["C", null],
      ["C!", null],
    ];

    for (const [raw, expected] of cases) {
      const context = readVisitorContext(
        new Request("https://api.example.test/x", {
          headers: { "x-visitor-country": raw },
        })
      );
      expect(context.country, raw).toBe(expected);
    }
  });
});
