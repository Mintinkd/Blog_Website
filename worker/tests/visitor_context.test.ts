import { describe, expect, it } from "vitest";
import { readVisitorContext } from "../src/utils/visitor_context";
import { IP_SIGNING_HEADER, signClientIp } from "../src/utils/client_ip";

/**
 * issue #54：SSR 转发契约的 Worker 侧还原。
 *
 * 接缝：readVisitorContext(request, secret) —— 只读 SSR 白名单头；
 * 缺失 / 空值归 null，不合成默认 UA/Accept；IP 只认**验签通过**的 X-Real-IP
 * （2026-11-17 审查收口：此前直读头，直连者可伪造），国家只认
 * X-Visitor-Country（不读第二跳的 CF-Connecting-IP / CF-IPCountry）。
 */
const SECRET = "issue54-visitor-context-secret";
const VISITOR_IP = "203.0.113.9";

describe("访客上下文还原", () => {
  it("还原白名单头与 Sec-CH-UA* 客户端提示", async () => {
    const signature = await signClientIp(VISITOR_IP, SECRET);
    const context = await readVisitorContext(
      new Request("https://api.example.test/api/v1/articles/ssr", {
        headers: {
          "x-real-ip": ` ${VISITOR_IP} `,
          [IP_SIGNING_HEADER]: signature!,
          "user-agent": "Mozilla/5.0 Test",
          accept: "text/html,application/xhtml+xml",
          referer: "https://news.example.test/post",
          "accept-language": "zh-CN,zh;q=0.9",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          "sec-purpose": "prefetch",
          purpose: "prefetch",
          "x-purpose": "preview",
          "x-visitor-country": "cn",
          "sec-ch-ua": '"Chromium";v="130"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-ch-ua-full-version-list": '"Chromium";v="130.0.0.0"',
          // 白名单外：不进入访客上下文。
          "sec-fetch-site": "same-origin",
        },
      }),
      SECRET
    );

    expect(context).toEqual({
      ip: VISITOR_IP,
      userAgent: "Mozilla/5.0 Test",
      accept: "text/html,application/xhtml+xml",
      referer: "https://news.example.test/post",
      acceptLanguage: "zh-CN,zh;q=0.9",
      secFetchMode: "navigate",
      secFetchDest: "document",
      secPurpose: "prefetch",
      purpose: "prefetch",
      xPurpose: "preview",
      country: "CN",
      clientHints: {
        "sec-ch-ua": '"Chromium";v="130"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-full-version-list": '"Chromium";v="130.0.0.0"',
      },
    });
  });

  it("缺失或空值归 null，不合成默认 UA / Accept", async () => {
    expect(
      await readVisitorContext(
        new Request("https://api.example.test/x"),
        SECRET
      )
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
      xPurpose: null,
      country: null,
      clientHints: {},
    });

    const blank = await readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: { "user-agent": "", accept: "   ", "x-real-ip": "  " },
      }),
      SECRET
    );
    expect(blank.userAgent).toBeNull();
    expect(blank.accept).toBeNull();
    expect(blank.ip).toBeNull();
  });

  it("只认 SSR 转发的 X-Real-IP / X-Visitor-Country，不读 Cloudflare 直连头", async () => {
    const context = await readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          "cf-ipcountry": "CN",
        },
      }),
      SECRET
    );

    expect(context.ip).toBeNull();
    expect(context.country).toBeNull();
  });

  it("未签名 / 签名错误的 X-Real-IP 一律不采信，也不回退 CF-Connecting-IP（2026-11-17 审查）", async () => {
    const forged = await readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: {
          "x-real-ip": "203.0.113.66",
          "cf-connecting-ip": "198.51.100.1",
        },
      }),
      SECRET
    );
    expect(forged.ip).toBeNull();

    const wrongSignature = await readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: {
          "x-real-ip": VISITOR_IP,
          [IP_SIGNING_HEADER]: "deadbeef",
          "cf-connecting-ip": "198.51.100.1",
        },
      }),
      SECRET
    );
    expect(wrongSignature.ip).toBeNull();
  });

  it("secret 未配置时签名通过的 X-Real-IP 也 fail-closed（ip 归 null）", async () => {
    const signature = await signClientIp(VISITOR_IP, SECRET);
    const context = await readVisitorContext(
      new Request("https://api.example.test/x", {
        headers: {
          "x-real-ip": VISITOR_IP,
          [IP_SIGNING_HEADER]: signature!,
        },
      }),
      undefined
    );

    expect(context.ip).toBeNull();
  });

  it("国家码归一为大写两位字母/数字；非法值归 null", async () => {
    const cases: Array<[string, string | null]> = [
      [" cn ", "CN"],
      ["T1", "T1"],
      ["CHN", null],
      ["C", null],
      ["C!", null],
    ];

    for (const [raw, expected] of cases) {
      const context = await readVisitorContext(
        new Request("https://api.example.test/x", {
          headers: { "x-visitor-country": raw },
        }),
        SECRET
      );
      expect(context.country, raw).toBe(expected);
    }
  });
});
