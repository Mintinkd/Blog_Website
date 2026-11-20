// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initFetchWithProxy } from "../src/scripts/layout/fetch-proxy";
import {
  __resetSiteConfigForTests,
  initSiteConfig,
} from "../src/scripts/layout/site-config";

/**
 * issue #103 / L4：从 BaseLayout 内联脚本抽出的两个模块的行为锁定。
 *
 * 这两个是 11 个模块里唯一「对外有契约」的：
 * - `fetch-proxy`：把 `window.fetchWithProxy` 挂成全站公共 API，并把「直连异常」的域
 *   持久化 7 天（写错会永久走代理，或把好域标记坏）。
 * - `site-config`：整会话只 fetch 一次配置，每次 `astro:page-load` 重应用（写错会在
 *   ClientRouter 导航后丢站点名 / 副标题，或者每次导航都打一次 `/config`）。
 *
 * 其余 9 个模块：
 * - `img-proxy-fallback`：有 URL 构造逻辑，行为断言在 `layout-img-proxy-fallback.test.ts`（#111 item 5）。
 * - 纯 DOM 装饰（back-to-top / dynamic-title / favicon-light / hitokoto / mobile-nav / motion-boot）：
 *   由 Playwright 的 `verify-all-pages-nav.mjs` 与 `visual-friendliness` 脚本覆盖，
 *   在 `docs/agents/testing.md` 明确标注（#111 item 5）。
 */

const PROXY_KEY = "fetch-proxy-domains";
const DAY = 24 * 60 * 60 * 1000;

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function installFetch(handler: (href: string) => Promise<Response> | Response) {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const href = hrefOf(input);
    calls.push(href);
    return handler(href);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

const proxyPrefix = () => `${location.origin}/api/v1/text-proxy?url=`;

describe("initFetchWithProxy（#103 外链降级代理）", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
    delete (window as unknown as { fetchWithProxy?: unknown }).fetchWithProxy;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("直连成功：只发一次直连，不写持久化标记", async () => {
    const { calls } = installFetch(() => new Response("ok", { status: 200 }));
    initFetchWithProxy();

    const res = await window.fetchWithProxy("https://api.example.com/data");

    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://api.example.com/data"]);
    expect(localStorage.getItem(PROXY_KEY)).toBeNull();
  });

  it("直连抛错 → 走 /api/v1/text-proxy 兜底，并把该域记住 7 天", async () => {
    const target = "https://blocked.example.com/x?y=1";
    const { calls } = installFetch((href) => {
      if (href.startsWith(proxyPrefix())) {
        return new Response("proxied", { status: 200 });
      }
      throw new TypeError("Failed to fetch");
    });
    initFetchWithProxy();

    const res = await window.fetchWithProxy(target);

    expect(await res.text()).toBe("proxied");
    expect(calls).toHaveLength(2);
    // 代理 URL 必须整段 encodeURIComponent，否则 goal 里的 query 会串到代理自己的参数
    expect(calls[1]).toBe(proxyPrefix() + encodeURIComponent(target));

    const saved = JSON.parse(localStorage.getItem(PROXY_KEY)!) as Record<
      string,
      number
    >;
    expect(saved["blocked.example.com"]).toBe(Date.now());
  });

  it("已标记的域在 7 天内不再直连（浏览器不碰目标站，避免证书警告）", async () => {
    localStorage.setItem(
      PROXY_KEY,
      JSON.stringify({ "blocked.example.com": Date.now() - 1 * DAY })
    );
    const { calls } = installFetch(
      () => new Response("proxied", { status: 200 })
    );
    initFetchWithProxy();

    const res = await window.fetchWithProxy("https://blocked.example.com/a");

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith(proxyPrefix())).toBe(true);
  });

  it("标记超过 7 天 → 恢复直连，且直连成功后清掉标记", async () => {
    localStorage.setItem(
      PROXY_KEY,
      JSON.stringify({ "blocked.example.com": Date.now() - 8 * DAY })
    );
    const { calls } = installFetch(() => new Response("ok", { status: 200 }));
    initFetchWithProxy();

    const res = await window.fetchWithProxy("https://blocked.example.com/a");

    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://blocked.example.com/a"]);
    const saved = JSON.parse(localStorage.getItem(PROXY_KEY)!) as Record<
      string,
      number
    >;
    expect(saved["blocked.example.com"]).toBeUndefined();
  });

  it("直连返回非 2xx：说明服务器可达，原样返回且不标记", async () => {
    const { calls } = installFetch(() => new Response("nope", { status: 500 }));
    initFetchWithProxy();

    const res = await window.fetchWithProxy("https://api.example.com/data");

    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
    expect(localStorage.getItem(PROXY_KEY)).toBeNull();
  });

  it("forceProxy：跳过直连直接走代理（调用方显式要求时）", async () => {
    const { calls } = installFetch(
      () => new Response("proxied", { status: 200 })
    );
    initFetchWithProxy();

    await window.fetchWithProxy("https://api.example.com/data", undefined, {
      forceProxy: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith(proxyPrefix())).toBe(true);
  });

  it("代理本身也失败 → 返回 502 JSON 兜底，不抛异常", async () => {
    installFetch((href) => {
      if (href.startsWith(proxyPrefix())) throw new TypeError("proxy down");
      throw new TypeError("direct down");
    });
    initFetchWithProxy();

    const res = await window.fetchWithProxy("https://api.example.com/data");

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 502 });
    // 代理也挂了就不该记这个域（记了会让后续 7 天都白走代理）
    expect(localStorage.getItem(PROXY_KEY)).toBeNull();
  });
});

