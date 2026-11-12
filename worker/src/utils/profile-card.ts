/**
 * 个人名片配置（/about 页面顶部）的校验与净化 —— Worker 侧单一入口。
 *
 * 存储：site_config 表 key = 'profile_card'，value 为本模块输出的 JSON 字符串，
 * 由既有 `GET /config`（公开）与 `PUT /config`（admin）承载，不新增 API。
 *
 * 两道防线：后台表单只做便利校验，写入前一律经过这里；前台渲染另有独立的
 * 解析 / 转义实现（根包与 worker 是独立包，不跨包导入），避免坏数据或存储型 XSS。
 *
 * 关键约束：
 * - 只读取固定的 5 个字段，未知字段静默丢弃（防夹带额外内容）；
 * - 所有 URL 走协议白名单，拒绝 javascript: / data: / 协议相对 `//host`；
 * - 空字段合法（前台按「占位名片」降级），后台表单的空链接行直接丢弃。
 */
import { isPlainObject } from "./object";

export const PROFILE_CARD_KEY = "profile_card";

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

export const PROFILE_LIMITS = {
  name: 80,
  role: 120,
  bio: 500,
  avatar: 500,
  label: 30,
  url: 500,
  maxLinks: 6,
} as const;

export type NormalizeResult =
  { ok: true; value: ProfileCard } | { ok: false; message: string };

export function emptyProfileCard(): ProfileCard {
  return { name: "", role: "", bio: "", avatar: "", links: [] };
}

/**
 * 放行 http(s)://、mailto: 与站内绝对路径（单个 `/` 开头）。
 * 显式拒绝 javascript: / data: / vbscript: 等伪协议、`//host` 协议相对 URL，
 * 以及含控制字符的地址（防响应头 / 属性注入）。
 */
export function isSafeProfileUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const u = raw.trim();
  if (!u || /[\u0000-\u001f\u007f]/.test(u)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
    return /^(https?:\/\/|mailto:)/i.test(u);
  }
  return u.startsWith("/") && !u.startsWith("//");
}

/** 头像比普通链接更严：不接受 mailto:，只允许 http(s) 与站内路径 */
export function isSafeAvatarUrl(raw: unknown): boolean {
  return isSafeProfileUrl(raw) && !/^mailto:/i.test(String(raw).trim());
}

function fail(message: string): NormalizeResult {
  return { ok: false, message };
}

type TextField = "name" | "role" | "bio" | "avatar";

function readText(
  src: Record<string, unknown>,
  field: TextField,
  max: number
): string | NormalizeResult {
  const raw = src[field];
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") return fail(`名片字段 ${field} 必须是字符串`);
  if (raw.length > max) return fail(`名片字段 ${field} 超过 ${max} 字符`);
  return raw.trim();
}

/** 把任意输入净化成可安全落库的 ProfileCard；非法输入返回可读错误信息。 */
export function normalizeProfileCard(input: unknown): NormalizeResult {
  if (input !== undefined && input !== null && !isPlainObject(input)) {
    return fail("profile_card 必须是对象");
  }
  const src: Record<string, unknown> = isPlainObject(input) ? input : {};
  const value = emptyProfileCard();

  for (const field of ["name", "role", "bio"] as const) {
    const r = readText(src, field, PROFILE_LIMITS[field]);
    if (typeof r !== "string") return r;
    value[field] = r;
  }

  const avatar = readText(src, "avatar", PROFILE_LIMITS.avatar);
  if (typeof avatar !== "string") return avatar;
  if (avatar && !isSafeAvatarUrl(avatar)) return fail("头像地址不合法");
  value.avatar = avatar;

  const rawLinks = src.links;
  if (rawLinks !== undefined && rawLinks !== null) {
    if (!Array.isArray(rawLinks)) return fail("名片 links 必须是数组");
    for (const item of rawLinks) {
      if (!isPlainObject(item)) return fail("名片 links 每一项必须是对象");
      const label = item.label;
      const url = item.url;
      // 后台表单常留一行空占位：两个都空（含纯空白）直接跳过，不当成错误
      const blank = (v: unknown) =>
        v === undefined || v === null || (typeof v === "string" && !v.trim());
      if (blank(label) && blank(url)) continue;
      if (typeof label !== "string" || typeof url !== "string") {
        return fail("名片 links 的 label/url 必须是字符串");
      }
      if (
        label.length > PROFILE_LIMITS.label ||
        url.length > PROFILE_LIMITS.url
      ) {
        return fail("名片 links 的 label/url 超过长度限制");
      }
      if (!isSafeProfileUrl(url)) {
        return fail(`名片链接 ${label.trim()} 的地址不合法`);
      }
      if (!label.trim()) return fail("名片链接不能只有地址没有名称");
      value.links.push({ label: label.trim(), url: url.trim() });
      if (value.links.length > PROFILE_LIMITS.maxLinks) {
        return fail(`名片链接最多 ${PROFILE_LIMITS.maxLinks} 条`);
      }
    }
  }

  return { ok: true, value };
}

/** 解析 site_config 里的 JSON 字符串；空串视为「尚未配置」。 */
export function parseProfileCardJson(raw: string): NormalizeResult {
  if (!raw || !raw.trim()) return { ok: true, value: emptyProfileCard() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("profile_card 不是合法 JSON");
  }
  return normalizeProfileCard(parsed);
}

export function serializeProfileCard(value: ProfileCard): string {
  return JSON.stringify(value);
}
