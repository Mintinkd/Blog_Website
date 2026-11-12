/**
 * 个人名片（/about 页）：前台解析与 HTML 渲染的唯一入口。
 *
 * 数据来源为 `GET /api/v1/config` 的 `profile_card`（JSON 字符串，后台可编辑），
 * 属于不可信输入：所有进入 innerHTML 的文本一律 escapeHtml / escapeAttr，
 * 所有 URL 走协议白名单，防存储型 XSS 与 `javascript:` 伪协议。
 *
 * 与 worker/src/utils/profile-card.ts 是**独立实现**：根包与 worker 是独立包，
 * 不跨包导入；后端严格拒绝非法输入，前端则一律容错降级（坏数据也不能白屏）。
 */
import { escapeAttr, escapeHtml } from "./escape";

export interface ProfileLink {
  label: string;
  url: string;
}

export interface ProfileCard {
  name: string;
  role: string;
  bio: string;
  avatar: string;
  links: ProfileLink[];
}

/** 与后端同口径的边界（独立字面量，避免跨包耦合） */
const LIMITS = {
  name: 80,
  role: 120,
  bio: 500,
  avatar: 500,
  label: 30,
  url: 500,
  maxLinks: 6,
} as const;

export function emptyProfileCard(): ProfileCard {
  return { name: "", role: "", bio: "", avatar: "", links: [] };
}

/** 放行 http(s)://、mailto: 与站内绝对路径；拒绝伪协议、协议相对 URL 与控制字符。 */
export function isSafeProfileUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const u = raw.trim();
  if (!u || /[\u0000-\u001f\u007f]/.test(u)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
    return /^(https?:\/\/|mailto:)/i.test(u);
  }
  return u.startsWith("/") && !u.startsWith("//");
}

/** 头像不接受 mailto: */
export function isSafeAvatarUrl(raw: unknown): boolean {
  return isSafeProfileUrl(raw) && !/^mailto:/i.test(String(raw).trim());
}

/**
 * 容错解析：接受 JSON 字符串或对象；坏 JSON / 类型异常 / 非法 URL 一律降级，
 * 绝不抛异常（about 页在接口失败时也要能显示占位名片）。
 */
export function parseProfileCard(raw: unknown): ProfileCard {
  const out = emptyProfileCard();
  let src: unknown = raw;
  if (typeof src === "string") {
    if (!src.trim()) return out;
    try {
      src = JSON.parse(src);
    } catch {
      return out;
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) return out;
  const obj = src as Record<string, unknown>;

  for (const field of ["name", "role", "bio", "avatar"] as const) {
    const v = obj[field];
    if (typeof v === "string") out[field] = v.trim().slice(0, LIMITS[field]);
  }
  if (out.avatar && !isSafeAvatarUrl(out.avatar)) out.avatar = "";

  if (Array.isArray(obj.links)) {
    for (const item of obj.links.slice(0, LIMITS.maxLinks)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const link = item as Record<string, unknown>;
      const label =
        typeof link.label === "string"
          ? link.label.trim().slice(0, LIMITS.label)
          : "";
      const url =
        typeof link.url === "string"
          ? link.url.trim().slice(0, LIMITS.url)
          : "";
      if (!label || !url || !isSafeProfileUrl(url)) continue;
      out.links.push({ label, url });
    }
  }
  return out;
}

export interface ProfileCardRenderOptions {
  /** 姓名为空时回退到站点名 */
  siteTitle?: string;
  /** 完全未配置时的引导文案 */
  emptyText?: string;
  /** 站点名也没有时的最终回退 */
  fallbackName?: string;
  ariaLabel?: string;
}

/**
 * 渲染名片 HTML（已全部转义，可直接赋给 innerHTML）。
 *
 * 降级规则：空头像 -> 姓名首字母色块；空姓名 -> 站点名 -> 「博主」；
 * 空职位 / 简介 -> 隐藏该行；无链接 -> 不渲染按钮区；
 * 完全未配置 -> 仍输出卡片骨架 + 首字母 + 站点名 + 一句引导文案。
 */
export function renderProfileCardHtml(
  card: ProfileCard | unknown,
  opts: ProfileCardRenderOptions = {}
): string {
  const p = parseProfileCard(card);
  const hasAny = Boolean(
    p.name || p.role || p.bio || p.avatar || p.links.length
  );
  const name = p.name || opts.siteTitle?.trim() || opts.fallbackName || "博主";
  const initial = Array.from(name.trim())[0] || "?";

  const avatarClass = p.avatar
    ? "profile-card__avatar"
    : "profile-card__avatar profile-card__avatar--fallback";
  const avatarInner = p.avatar
    ? `<img src="${escapeAttr(p.avatar)}" alt="${escapeAttr(name)}" loading="lazy" decoding="async" />`
    : `<span class="profile-card__avatar-initial" aria-hidden="true">${escapeHtml(initial)}</span>`;

  const roleHtml = p.role
    ? `<p class="profile-card__role">${escapeHtml(p.role)}</p>`
    : "";

  let bioHtml = "";
  if (p.bio) {
    bioHtml = `<p class="profile-card__bio">${escapeHtml(p.bio)}</p>`;
  } else if (!hasAny && opts.emptyText) {
    bioHtml = `<p class="profile-card__bio profile-card__bio--placeholder">${escapeHtml(opts.emptyText)}</p>`;
  }

  const linksHtml = p.links.length
    ? `<div class="profile-card__links">${p.links
        .map((link) => {
          const external = /^https?:\/\//i.test(link.url);
          const target = external ? ' target="_blank"' : "";
          const rel = external ? ' rel="noopener noreferrer"' : "";
          return `<a class="profile-card__link" href="${escapeAttr(link.url)}"${target}${rel}>${escapeHtml(link.label)}</a>`;
        })
        .join("")}</div>`
    : "";

  return `<section class="profile-card" aria-label="${escapeAttr(opts.ariaLabel || "博主名片")}">
  <div class="profile-card__head">
    <div class="${avatarClass}">${avatarInner}</div>
    <div class="profile-card__identity">
      <h2 class="profile-card__name">${escapeHtml(name)}</h2>
      ${roleHtml}
    </div>
  </div>
  ${bioHtml}
  ${linksHtml}
</section>`;
}
