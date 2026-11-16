// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isMotionChunkUrl } from "../scripts/article-ssr-fixture.mjs";

/**
 * #71 收尾：文章 SSR 回归「阻断 motion chunk」用例的匹配口径。
 *
 * 该用例的意图是阻断**动态 import** 的 motion 实现，让 `motion-boot.ts` 里的
 * catch 兜底打出 `data-motion-failed`。#103 / L4 把 BaseLayout 的内联脚本拆成
 * `src/scripts/layout/motion-boot.ts` 后，原正则 `/\/motion[\w.-]*\.(?:m?js|ts)$/`
 * 把引导模块本身也命中，等于兜底代码未注册，用例以「catch 兜底失效」假红。
 *
 * 这里只钉 `isMotionChunkUrl` 这一条公开行为：入口 URL 全是手写字面量（dev 未
 * 哈希 / 构建后带 hash），不从被测正则反推；真实阻断与 ERR_FAILED 过滤由
 * `scripts/verify-article-ssr.mjs` 在浏览器里覆盖，不在本文件重复。
 */

/** 应当被阻断：动态 import 的 motion 实现（dev / 构建两种命名 + dev HMR 查询串）。 */
const BLOCKED_URLS = [
  "http://localhost:4321/src/utils/motion.ts",
  "http://localhost:4321/src/utils/motion.ts?t=1794872006000",
  "https://blog.example.com/_astro/motion-8f2a1cbd.js",
  "https://blog.example.com/motion.Bx1a2c.js",
];

/** 应当放行：引导模块（dev 与构建命名）、无关模块、非法 URL。 */
const PASSED_URLS = [
  "http://localhost:4321/src/scripts/layout/motion-boot.ts",
  "https://blog.example.com/_astro/motion-boot-8f2a1cbd.js",
  "http://localhost:4321/src/utils/escape.ts",
  "http://localhost:4321/src/utils/motionless.ts",
  "not a url",
];

describe("article-ssr fixture: motion chunk 匹配", () => {
  it("命中 dev 与构建产物里的 motion chunk", () => {
    for (const url of BLOCKED_URLS) {
      expect(isMotionChunkUrl(url), url).toBe(true);
    }
  });

  it("放行引导模块 motion-boot（#103 拆出的静态 import）", () => {
    expect(isMotionChunkUrl(PASSED_URLS[0]), PASSED_URLS[0]).toBe(false);
    expect(isMotionChunkUrl(PASSED_URLS[1]), PASSED_URLS[1]).toBe(false);
  });

  it("放行与 motion 无关的模块，非法 URL 返回 false", () => {
    for (const url of PASSED_URLS.slice(2)) {
      expect(isMotionChunkUrl(url), url).toBe(false);
    }
  });
});
