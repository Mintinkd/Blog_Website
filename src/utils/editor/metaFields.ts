/**
 * 元信息面板的纯函数层（issue #67 / 编辑器 T6）。
 *
 * 与编辑器其它 T1 纯函数同源：不依赖 DOM / Vue 运行时，行为由
 * tests/editor-meta-fields.test.ts 用手写字面量钉住。组件只消费这些结果，
 * 不在这里第二实现「服务端口径」——slug 复用 generateSlug，字数复用
 * countWords / readingTimeMinutes，标题上限与 Worker validate() 对齐。
 */
import { generateSlug } from "./slug";
import { countWords, readingTimeMinutes } from "./wordCount";

/** 与 worker/src/handlers/article.ts 的 validate({ title: { maxLength: 200 } }) 一致。 */
export const TITLE_MAX_LENGTH = 200;

export interface PublishableForm {
  title: string;
  content: string;
  status: string;
}

export type PublishCheck =
  { ok: true } | { ok: false; missing: ("title" | "content")[] };

/**
 * 发布前检查：仅「已发布」要求标题与正文 trim 后非空；草稿不拦截。
 * 不追加服务端 validate 之外的长度 / 格式规则，避免前端擅自收紧口径。
 *
 * 已知张力（#67 票面措辞）：Worker 的 validate() 对 title / content 恒要求
 * minLength 1，与 status 无关；本票按票面把前端拦截限定在「发布」动作，
 * 草稿空标题 / 空正文仍会在保存时被服务端拒绝，错误由既有 save-failed 链路
 * 原样展示。统一这两处口径需要改票面语义，留作后续票，不在此擅自收紧。
 */
export function checkPublishReady(form: PublishableForm): PublishCheck {
  if (form.status !== "published") return { ok: true };
  const missing: ("title" | "content")[] = [];
  if (!form.title.trim()) missing.push("title");
  if (!form.content.trim()) missing.push("content");
  return missing.length ? { ok: false, missing } : { ok: true };
}

/**
 * 封面预览 URL：只放行绝对 http(s) URL，返回规范化 href 供 <img :src> 使用。
 * 相对路径、协议相对 URL、javascript:/data:/file:/ftp: 一律返回 null，
 * 由组件显示「无效地址 / 加载失败」占位，绝不把用户输入直接塞进 src。
 */
export function safeCoverUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    // 不传 base：相对路径与 //host 形式在这里应当被拒绝，而非补全成站点地址。
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export interface SlugLockState {
  slug: string;
  locked: boolean;
}

export type SlugAction =
  /** 打开 / 切文章：按服务端已有 slug 重建状态。 */
  | { type: "reset"; slug: string }
  /** 「根据标题生成」：复用 T1 规则，生成后默认锁定。 */
  | { type: "generate"; title: string }
  | { type: "unlock" }
  | { type: "lock" }
  | { type: "edit"; value: string };

/**
 * Slug 锁定状态机：默认留空由服务端生成；生成后锁定，可解锁手改。
 * 打开已有文章时服务端 slug 非空即锁定，避免误改线上链接；标题为空时
 * 生成结果为空且不锁定，不会把作者锁死在一个空值上。
 * 冲突由服务端返回错误原样展示，这里不改写、不追加后缀。
 */
export function reduceSlugLock(
  state: SlugLockState,
  action: SlugAction
): SlugLockState {
  switch (action.type) {
    case "reset":
      return { slug: action.slug, locked: action.slug.trim() !== "" };
    case "generate": {
      const slug = generateSlug(action.title);
      return { slug, locked: slug !== "" };
    }
    case "unlock":
      return { slug: state.slug, locked: false };
    case "lock":
      return { slug: state.slug, locked: true };
    case "edit":
      return state.locked
        ? { slug: state.slug, locked: true }
        : { slug: action.value, locked: false };
  }
}

/** 标签多时本地筛选：大小写不敏感的子串匹配，空查询返回副本。 */
export function filterTags(tags: string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...tags];
  return tags.filter((tag) => tag.toLocaleLowerCase().includes(needle));
}

export interface EditorReadingStats {
  words: number;
  chinese: number;
  english: number;
  minutes: number;
}

/** 元信息面板的字数 / 阅读时长读数，口径与服务端 calculateReadingTime 一致。 */
export function readingStats(markdown: string): EditorReadingStats {
  const { chinese, english, total } = countWords(markdown);
  return {
    words: total,
    chinese,
    english,
    minutes: readingTimeMinutes(markdown),
  };
}
