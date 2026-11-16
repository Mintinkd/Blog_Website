// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MOTION_BOOT_RE,
  MOTION_CHUNK_RE,
  isMotionChunkUrl,
} from "../scripts/article-ssr-fixture.mjs";

/**
 * #71 收尾：文章 SSR 回归「阻断 motion chunk」用例的匹配口径。
 *
 * 该用例的意图是阻断**动态 import** 的 motion 实现，让 `motion-boot.ts` 里的
 * catch 兜底打出 `data-motion-failed`。#103 / L4 把 BaseLayout 的内联脚本拆成
 * `src/scripts/layout/motion-boot.ts` 后，原正则 `/\/motion[\w.-]*\.(?:m?js|ts)$/`
 * 把引导模块本身也命中，等于兜底代码未注册，用例以「catch 兜底失效」假红。
 *
 * 这里只钉匹配器这一条 seam：入口 URL 形态是手写字面量（dev 未哈希 / 构建后
 * 带 hash），不从被测正则反推；真实阻断行为由 scripts/verify-article-ssr.mjs 覆盖。
 */

const DEV_MOTION_CHUNK = "http://localhost:4321/src/utils/motion.ts";
const DEV_MOTION_CHUNK_HMR =
  "http://localhost:4321/src/utils/motion.ts?t=1794872006000";
const DEV_BOOT_MODULE =
  "http://localhost:4321/src/scripts/layout/motion-boot.ts";
const DEV_BOOT_MODULE_HMR =
  "http://localhost:4321/src/scripts/layout/motion-boot.ts?t=1794872006000";
const BUILD_DASH_HASH = "https://blog.example.com/_astro/motion-8f2a1cbd.js";
const BUILD_DOT_HASH = "https://blog.example.com/motion.Bx1a2c.js";

describe("article-ssr fixture: motion chunk 匹配", () => {
  it("命中 dev 与构建产物里的 motion chunk", () => {
    for (const url of [
      DEV_MOTION_CHUNK,
      DEV_MOTION_CHUNK_HMR,
      BUILD_DASH_HASH,
      BUILD_DOT_HASH,
    ]) {
      expect(isMotionChunkUrl(url), url).toBe(true);
    }
  });

  it("放行引导模块 motion-boot（#103 拆出的静态 import）", () => {
    for (const url of [DEV_BOOT_MODULE, DEV_BOOT_MODULE_HMR]) {
      expect(isMotionChunkUrl(url), url).toBe(false);
    }
    expect(MOTION_CHUNK_RE.test(new URL(DEV_BOOT_MODULE).pathname)).toBe(true);
    expect(MOTION_BOOT_RE.test(new URL(DEV_BOOT_MODULE).pathname)).toBe(true);
  });

  it("放行与 motion 无关的模块，非法 URL 返回 false", () => {
    expect(isMotionChunkUrl("http://localhost:4321/src/utils/escape.ts")).toBe(
      false
    );
    expect(
      isMotionChunkUrl("http://localhost:4321/src/utils/motionless.ts")
    ).toBe(false);
    expect(isMotionChunkUrl("not a url")).toBe(false);
  });
});
