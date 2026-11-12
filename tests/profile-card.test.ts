import { describe, expect, it } from "vitest";
import {
  emptyProfileCard,
  isSafeAvatarUrl,
  isSafeProfileUrl,
  parseProfileCard,
  renderProfileCardHtml,
} from "../src/utils/profileCard.ts";

/**
 * 前台名片：容错解析 + 输出编码 + 占位降级。
 * URL 白名单期望值用手写字面量钉住（不从被测实现推导）。
 */

const SAFE_URLS = [
  "https://github.com/example",
  "http://example.com/feed",
  "mailto:hi@example.com",
  "/rss.xml",
  "/api/v1/media/serve/media/2026/11/a.png",
];

const UNSAFE_URLS = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "ftp://example.com/file",
  "//evil.example.com/x",
  "https://example.com/\nSet-Cookie: x=1",
  "",
  "   ",
];

describe("前台 URL 白名单", () => {
  it("放行 http(s) / mailto / 站内绝对路径", () => {
    for (const url of SAFE_URLS) expect(isSafeProfileUrl(url), url).toBe(true);
  });

  it("拒绝伪协议 / 协议相对 / 控制字符 / 空值", () => {
    for (const url of UNSAFE_URLS)
      expect(isSafeProfileUrl(url), url).toBe(false);
    expect(isSafeProfileUrl(undefined)).toBe(false);
    expect(isSafeProfileUrl(42)).toBe(false);
  });

  it("头像拒绝 mailto", () => {
    expect(isSafeAvatarUrl("mailto:hi@example.com")).toBe(false);
    expect(isSafeAvatarUrl("/api/v1/media/serve/a.png")).toBe(true);
  });
});

describe("parseProfileCard 容错", () => {
  it("空 / 坏输入一律降级为空名片，不抛异常", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "   ",
      "{not-json",
      123,
      [],
      ["x"],
    ]) {
      expect(parseProfileCard(raw)).toEqual(emptyProfileCard());
    }
  });

  it("接受 JSON 字符串与对象两种形态", () => {
    const payload = {
      name: "  老大 / Laoda  ",
      role: "独立开发者 · Indie Maker",
      bio: "记录代码、设计与生活。",
      avatar: "/api/v1/media/serve/a.png",
      links: [
        { label: "GitHub", url: "https://github.com/example" },
        { label: "Email", url: "mailto:hi@example.com" },
        { label: "RSS", url: "/rss.xml" },
      ],
    };
    expect(parseProfileCard(JSON.stringify(payload))).toEqual(
      parseProfileCard(payload)
    );
    expect(parseProfileCard(payload).name).toBe("老大 / Laoda");
    expect(parseProfileCard(payload).links).toHaveLength(3);
  });

  it("丢弃非法链接、空占位行与非法头像", () => {
    const card = parseProfileCard({
      avatar: "javascript:alert(1)",
      links: [
        { label: "", url: "" },
        { label: "XSS", url: "javascript:alert(1)" },
        { label: "GitHub", url: "https://github.com/example" },
      ],
    });
    expect(card.avatar).toBe("");
    expect(card.links).toEqual([
      { label: "GitHub", url: "https://github.com/example" },
    ]);
  });

  it("超长字段截断，链接最多 6 条", () => {
    const card = parseProfileCard({
      name: "x".repeat(200),
      links: Array.from({ length: 10 }, (_, i) => ({
        label: `L${i}`,
        url: "/rss.xml",
      })),
    });
    expect(card.name).toHaveLength(80);
    expect(card.links).toHaveLength(6);
  });
});

describe("renderProfileCardHtml 输出编码与降级", () => {
  it("完全未配置：仍输出卡片骨架 + 首字母 + 站点名 + 引导文案", () => {
    const html = renderProfileCardHtml(undefined, {
      siteTitle: "我的博客",
      emptyText: "博主还没有填写名片信息",
    });
    expect(html).toContain('class="profile-card"');
    expect(html).toContain("profile-card__avatar--fallback");
    expect(html).toContain("我");
    expect(html).toContain("我的博客");
    expect(html).toContain("博主还没有填写名片信息");
    expect(html).not.toContain('class="profile-card__links"');
    expect(html).not.toContain("<img");
  });

  it("完整配置：头像 / 姓名 / 职位 / 简介 / 三个胶囊链接", () => {
    const html = renderProfileCardHtml({
      name: "老大 / Laoda",
      role: "独立开发者 · Indie Maker",
      bio: "记录代码、设计与生活的博客作者，欢迎来逛逛。",
      avatar: "/api/v1/media/serve/a.png",
      links: [
        { label: "GitHub", url: "https://github.com/example" },
        { label: "Email", url: "mailto:hi@example.com" },
        { label: "RSS", url: "/rss.xml" },
      ],
    });
    expect(html).toContain('<img src="/api/v1/media/serve/a.png"');
    expect(html).toContain("老大 / Laoda");
    expect(html).toContain("独立开发者 · Indie Maker");
    expect(html).toContain("记录代码、设计与生活的博客作者，欢迎来逛逛。");
    expect(html.match(/class="profile-card__link"/g)).toHaveLength(3);
    // 外链新开且带 noopener；mailto / 站内链接不开新窗
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('href="/rss.xml"');
  });

  it("配置文本中的 HTML 全部转义，属性注入无法闭合", () => {
    const html = renderProfileCardHtml({
      name: "<img src=x onerror=alert(1)>",
      role: "<script>bad()</script>",
      bio: '"><svg onload=alert(1)>',
      avatar: '/a.png" onerror="alert(1)',
      links: [
        {
          label: "<b>GitHub</b>",
          url: 'https://example.com/" onmouseover="bad()',
        },
      ],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>GitHub</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    // 属性内的引号被编码，onerror 不会成为独立属性
    expect(html).not.toContain('src="/a.png" onerror=');
  });

  it("空职位 / 空简介隐藏该行，姓名回退站点名", () => {
    const html = renderProfileCardHtml(
      {
        name: "",
        role: "",
        bio: "",
        avatar: "",
        links: [{ label: "RSS", url: "/rss.xml" }],
      },
      { siteTitle: "站点名", emptyText: "引导文案" }
    );
    expect(html).toContain("站点名");
    expect(html).not.toContain('class="profile-card__role"');
    expect(html).not.toContain("引导文案"); // 有链接即视为已配置，不再显示引导
    expect(html.match(/class="profile-card__link"/g)).toHaveLength(1);
  });
});
