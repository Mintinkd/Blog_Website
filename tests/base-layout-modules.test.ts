import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  __resetThemeLocaleForTests,
  initThemeLocale,
  resolveLocale,
  resolveTheme,
} from "../src/scripts/layout/theme-locale";
import { applySettings, getDefaultSettings } from "../src/utils/settings";

/**
 * issue #103 / L4：BaseLayout 内联 600 行拆分后的纯逻辑单测。
 *
 * 覆盖票面点名的三条关键路径：主题切换、settings 应用、i18n 切换。
 * DOM 相关断言用 jsdom（vitest.config.ts 默认环境）。
 */

function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-locale");
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  localStorage.clear();
  stubMatchMedia(false);
  // 模块级幂等标记跨用例复用，必须显式清掉——否则第一个用例绑定后，
  // 后续用例的 initThemeLocale() 都是空转，断言会在「没绑定」的状态下假通过。
  __resetThemeLocaleForTests();
});

describe("resolveTheme / resolveLocale（#103 纯函数）", () => {
  it.each(["light", "dark"] as const)("存储值 %s 优先于系统偏好", (stored) => {
    expect(resolveTheme(stored, true)).toBe(stored);
    expect(resolveTheme(stored, false)).toBe(stored);
  });

  it("无存储值 / 非法存储值时跟随系统偏好", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("sepia", true)).toBe("dark");
  });

  it("语言：存储值优先，否则按浏览器语言前缀判断", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh", "en-US")).toBe("zh");
    expect(resolveLocale(null, "zh-CN")).toBe("zh");
    expect(resolveLocale(null, "ZH-TW")).toBe("zh");
    expect(resolveLocale(null, "en-US")).toBe("en");
    expect(resolveLocale("fr", "en-GB")).toBe("en");
  });
});

