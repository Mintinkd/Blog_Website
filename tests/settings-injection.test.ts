// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCss,
  getDefaultSettings,
  sanitizeSettings,
  type SiteSettings,
} from "../src/utils/settings";

/**
 * issue #98 / M18：settings.ts 是把远端 JSON 写进 <style> 的唯一路径。
 * 本测试锁定字段白名单兜底（sanitizeSettings）+ CSS 构建（buildCss）对恶意 JSON 的免疫：
 * CSS 注入 / 非 http scheme / 类型污染 / NaN / 负数 / 超长值 / 容器被污染为字符串。
 * 期望值全部来自 getDefaultSettings() 的已知基线，不从被测函数反推。
 */

const DEFAULTS = getDefaultSettings();

function mutate(patch: Record<string, unknown>): SiteSettings {
  return { ...DEFAULTS, ...patch } as SiteSettings;
}

describe("settings 恶意 JSON 消毒不穿透（issue #98）", () => {
  it("bgImage 的 } 逃逸 + </style> 注入：回落默认，CSS 不含注入串", () => {
    const evil = mutate({
      background: {
        ...DEFAULTS.background,
        bgImage:
          '/x.png"); } body{display:none} </style><script>alert(1)</script>',
      },
    });
    const safe = sanitizeSettings(evil);
    expect(safe.background.bgImage).toBe(DEFAULTS.background.bgImage);
    const css = buildCss(evil);
    expect(css).not.toMatch(/display:none|alert|<\/style>/i);
    expect(css).toContain(DEFAULTS.background.bgImage);
  });

  it("bgImage 非 http(s) scheme（javascript: / data: / http:）各自回落默认", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "http://evil.com/x.png",
    ]) {
      const safe = sanitizeSettings(
        mutate({ background: { ...DEFAULTS.background, bgImage: bad } })
      );
      expect(safe.background.bgImage, bad).toBe(DEFAULTS.background.bgImage);
    }
    // 合法 https 外链保留
    const ok = "https://cdn.example.com/a.png";
    expect(
      sanitizeSettings(
        mutate({ background: { ...DEFAULTS.background, bgImage: ok } })
      ).background.bgImage
    ).toBe(ok);
  });

  it("数值字段 NaN / Infinity / 负数 / 超上限：按字段回落，不污染 CSS", () => {
    const cases: Array<[string, number]> = [
      ["bgOpacity", NaN],
      ["bgOpacity", Infinity],
      ["bgOpacity", -1],
      ["bgOpacity", 2],
      ["bgBlur", 999],
      ["bgBrightness", -5],
    ];
    for (const [key, value] of cases) {
      const safe = sanitizeSettings(
        mutate({ background: { ...DEFAULTS.background, [key]: value } })
      );
      expect(
        (safe.background as unknown as Record<string, unknown>)[key],
        `${key}=${value}`
      ).toBe((DEFAULTS.background as unknown as Record<string, number>)[key]);
    }
    const css = buildCss(
      mutate({ background: { ...DEFAULTS.background, bgOpacity: NaN } })
    );
    expect(css).not.toMatch(/NaN|Infinity|undefined/i);
  });

  it("容器被污染为字符串 / 数组：整段回落默认，不抛错", () => {
    for (const polluted of ["not-an-object", 42, ["theme"], null]) {
      const safe = sanitizeSettings(polluted as unknown as SiteSettings);
      expect(safe.theme.light.accent).toBe(DEFAULTS.theme.light.accent);
      expect(safe.background.bgImage).toBe(DEFAULTS.background.bgImage);
    }
    const themeString = mutate({ theme: " polluted " } as unknown as Record<
      string,
      unknown
    >);
    expect(sanitizeSettings(themeString).theme.light.accent).toBe(
      DEFAULTS.theme.light.accent
    );
  });

  it("copy 覆盖层超长值被截断（cap），非法类型丢弃", () => {
    const long = "x".repeat(3000);
    const safe = sanitizeSettings(
      mutate({
        copy: {
          zh: { "site.title": long, ok: "短文案" },
          en: { bad: 123 },
        },
      } as unknown as Record<string, unknown>)
    );
    expect(safe.copy.zh["site.title"]).toBeUndefined();
    expect(safe.copy.zh.ok).toBe("短文案");
    expect(safe.copy.en).toEqual({});
  });

  it("CSS 只含安全十六进制颜色与尺寸，不含原始注入文本", () => {
    const evil = mutate({
      theme: {
        ...DEFAULTS.theme,
        light: {
          ...DEFAULTS.theme.light,
          accent: "#fff; url(javascript:alert(1))",
        },
      },
    });
    const css = buildCss(evil);
    expect(css).toContain(
      `--color-accent: ${DEFAULTS.theme.light.accent} !important`
    );
    expect(css).not.toMatch(/javascript:|alert/i);
  });
});
