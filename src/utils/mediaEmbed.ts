/**
 * 文章正文链接的内嵌预览增强（音频 / 视频 / 任意网页链接统一内嵌容器）。
 *
 * 三类链接统一由 `enhanceMediaLinks()` 扫描正文中的 `<a>` 并渲染为内嵌容器：
 * 1. 自动识别（与历史版本规则一致，历史文章零改动自动适配）：
 *    - 音频文件（.mp3/.wav/.ogg/.m4a/.flac/.aac）→ 内嵌容器 + 自定义音频播放器；
 *    - 视频文件（.mp4/.webm/.mov/.m3u8）→ 内嵌容器 + 原生视频播放器（点击封面加载）；
 *    - B 站视频页 / YouTube → 内嵌容器 + 官方播放器 iframe（点击封面加载）。
 * 2. 手动内嵌（编辑器「插入链接 → 内嵌网页预览」写入 `<a data-embed="1">`）：
 *    任意 https 链接 → 内嵌容器 + 目标页 iframe + 加载态与失败兜底。
 *
 * 降级策略：
 * - 非 http(s) 链接、以及已知禁止被内嵌（X-Frame-Options/FRAME-ANCESTORS 拒绝）的
 *   站点 → 不增强，保留普通链接展示；
 * - iframe / 媒体加载失败或超时 → 容器内兜底面板（新窗口打开 / 转为普通链接）。
 *
 * 使用方：`src/pages/articles/[slug].astro`（文章页）与 `src/admin/App.vue`
 * （编辑器预览）。DOM 操作框架无关，可多次调用（已增强节点跳过）。
 */

export type MediaEmbedKind = "audio" | "video" | "bili" | "youtube" | "web";

export interface MediaEmbedClassify {
  kind: MediaEmbedKind;
  /** bili / youtube 的官方播放器地址；其余类型为空 */
  embedUrl?: string;
}

