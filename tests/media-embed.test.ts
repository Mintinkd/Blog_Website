import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyLink, enhanceMediaLinks } from "../src/utils/mediaEmbed.ts";
import { renderMarkdown } from "../src/utils/markdown.ts";
import { renderMarkdownServer } from "../src/utils/markdownServer.ts";

/**
 * 内嵌网页链接预览（统一内嵌容器）：
 * - 链接识别规则（音频 / 视频文件 / B 站 / YouTube / 手动 web 内嵌）；
 * - DOM 增强：三类链接渲染为 .md-embed 容器，播放器组件在容器内加载；
 * - 历史兼容：未标记的旧音乐 / 视频链接自动适配新容器；
 * - 降级：非 https / 已知禁嵌站点保留普通链接；iframe 超时兜底 + 转普通链接；
 * - Markdown 管线：编辑器写入的 <a data-embed="1"> 在预览与 SSR 消毒后保留标记。
 */

function mountProse(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "prose";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("classifyLink 链接识别", () => {
  it("音频 / 视频文件扩展名", () => {
    expect(classifyLink("https://a.com/song.mp3")).toEqual({ kind: "audio" });
    expect(classifyLink("https://a.com/song.M4A?x=1")).toEqual({
      kind: "audio",
    });
    expect(classifyLink("https://a.com/clip.webm")).toEqual({ kind: "video" });
    expect(classifyLink("https://a.com/live.m3u8#t=1")).toEqual({
      kind: "video",
    });
  });

  it("B 站 / YouTube 视频页", () => {
    expect(classifyLink("https://www.bilibili.com/video/BV1xx411c7mD")).toEqual(
      {
        kind: "bili",
        embedUrl:
          "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=1&high_quality=1",
      }
    );
    expect(classifyLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual(
      {
        kind: "youtube",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1",
      }
    );
  });

  it("普通链接默认不增强；手动内嵌时归为 web", () => {
    expect(classifyLink("https://example.com/page")).toBeNull();
    expect(classifyLink("https://example.com/page", true)).toEqual({
      kind: "web",
    });
    // 非 http(s) 一律不增强（含手动内嵌）
    expect(classifyLink("javascript:alert(1)", true)).toBeNull();
    expect(classifyLink("ftp://x.com/a.mp3")).toBeNull();
  });
});

describe("enhanceMediaLinks 统一内嵌容器", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("音频链接：容器 + 完整音频播放器控件（播放/进度/倍速）", () => {
    const root = mountProse(
      '<p><a href="https://a.com/song.mp3">我的歌</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed");
    expect(card).not.toBeNull();
    expect(card?.dataset.embedKind).toBe("audio");
    expect(
      card?.querySelector("audio[src='https://a.com/song.mp3']")
    ).toBeTruthy();
    expect(card?.querySelector(".md-play")).toBeTruthy();
    expect(card?.querySelector(".md-rate")).toBeTruthy();
    expect(card?.querySelector(".md-audio-track")).toBeTruthy();
    // 标题栏：徽标 + 标题链接 + 域名
    expect(card?.querySelector(".md-embed-badge")?.textContent).toBe("音频");
    const title = card?.querySelector<HTMLAnchorElement>(".md-embed-title");
    expect(title?.textContent).toBe("我的歌");
    expect(title?.href).toBe("https://a.com/song.mp3");
    expect(card?.querySelector(".md-embed-host")?.textContent).toBe("a.com");
  });

  it("视频文件链接：封面点击后加载原生 video 播放器", () => {
    const root = mountProse('<p><a href="https://a.com/clip.mp4">片段</a></p>');
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed");
    expect(card?.dataset.embedKind).toBe("video");
    expect(card?.querySelector(".md-video-cover")).toBeTruthy();
    (card?.querySelector(".md-video-play") as HTMLElement).click();
    const video = card?.querySelector<HTMLVideoElement>("video.md-video-frame");
    expect(video?.getAttribute("src")).toBe("https://a.com/clip.mp4");
    expect(video?.controls).toBe(true);
  });

  it("B 站 / YouTube 链接：封面点击后加载官方播放器 iframe", () => {
    const root = mountProse(
      '<p><a href="https://www.bilibili.com/video/BV1xx411c7mD">视频</a></p>' +
        '<p><a href="https://youtu.be/dQw4w9WgXcQ">音乐视频</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const cards = root.querySelectorAll<HTMLElement>(".md-embed");
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.embedKind).toBe("bili");
    expect(cards[1].dataset.embedKind).toBe("youtube");

    (cards[0].querySelector(".md-video-cover") as HTMLElement).click();
    const biliFrame = cards[0].querySelector<HTMLIFrameElement>(
      "iframe.md-video-frame"
    );
    expect(biliFrame?.src).toBe(
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=1&high_quality=1"
    );

    (cards[1].querySelector(".md-video-cover") as HTMLElement).click();
    const ytFrame = cards[1].querySelector<HTMLIFrameElement>(
      "iframe.md-video-frame"
    );
    expect(ytFrame?.src).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"
    );
  });

  it("手动内嵌（data-embed=1）：任意 https 链接渲染为内嵌网页 iframe + 加载态", () => {
    const root = mountProse(
      '<p><a href="https://example.com/article" data-embed="1">好文</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed");
    expect(card?.dataset.embedKind).toBe("web");
    const frame = card?.querySelector<HTMLIFrameElement>(".md-web-frame");
    expect(frame?.src).toBe("https://example.com/article");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(card?.querySelector(".md-embed-loading")).toBeTruthy();
    expect(
      card?.querySelector(".md-embed-loading-text")?.textContent
    ).toContain("加载");
  });

  it("历史兼容：旧音乐 / 视频链接无任何标记也自动进入新容器", () => {
    const root = mountProse(
      '<p><a href="https://a.com/old.mp3"></a></p>' +
        '<p><a href="https://www.bilibili.com/video/BV1ab2345cd">标题</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const cards = root.querySelectorAll<HTMLElement>(".md-embed");
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.embedKind).toBe("audio");
    expect(cards[1].dataset.embedKind).toBe("bili");
    // 空文字音频链接回退为文件名标题
    expect(cards[0].querySelector(".md-embed-title")?.textContent).toBe(
      "old.mp3"
    );
  });

  it("普通链接不增强；幂等：重复调用不产生重复容器", () => {
    const root = mountProse(
      '<p><a href="https://example.com/plain">普通</a></p>' +
        '<p><a href="https://a.com/song.mp3">歌</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    enhanceMediaLinks(root, "a[href]");
    expect(root.querySelectorAll(".md-embed")).toHaveLength(1);
    const plain = root.querySelector<HTMLAnchorElement>(
      "a[href='https://example.com/plain']"
    );
    expect(plain).toBeTruthy();
    expect(plain?.dataset.mdEnhanced).toBeUndefined();
  });

  it("降级：手动内嵌的 http 链接与已知禁嵌站点保留普通链接", () => {
    const root = mountProse(
      '<p><a href="http://example.com/x" data-embed="1">HTTP</a></p>' +
        '<p><a href="https://github.com/a/b" data-embed="1">仓库</a></p>' +
        '<p><a href="https://x.com/user/status/1" data-embed="1">推文</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    expect(root.querySelectorAll(".md-embed")).toHaveLength(0);
    expect(root.querySelectorAll("a[data-md-enhanced]")).toHaveLength(3);
  });

  it("兜底：iframe 加载超时 → 失败面板 → 可转回普通链接", () => {
    vi.useFakeTimers();
    const root = mountProse(
      '<p><a href="https://example.com/slow" data-embed="1">慢页</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed");
    expect(card).not.toBeNull();

    // 12s 内未 load → 兜底面板
    vi.advanceTimersByTime(12500);
    const panel = card?.querySelector(".md-embed-fallback");
    expect(panel).toBeTruthy();
    expect(
      card?.querySelector<HTMLAnchorElement>(".md-embed-fallback-link")?.href
    ).toBe("https://example.com/slow");

    // 转为普通链接：整卡替换回锚点
    (card?.querySelector(".md-embed-fallback-btn") as HTMLElement).click();
    const degraded = root.querySelector<HTMLAnchorElement>(
      "a.md-embed-degraded"
    );
    expect(degraded).toBeTruthy();
    expect(degraded?.href).toBe("https://example.com/slow");
    expect(degraded?.textContent).toBe("慢页");
    expect(root.querySelector(".md-embed")).toBeNull();
  });

  it("兜底：iframe 正常 load 后移除加载态、不再触发超时降级", () => {
    vi.useFakeTimers();
    const root = mountProse(
      '<p><a href="https://example.com/ok" data-embed="1">好页</a></p>'
    );
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed")!;
    const frame = card.querySelector<HTMLIFrameElement>(".md-web-frame")!;
    frame.dispatchEvent(new Event("load"));
    expect(frame.classList.contains("is-loaded")).toBe(true);
    expect(card.querySelector(".md-embed-loading")).toBeNull();

    vi.advanceTimersByTime(13000);
    // load 已结算：超时不再触发兜底
    expect(card.querySelector(".md-embed-fallback")).toBeNull();
  });
});

describe("Markdown 管线保留内嵌标记", () => {
  it("预览（DOMPurify）与 SSR（sanitize-html）均保留 data-embed", () => {
    const md =
      '<a href="https://example.com/a" data-embed="1">内嵌</a>\n\n[普通](https://example.com/b)';
    const preview = renderMarkdown(md);
    const server = renderMarkdownServer(md);
    for (const html of [preview, server]) {
      expect(html).toContain('data-embed="1"');
      expect(html).toContain('href="https://example.com/a"');
    }
    // 服务端渲染结果可直接被 enhanceMediaLinks 识别为 web 内嵌
    const root = mountProse(server);
    enhanceMediaLinks(root, "a[href]");
    const card = root.querySelector<HTMLElement>(".md-embed");
    expect(card?.dataset.embedKind).toBe("web");
    // 普通链接不受影响
    expect(root.querySelector("a[href='https://example.com/b']")).toBeTruthy();
  });
});
