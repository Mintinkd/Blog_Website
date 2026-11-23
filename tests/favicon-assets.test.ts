import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 标签图标契约：BaseLayout 里每个 icon 链接都必须指向 public/ 中真实存在的文件，
 * 且 PNG 的像素尺寸与 `sizes` 声明一致。
 *
 * 背景（2026-11-23）：`favicon.png` 曾是从别处导出的放大裁切版，和 `favicon.svg`
 * 构图不一致；iOS Safari < 26 不支持 SVG favicon，只能用 PNG，于是平板标签页
 * 显示的是被裁掉底的放大灯泡，与 Windows 上的 SVG 完全不同。这里把「链接 → 资产
 * → 尺寸」钉死，避免再出现声明与文件不匹配。
 */

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** 手写字面量：期望的 icon 集合（rel + type + sizes → href） */
const EXPECTED_ICONS = [
  {
    rel: "icon",
    type: "image/svg+xml",
    sizes: undefined,
    href: "/favicon.svg",
  },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
  {
    rel: "icon",
    type: "image/png",
    sizes: "192x192",
    href: "/favicon-192.png",
  },
  {
    rel: "apple-touch-icon",
    type: undefined,
    sizes: "180x180",
    href: "/apple-touch-icon.png",
  },
] as const;

function iconLinks(): Array<{
  rel: string;
  type: string;
  sizes: string;
  href: string;
}> {
  const layout = read("src/components/layout/BaseLayout.astro");
  const head = layout.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
  return [
    ...head.matchAll(/<link\s[^>]*rel="(?:icon|apple-touch-icon)"[^>]*>/g),
  ].map((m) => {
    const attr = (name: string) =>
      m[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    return {
      rel: attr("rel"),
      type: attr("type"),
      sizes: attr("sizes"),
      href: attr("href"),
    };
  });
}

/** 读取 PNG 的 IHDR：宽、高、颜色类型（2=RGB 无 alpha，6=RGBA） */
function pngInfo(path: string) {
  const buf = readFileSync(join(ROOT, path));
  expect(buf.subarray(1, 4).toString("ascii"), `${path} 不是 PNG`).toBe("PNG");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

describe("标签图标资产", () => {
  it("BaseLayout 声明的 icon 与预期一致", () => {
    const actual = iconLinks().map((l) => ({
      rel: l.rel,
      type: l.type || undefined,
      sizes: l.sizes || undefined,
      href: l.href,
    }));
    expect(actual).toEqual(EXPECTED_ICONS.map((i) => ({ ...i })));
  });

  it("每个 icon 链接都指向 public/ 中存在的文件", () => {
    for (const { href } of iconLinks()) {
      expect(existsSync(join(ROOT, "public", href)), `缺少 public${href}`).toBe(
        true
      );
    }
  });

  it("PNG 像素尺寸与 sizes 声明一致，apple-touch-icon 为不透明 RGB", () => {
    for (const { href, sizes } of iconLinks()) {
      if (!href.endsWith(".png")) continue;
      const { width, height, colorType } = pngInfo(`public${href}`);
      expect(`${width}x${height}`, `${href} 尺寸与 sizes 不符`).toBe(sizes);
      if (href === "/apple-touch-icon.png") {
        // iOS 会把透明区域合成到黑色，主屏图标必须是实色底
        expect(colorType, "apple-touch-icon 不应带 alpha 通道").toBe(2);
      }
    }
  });
});