/** 链接识别规则（与历史版本保持一致，勿随意收窄） */
const AUDIO_FILE_RE = /\.(mp3|wav|ogg|m4a|flac|aac)([?#].*)?$/i;
const VIDEO_FILE_RE = /\.(mp4|webm|mov|m3u8)([?#].*)?$/i;
const BILI_RE = /bilibili\.com\/video\/(BV[\w]+)/i;
const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i;

/**
 * 已知禁止被内嵌的站点（响应头带 X-Frame-Options: DENY/SAMEORIGIN 或等价
 * CSP frame-ancestors）。命中后直接降级为普通链接，不浪费一次注定失败的加载。
 * 名单宜少不宜多：只收录确定全局拒绝内嵌的头部站点。
 */
const FRAME_BLOCKED_HOST_RE =
  /(?:^|\.)(?:twitter|x|facebook|instagram|github)\.com$/i;

const RATES = [1, 1.5, 2, 0.5];

/** 内嵌容器内 UI 文案；文章页与编辑器预览共用（zh/en 双语）。 */
export interface MediaEmbedStrings {
  badgeAudio: string;
  badgeVideo: string;
  badgeBili: string;
  badgeYoutube: string;
  badgeWeb: string;
  loading: string;
  loadFailed: string;
  openExternal: string;
  asPlainLink: string;
  play: string;
  playbackRate: string;
  untitled: string;
}

const STRINGS: Record<"zh" | "en", MediaEmbedStrings> = {
  zh: {
    badgeAudio: "音频",
    badgeVideo: "视频",
    badgeBili: "B 站视频",
    badgeYoutube: "YouTube 视频",
    badgeWeb: "网页",
    loading: "正在加载内嵌预览…",
    loadFailed: "该内容无法内嵌展示",
    openExternal: "在新窗口打开",
    asPlainLink: "转为普通链接",
    play: "播放",
    playbackRate: "播放倍速",
    untitled: "媒体链接",
  },
  en: {
    badgeAudio: "Audio",
    badgeVideo: "Video",
    badgeBili: "Bilibili",
    badgeYoutube: "YouTube",
    badgeWeb: "Web",
    loading: "Loading embedded preview…",
    loadFailed: "This content cannot be embedded",
    openExternal: "Open in new tab",
    asPlainLink: "Show as plain link",
    play: "Play",
    playbackRate: "Playback rate",
    untitled: "Media link",
  },
};

export function getMediaEmbedStrings(locale: string): MediaEmbedStrings {
  return locale.toLowerCase().startsWith("en") ? STRINGS.en : STRINGS.zh;
}

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * 链接分类。返回 null 表示不属于任何可增强类型（普通链接，原样保留）。
 * `manualEmbed = true` 时任意 http(s) 链接都归为 `web`（编辑器手动内嵌）。
 */
export function classifyLink(
  href: string,
  manualEmbed = false
): MediaEmbedClassify | null {
  const url = href.trim();
  if (!/^https?:\/\//i.test(url)) return null;

  if (AUDIO_FILE_RE.test(url)) return { kind: "audio" };
  if (VIDEO_FILE_RE.test(url)) return { kind: "video" };

  const bm = url.match(BILI_RE);
  if (bm) {
    return {
      kind: "bili",
      embedUrl: `https://player.bilibili.com/player.html?bvid=${bm[1]}&autoplay=1&high_quality=1`,
    };
  }
  const ym = url.match(YT_RE);
  if (ym) {
    return {
      kind: "youtube",
      embedUrl: `https://www.youtube.com/embed/${ym[1]}?autoplay=1`,
    };
  }
  if (manualEmbed) return { kind: "web" };
  return null;
}

/** 站点已知禁止内嵌（只作用于手动 web 内嵌；播放器域不受此限）。 */
function isFrameBlockedHost(url: string): boolean {
  const host = hostOf(url);
  return !!host && FRAME_BLOCKED_HOST_RE.test(host);
}

function fmtTime(s: number): string {
  if (!isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return (m < 10 ? "0" + m : "" + m) + ":" + (ss < 10 ? "0" + ss : "" + ss);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l11-6.5a1 1 0 0 0 0-1.8l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
const ICON_AUDIO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17.5V6l10-2.2v10.2"/><circle cx="6.8" cy="17.5" r="2.8"/><circle cx="16.8" cy="14" r="2.8"/></svg>';

export interface EmbedCardOptions {
  href: string;
  title: string;
  kind: MediaEmbedKind;
  embedUrl?: string;
  strings: MediaEmbedStrings;
}

/** 统一内嵌容器骨架：标题栏（类型徽标 + 标题链接 + 域名）+ 渲染主体。 */
function buildCardShell(o: EmbedCardOptions): {
  card: HTMLElement;
  body: HTMLElement;
} {
  const card = el("figure", "md-embed");
  card.dataset.embedKind = o.kind;

  const badgeLabel =
    o.kind === "audio"
      ? o.strings.badgeAudio
      : o.kind === "video"
        ? o.strings.badgeVideo
        : o.kind === "bili"
          ? o.strings.badgeBili
          : o.kind === "youtube"
            ? o.strings.badgeYoutube
            : o.strings.badgeWeb;
  const badge = el("span", `md-embed-badge md-embed-badge--${o.kind}`);
  badge.textContent = badgeLabel;

  const title = el("a", "md-embed-title");
  title.href = o.href;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = o.title;

  const host = el("span", "md-embed-host");
  host.textContent = hostOf(o.href);

  const bar = el("div", "md-embed-bar");
  bar.append(badge, title, host);
  card.append(bar);

  const body = el("div", "md-embed-body");
  card.append(body);

  return { card, body };
}

/** 加载失败 / 超时的兜底面板：新窗口打开 + 转回普通链接。 */
function buildFallbackPanel(
  href: string,
  title: string,
  strings: MediaEmbedStrings,
  onDegrade: () => void
): HTMLElement {
  const panel = el("div", "md-embed-fallback");
  const msg = el("span", "md-embed-fallback-msg");
  msg.textContent = strings.loadFailed;

  const actions = el("div", "md-embed-fallback-actions");
  const open = el("a", "md-embed-fallback-link");
  open.href = href;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = strings.openExternal;
  const plain = el("button", "md-embed-fallback-btn");
  plain.type = "button";
  plain.textContent = strings.asPlainLink;
  plain.addEventListener("click", onDegrade);
  actions.append(open, plain);
  panel.append(msg, actions);
  return panel;
}

/** 音频播放器（完整迁移自旧版音频卡片：播放/进度/倍速控件不变）。 */
function buildAudioBody(o: EmbedCardOptions, body: HTMLElement): void {
  const wrap = el("div", "md-audio");
  wrap.innerHTML = `
    <span class="md-audio-icon">${ICON_AUDIO}</span>
    <div class="md-audio-main">
      <div class="md-audio-meta">--:--</div>
      <div class="md-audio-bar">
        <div class="md-audio-track"><i></i></div>
        <span class="md-audio-time"><span class="md-cur">00:00</span> / <span class="md-dur2">--:--</span></span>
      </div>
    </div>
    <button class="md-rate" type="button"></button>
    <button class="md-play" type="button">
      <svg class="p-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l11-6.5a1 1 0 0 0 0-1.8l-11-6.5A1 1 0 0 0 8 5.5z"/></svg>
      <svg class="s-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>
    </button>`;

  const audio = document.createElement("audio");
  audio.src = o.href;
  audio.preload = "metadata";
  audio.setAttribute("aria-label", o.title);
  wrap.prepend(audio);

  const playBtn = wrap.querySelector<HTMLButtonElement>(".md-play")!;
  playBtn.setAttribute("aria-label", o.strings.play);
  const rateBtn = wrap.querySelector<HTMLButtonElement>(".md-rate")!;
  rateBtn.setAttribute("aria-label", o.strings.playbackRate);
  rateBtn.textContent = "1.0x";
  const track = wrap.querySelector<HTMLElement>(".md-audio-track")!;
  const fill = track.querySelector("i")!;
  const cur = wrap.querySelector(".md-cur")!;
  const durEls = wrap.querySelectorAll(".md-audio-meta, .md-dur2");
  let rateIdx = 0;

  const degrade = () => {
    body.replaceChildren(
      buildFallbackPanel(o.href, o.title, o.strings, () => {
        degradeCardToLink(body);
      })
    );
  };

  audio.addEventListener("loadedmetadata", () => {
    durEls.forEach((d) => (d.textContent = fmtTime(audio.duration)));
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) {
      fill.style.width = (audio.currentTime / audio.duration) * 100 + "%";
    }
    cur.textContent = fmtTime(audio.currentTime);
  });
  audio.addEventListener("ended", () => wrap.classList.remove("is-playing"));
  // 元数据都拉不下来（404 / 防盗链 / MIME 不符）→ 兜底面板
  audio.addEventListener("error", degrade);

  playBtn.addEventListener("click", () => {
    if (audio.paused) void audio.play();
    else audio.pause();
    wrap.classList.toggle("is-playing");
  });
  rateBtn.addEventListener("click", () => {
    rateIdx = (rateIdx + 1) % RATES.length;
    audio.playbackRate = RATES[rateIdx];
    rateBtn.textContent = RATES[rateIdx] + "x";
  });

  const seek = (clientX: number) => {
    if (!audio.duration) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = pct * audio.duration;
    fill.style.width = pct * 100 + "%";
    cur.textContent = fmtTime(audio.currentTime);
  };
  let dragging = false;
  track.addEventListener("click", (e) => seek((e as MouseEvent).clientX));
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    seek(e.clientX);
  });
  track.addEventListener("pointermove", (e) => {
    if (dragging) seek(e.clientX);
  });
  ["pointerup", "pointercancel"].forEach((ev) =>
    track.addEventListener(ev, () => {
      dragging = false;
    })
  );

  body.append(wrap);
}

/**
 * 视频类主体（视频文件 / B 站 / YouTube）：封面点击后加载原生 <video> 或
 * 播放器 iframe（与旧版行为一致，只换容器）。
 */
function buildVideoBody(o: EmbedCardOptions, body: HTMLElement): void {
  const cover = el("div", "md-video-cover");
  const playBtn = el("button", "md-video-play");
  playBtn.type = "button";
  playBtn.setAttribute("aria-label", o.strings.play);
  playBtn.innerHTML = ICON_PLAY;
  cover.append(playBtn);

  const attach = (frame: HTMLElement) => {
    frame.classList.add("md-video-frame");
    cover.replaceWith(frame);
    if (frame instanceof HTMLIFrameElement) {
      frame.addEventListener("load", () => frame.classList.add("is-loaded"));
    }
  };

  const play = () => {
    if (o.kind === "video") {
      const v = document.createElement("video");
      v.src = o.href;
      v.controls = true;
      v.autoplay = true;
      v.preload = "metadata";
      // 源地址不可用（404 / MIME 不符）→ 兜底面板
      v.addEventListener("error", () => {
        v.replaceWith(
          buildFallbackPanel(o.href, o.title, o.strings, () => {
            degradeCardToLink(body);
          })
        );
      });
      attach(v);
    } else {
      const f = document.createElement("iframe");
      f.src = o.embedUrl || o.href;
      f.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
      f.allowFullscreen = true;
      f.title = o.title;
      attach(f);
    }
  };

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    play();
  });
  cover.addEventListener("click", play);
  body.append(cover);
}

/**
 * 任意网页主体：iframe + 加载态遮罩；load 后显示，error / 超时（12s）则
 * 换兜底面板。已知会拒绝内嵌的站点与非 https 链接在入口处已降级，不会走到这。
 */
function buildWebBody(o: EmbedCardOptions, body: HTMLElement): void {
  const frameWrap = el("div", "md-web-frame-wrap");

  const loading = el("div", "md-embed-loading");
  const spinner = el("span", "md-embed-spinner");
  const loadingText = el("span", "md-embed-loading-text");
  loadingText.textContent = o.strings.loading;
  loading.append(spinner, loadingText);

  const frame = document.createElement("iframe");
  frame.className = "md-web-frame";
  frame.src = o.href;
  frame.title = o.title;
  frame.loading = "lazy";
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.allow = "fullscreen; picture-in-picture; autoplay; clipboard-write";

  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) return;
    settle(false);
  }, 12000);

  const settle = (ok: boolean) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    loading.remove();
    if (ok) {
      frame.classList.add("is-loaded");
    } else {
      // 保留 frame 节点由面板取代展示，避免半加载状态闪烁
      frame.remove();
      frameWrap.append(
        buildFallbackPanel(o.href, o.title, o.strings, () => {
          degradeCardToLink(body);
        })
      );
    }
  };

  frame.addEventListener("load", () => settle(true));
  frame.addEventListener("error", () => settle(false));

  frameWrap.append(frame, loading);
  body.append(frameWrap);
}