describe("initSiteConfig（#103 站点配置重应用）", () => {
  const CONFIG = {
    code: 0,
    data: {
      site_title: "喵站",
      site_subtitle: "副标题",
      site_description: "站点描述",
    },
  };

  beforeEach(() => {
    localStorage.clear();
    // 模块级 bound + 缓存跨用例复用，必须清掉（否则后一个用例的 init 是空转，
    // 上一个用例缓存下来的配置会继续被应用到新 DOM 上）
    __resetSiteConfigForTests();
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <span id="site-logo-text">Blog</span>
      <span id="footer-text"></span>
      <h1 id="hero-site-title"></h1>
      <p id="hero-site-subtitle"></p>
      <p id="hero-site-desc"></p>
    `;
    const title = document.createElement("title");
    title.setAttribute("data-site-title", "");
    title.textContent = "首页";
    document.head.append(title);
    const desc = document.createElement("meta");
    desc.setAttribute("name", "description");
    document.head.append(desc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fire = () => document.dispatchEvent(new Event("astro:page-load"));

  it("首次 page-load 取一次配置并应用到 header / 页脚 / hero", async () => {
    const { mock } = installFetch(
      async () => new Response(JSON.stringify(CONFIG), { status: 200 })
    );
    initSiteConfig();

    fire();
    await vi.waitFor(() => {
      expect(document.getElementById("site-logo-text")!.textContent).toBe(
        "喵站"
      );
    });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe("/api/v1/config");
    expect(document.getElementById("footer-text")!.textContent).toContain(
      "喵站"
    );
    expect(document.getElementById("hero-site-title")!.textContent).toBe(
      "喵站"
    );
    expect(document.getElementById("hero-site-subtitle")!.textContent).toBe(
      "副标题"
    );
    expect(document.querySelector("title")!.textContent).toBe("喵站");
    expect(
      document
        .querySelector('meta[name="description"]')!
        .getAttribute("content")
    ).toBe("站点描述");
  });

  it("再次 page-load（导航后 DOM 被换回 SSR 默认值）→ 不重复 fetch，但重新应用", async () => {
    const { mock } = installFetch(
      async () => new Response(JSON.stringify(CONFIG), { status: 200 })
    );
    initSiteConfig();

    fire();
    await vi.waitFor(() => {
      expect(document.getElementById("site-logo-text")!.textContent).toBe(
        "喵站"
      );
    });

    // 模拟 ClientRouter 换 DOM：文案回到 SSR 默认值
    document.getElementById("site-logo-text")!.textContent = "Blog";
    document.getElementById("hero-site-title")!.textContent = "";

    fire();
    await vi.waitFor(() => {
      expect(document.getElementById("site-logo-text")!.textContent).toBe(
        "喵站"
      );
    });

    expect(mock).toHaveBeenCalledTimes(1); // 整会话只打一次 /config
    expect(document.getElementById("hero-site-title")!.textContent).toBe(
      "喵站"
    );
  });

  it("非首页标题不被覆盖（文章页动态标题保持现状）", async () => {
    installFetch(
      async () => new Response(JSON.stringify(CONFIG), { status: 200 })
    );
    document.querySelector("title")!.textContent = "某篇文章 | Blog";
    initSiteConfig();

    fire();
    await vi.waitFor(() => {
      expect(document.getElementById("site-logo-text")!.textContent).toBe(
        "喵站"
      );
    });

    expect(document.querySelector("title")!.textContent).toBe(
      "某篇文章 | Blog"
    );
  });

  it("code !== 0：保持 SSR 文案，不抛异常", async () => {
    installFetch(
      async () => new Response(JSON.stringify({ code: 500 }), { status: 200 })
    );
    initSiteConfig();
    fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("site-logo-text")!.textContent).toBe("Blog");
  });

  it("请求直接抛错：catch 兜住，保持 SSR 文案", async () => {
    installFetch(() => {
      throw new TypeError("network");
    });
    initSiteConfig();
    fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("site-logo-text")!.textContent).toBe("Blog");
  });

  it("重复 initSiteConfig 不重复挂监听（幂等）", async () => {
    const { mock } = installFetch(
      async () => new Response(JSON.stringify(CONFIG), { status: 200 })
    );
    initSiteConfig();
    initSiteConfig();

    fire();
    await vi.waitFor(() => {
      expect(document.getElementById("site-logo-text")!.textContent).toBe(
        "喵站"
      );
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