describe("initThemeLocale（#103 主题 / 语言切换）", () => {
  it("首屏把存储的主题与语言写到 <html>，并渲染主题图标", async () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("locale", "en");
    document.body.innerHTML =
      '<button id="theme-toggle-btn"></button><button id="locale-toggle-btn"></button>';

    initThemeLocale();
    // i18n chunk 是动态 import，等一轮微任务
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-locale")).toBe("en");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // 暗色主题显示「太阳」图标（点击切回亮色）
    expect(document.getElementById("theme-toggle-btn")!.innerHTML).toContain(
      "<circle"
    );
  });

  it("点击主题按钮：切换 + 持久化 + 图标同步", () => {
    localStorage.setItem("theme", "light");
    document.body.innerHTML = '<button id="theme-toggle-btn"></button>';
    initThemeLocale();

    const btn = document.getElementById("theme-toggle-btn")!;
    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(btn.innerHTML).toContain("<circle");

    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(btn.innerHTML).toContain("<path");
  });

  it("点击语言按钮：zh ↔ en 切换并派发 locale-changed", async () => {
    localStorage.setItem("locale", "zh");
    document.body.innerHTML = '<button id="locale-toggle-btn"></button>';
    const changed = vi.fn();
    document.addEventListener("locale-changed", changed);

    initThemeLocale();
    document.getElementById("locale-toggle-btn")!.click();

    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-locale")).toBe("en");
    });
    expect(localStorage.getItem("locale")).toBe("en");
    expect(changed).toHaveBeenCalled();
  });

  it("ClientRouter 跨页（astro:after-swap）后重新同步 html 属性", () => {
    localStorage.setItem("theme", "dark");
    initThemeLocale();
    document.documentElement.removeAttribute("data-theme");

    document.dispatchEvent(new Event("astro:after-swap"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("applySettings（#103 settings 应用）", () => {
  it("注入 CSS 变量、功能开关与动效参数，并把关闭的功能标到 <html>", () => {
    const settings = getDefaultSettings();
    settings.features.comments = false;
    settings.motion.intensity = "reduced";
    settings.motion.parallax = false;
    settings.motion.parallaxSpeed = 0.08;

    applySettings(settings);

    const root = document.documentElement;
    expect(root.getAttribute("data-feature-comments")).toBe("off");
    expect(root.getAttribute("data-feature-search")).toBeNull();
    expect(root.getAttribute("data-motion-intensity")).toBe("reduced");
    expect(root.getAttribute("data-parallax")).toBe("off");
    expect(root.style.getPropertyValue("--parallax-speed")).toBe("0.08");

    // #111 item 2：断言具体节点 id（与 utils/settings.ts 的 STYLE_ID 一致）
    // 和关键 CSS 变量内容，不再用 `style ?? querySelector("style")` 兜底。
    // 旧测试查 "site-settings-style"（不存在）→ getElementById 返回 null
    // → fallback 到任意 <style> → toContain("--") 恒绿（假绿）。
    const styleEl = document.getElementById(
      "dynamic-settings"
    ) as HTMLStyleElement | null;
    expect(
      styleEl,
      "applySettings 应创建 id=dynamic-settings 的 <style> 节点"
    ).not.toBeNull();
    expect(styleEl!.id).toBe("dynamic-settings");
    // CSS 变量注入：textContent 必须含 -- 前缀的自定义属性
    expect(styleEl!.textContent).toContain("--");
    // 具体变量：parallax-speed 已在 root.style 上设值，
    // style 节点应包含其他 CSS 变量（如配色 / 布局）
    expect(styleEl!.textContent).toMatch(/--[a-z]/);
  });
});

describe("拆分后的结构约束（#103）", () => {
  it("BaseLayout 内联脚本只剩编排（< 40 行），逻辑都在 src/scripts/layout", () => {
    const astro = readFileSync(
      resolve(process.cwd(), "src/components/layout/BaseLayout.astro"),
      "utf8"
    );
    // 只统计非 is:inline 的编排脚本块
    const match = astro.match(/<script>\n([\s\S]*?)\n\s*<\/script>/);
    expect(match).not.toBeNull();
    const lines = match![1].trim().split("\n").length;
    expect(lines).toBeLessThan(40);

    // 模块 → 入口函数：既要 import 到，也要真的被调用。
    // 只断言 import 会被「导入了但忘了调用」骗过（review 指出）。
    const modules: Array<[string, string]> = [
      ["theme-locale", "initThemeLocale"],
      ["mobile-nav", "initMobileNav"],
      ["dynamic-title", "initDynamicTitle"],
      ["site-config", "initSiteConfig"],
      ["site-settings", "initSiteSettings"],
      ["motion-boot", "initMotionBoot"],
      ["back-to-top", "initBackToTop"],
      ["hitokoto", "initHitokotoWidget"],
      ["fetch-proxy", "initFetchWithProxy"],
      ["img-proxy-fallback", "initImgProxyFallback"],
      ["favicon-light", "initFaviconLight"],
    ];
    for (const [file, fn] of modules) {
      expect(astro).toContain(`../../scripts/layout/${file}`);
      expect(astro, `${fn} 应被编排块调用`).toMatch(
        new RegExp(`(^|\\s)${fn}\\(\\);`, "m")
      );
    }
  });

  it("BaseLayout 只有一个非内联 script 块，且不再残留业务逻辑", () => {
    const astro = readFileSync(
      resolve(process.cwd(), "src/components/layout/BaseLayout.astro"),
      "utf8"
    );
    const moduleScripts =
      astro.match(/<script>\n[\s\S]*?\n\s*<\/script>/g) ?? [];
    expect(moduleScripts).toHaveLength(1);

    // 这些是拆分前散在 BaseLayout 里的具体行为，现在都必须待在模块里
    for (const leaked of [
      'localStorage.setItem("theme"',
      'localStorage.setItem("locale"',
      'fetch("/api/v1/config")',
      "scrollY > 600",
    ]) {
      expect(astro).not.toContain(leaked);
    }
  });

  it("主题初始化仍保留在文档头部的 is:inline 脚本里（避免首屏闪色）", () => {
    const astro = readFileSync(
      resolve(process.cwd(), "src/components/layout/BaseLayout.astro"),
      "utf8"
    );
    const inlineScripts =
      astro.match(/<script is:inline>[\s\S]*?<\/script>/g) ?? [];
    expect(inlineScripts).toHaveLength(1);
    expect(inlineScripts[0]).toContain("data-theme");
  });
});