/**
 * 兜底动作：整卡替换回原普通链接（保持正文可读、可点击）。
 * body 所在卡片即待替换节点。
 */
function degradeCardToLink(body: HTMLElement): void {
  const card = body.closest(".md-embed");
  if (!card || !(card instanceof HTMLElement)) return;
  const link = card.querySelector<HTMLAnchorElement>(".md-embed-title");
  const plain = el("a", "md-embed-degraded");
  if (link) {
    plain.href = link.href;
    plain.target = link.target;
    plain.rel = link.rel;
    plain.textContent = link.textContent || link.href;
  }
  card.replaceWith(plain);
}

/**
 * 扫描 root 下匹配 selector 的链接，按识别规则 / 手动标记渲染为统一内嵌容器。
 * 幂等：已处理节点（data-md-enhanced）跳过；可对重建后的 DOM 重复调用。
 */
export function enhanceMediaLinks(
  root: ParentNode,
  selector = ".prose a[href]",
  locale = "zh"
): void {
  const strings = getMediaEmbedStrings(locale);
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(selector));
  for (const a of links) {
    if (a.dataset.mdEnhanced) continue;
    // 容器自身的标题 / 兜底链接不参与二次增强（幂等关键）
    if (a.closest(".md-embed")) continue;
    const href = safeText(a.getAttribute("href") || "");
    if (!href) continue;

    const manualEmbed = a.dataset.embed === "1";
    const classified = classifyLink(href, manualEmbed);
    if (!classified) continue;

    // 手动 web 内嵌的降级入口：非 https（CSP frame-src https: 不放行）或
    // 已知拒绝内嵌的站点 → 保留普通链接
    if (
      classified.kind === "web" &&
      (!/^https:\/\//i.test(href) || isFrameBlockedHost(href))
    ) {
      a.dataset.mdEnhanced = "1";
      continue;
    }

    a.dataset.mdEnhanced = "1";

    const rawTitle = safeText(a.textContent || "");
    const fallbackName = href.split("/").pop()?.split(/[?#]/)[0] || "";
    const title =
      rawTitle ||
      (fallbackName ? safeText(decodeURIComponent(fallbackName)) : "") ||
      hostOf(href) ||
      strings.untitled;

    const o: EmbedCardOptions = {
      href,
      title,
      kind: classified.kind,
      embedUrl: classified.embedUrl,
      strings,
    };
    const { card, body } = buildCardShell(o);

    if (classified.kind === "audio") {
      buildAudioBody(o, body);
    } else if (classified.kind === "web") {
      buildWebBody(o, body);
    } else {
      buildVideoBody(o, body);
    }
    a.replaceWith(card);
  }
}
