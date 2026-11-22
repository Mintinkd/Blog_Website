import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 首页 hero 主按钮的跳转目标是用户可见的导航契约：主按钮「浏览文章」
 * 进入全部分类页（`/categories`），不是 `/articles` 列表。
 *
 * 期望值为手写字面量（docs/agents/testing.md「独立来源」约定），
 * 改回 `/articles` 时这条守卫必须变红。
 */

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** 手写字面量：hero 两个按钮的文案 key → 目标路径 */
const HERO_LINKS = [
  { key: "hero.browse", href: "/categories" },
  { key: "hero.learn_more", href: "/about" },
] as const;

describe("首页 hero 按钮跳转目标", () => {
  it("主按钮「浏览文章」进全部分类页，次按钮进关于页", () => {
    const page = read("src/pages/index.astro");
    const actions = page.match(
      /<div class="hero-actions">([\s\S]*?)<\/div>/
    )?.[1];
    expect(
      actions,
      "src/pages/index.astro 缺少 .hero-actions 区块"
    ).toBeTruthy();

    const anchors = [...actions!.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(HERO_LINKS.length);

    for (const { key, href } of HERO_LINKS) {
      const anchor = anchors.find((a) => a.includes(`data-i18n="${key}"`));
      expect(anchor, `hero 按钮 ${key} 不存在`).toBeTruthy();
      expect(anchor).toContain(`href="${href}"`);
    }
  });
});
