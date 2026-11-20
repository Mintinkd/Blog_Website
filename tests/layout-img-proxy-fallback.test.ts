// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initImgProxyFallback } from "../src/scripts/layout/img-proxy-fallback";

/**
 * issue #111 item 5：img-proxy-fallback 行为断言。
 *
 * 原先只有「被 import 且被调用」的结构断言（base-layout-modules.test.ts），
 * 改一行实现（如把 PROXY_PREFIX 写错）不会让结构断言红。
 * 这里补行为断言：模拟图片 error 事件，验证 src 被替换为代理 URL。
 */

describe("initImgProxyFallback（#111 item 5 行为断言）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("外链图片 error → src 替换为 /api/v1/img-proxy?url=<encoded>", () => {
    initImgProxyFallback();

    const img = document.createElement("img");
    img.src = "https://external.example.com/photo.png";
    document.body.appendChild(img);

    // 模拟浏览器触发 error 事件（capture phase，initImgProxyFallback 用 capture: true）
    img.dispatchEvent(
      new Event("error", { bubbles: false, cancelable: false })
    );

    expect(img.src).toBe(
      `${location.origin}/api/v1/img-proxy?url=${encodeURIComponent("https://external.example.com/photo.png")}`
    );
    expect(img.dataset.proxyDone).toBe("1");
  });

  it("本站图片 error → 不走代理（origin 相同）", () => {
    initImgProxyFallback();

    const img = document.createElement("img");
    img.src = `${location.origin}/local-image.png`;
    document.body.appendChild(img);

    img.dispatchEvent(new Event("error"));

    expect(img.dataset.proxyDone).toBeUndefined();
    expect(img.src).toBe(`${location.origin}/local-image.png`);
  });

  it("已代理过的图片再次 error → 标记 proxyFailed 并隐藏，不再重试", () => {
    initImgProxyFallback();

    const img = document.createElement("img");
    img.src = `${location.origin}/api/v1/img-proxy?url=https://external.example.com/photo.png`;
    document.body.appendChild(img);

    img.dispatchEvent(new Event("error"));

    expect(img.dataset.proxyFailed).toBe("1");
    expect(img.style.visibility).toBe("hidden");
  });

  it("非图片元素 error → 忽略", () => {
    initImgProxyFallback();

    const script = document.createElement("script");
    script.src = "https://external.example.com/broken.js";
    document.body.appendChild(script);

    script.dispatchEvent(new Event("error"));

    expect(script.dataset.proxyDone).toBeUndefined();
  });
});
