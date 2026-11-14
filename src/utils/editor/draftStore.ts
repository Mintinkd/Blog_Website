/**
 * 本地草稿（GLOSSARY：本地草稿）的纯存储层：键、序列化、隔离、过期、配额。
 *
 * 不读取全局 localStorage —— storage 由调用方注入，因此可在 node 环境单测，
 * 也不依赖 DOM / Vue。契约见 docs/ARTICLE_EDITOR_UPGRADE.md §5.5 / §5.6：
 * 只存表单字段与基线信息，不存 token；打开时提示恢复而不自动覆盖服务端内容；
 * 保存 / 放弃 / 主动退出登录时清理；会话失效（10003）必须先落盘再退出，
 * 由 UI 决定是否调用 clearUserDrafts，reducer 不替 UI 做这个决定。
 */
export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_MAX_BYTES = 1024 * 1024;
export const DRAFT_KEY_PREFIX = "blog:article-draft";

export type DraftArticleId = number | "new";

export interface DraftScope {
  userId: number;
  articleId: DraftArticleId;
}

/** 与 src/admin/App.vue 的 emptyArticleForm() 字段一一对应。 */
export interface DraftForm {
  title: string;
  slug: string;
  summary: string;
  content: string;
  cover_image: string;
  category_id: string;
  status: string;
  tags: string[];
}

export interface ArticleDraft {
  version: number;
  userId: number;
  articleId: DraftArticleId;
  savedAt: number;
  /** 加载基线的内容哈希 / 标识，由 T3 填充；恢复后重新跑回写守卫。 */
  baselineHash: string;
  form: DraftForm;
}

/** 可注入的 storage 子集；length / key 仅在按用户批量清理时需要。 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export type DraftSaveResult =
  | { ok: true; key: string }
  | { ok: false; reason: "invalid-scope" | "oversize" | "storage-error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 白名单投影：额外字段（尤其 token）一律不进草稿。 */
function projectForm(input: unknown): DraftForm {
  const record = isRecord(input) ? input : {};
  return {
    title: asText(record.title),
    slug: asText(record.slug),
    summary: asText(record.summary),
    content: asText(record.content),
    cover_image: asText(record.cover_image),
    category_id: asText(record.category_id),
    status: asText(record.status),
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

export function isValidScope(scope: DraftScope): boolean {
  return (
    Number.isFinite(scope.userId) &&
    scope.userId > 0 &&
    (scope.articleId === "new" ||
      (Number.isFinite(scope.articleId) && scope.articleId > 0))
  );
}

/** 键含版本、用户 id、文章 id；新建文章用 `new`。 */
export function draftKey(scope: DraftScope): string {
  return `${DRAFT_KEY_PREFIX}:v${DRAFT_VERSION}:u${scope.userId}:a${scope.articleId}`;
}

export function createDraft(
  scope: DraftScope,
  form: DraftForm,
  options: { savedAt: number; baselineHash?: string }
): ArticleDraft {
  return {
    version: DRAFT_VERSION,
    userId: scope.userId,
    articleId: scope.articleId,
    savedAt: options.savedAt,
    baselineHash: options.baselineHash ?? "",
    form: projectForm(form),
  };
}

export function serializeDraft(draft: ArticleDraft): string {
  return JSON.stringify(draft);
}

/** UTF-8 字节数（不依赖 TextEncoder / DOM，node 与浏览器同结果）。 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** 解析并校验草稿；坏数据 / 版本不符一律返回 null，由读取方惰性清理。 */
export function parseDraft(raw: string | null): ArticleDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== DRAFT_VERSION) return null;
  if (!Number.isFinite(value.userId) || (value.userId as number) <= 0) {
    return null;
  }
  if (!(
    value.articleId === "new" ||
    (Number.isFinite(value.articleId) && (value.articleId as number) > 0)
  )) {
    return null;
  }
  if (!Number.isFinite(value.savedAt) || !isRecord(value.form)) return null;
  return {
    version: DRAFT_VERSION,
    userId: value.userId as number,
    articleId: value.articleId as DraftArticleId,
    savedAt: value.savedAt as number,
    baselineHash: asText(value.baselineHash),
    form: projectForm(value.form),
  };
}

export function saveDraft(
  storage: DraftStorage,
  scope: DraftScope,
  form: DraftForm,
  options: { savedAt: number; baselineHash?: string }
): DraftSaveResult {
  if (!isValidScope(scope)) return { ok: false, reason: "invalid-scope" };
  const draft = createDraft(scope, form, options);
  const serialized = serializeDraft(draft);
  if (utf8ByteLength(serialized) > DRAFT_MAX_BYTES) {
    return { ok: false, reason: "oversize" };
  }
  const key = draftKey(scope);
  try {
    storage.setItem(key, serialized);
  } catch {
    // localStorage 配额耗尽 / 隐私模式禁用写入：不抛到 UI，交由调用方提示一次。
    return { ok: false, reason: "storage-error" };
  }
  return { ok: true, key };
}

/** 读取时惰性清理：坏数据、串到别的用户 / 文章、超过 7 天未更新都删除。 */
export function loadDraft(
  storage: DraftStorage,
  scope: DraftScope,
  options: { now: number }
): ArticleDraft | null {
  if (!isValidScope(scope)) return null;
  const key = draftKey(scope);
  const raw = storage.getItem(key);
  const draft = parseDraft(raw);
  if (!draft) {
    if (raw !== null) storage.removeItem(key);
    return null;
  }
  if (draft.userId !== scope.userId || draft.articleId !== scope.articleId) {
    storage.removeItem(key);
    return null;
  }
  if (options.now - draft.savedAt > DRAFT_TTL_MS) {
    storage.removeItem(key);
    return null;
  }
  return draft;
}

export function clearDraft(storage: DraftStorage, scope: DraftScope): void {
  storage.removeItem(draftKey(scope));
}

/** 主动退出登录时清理该用户全部草稿；会话失效（10003）不得调用本函数。 */
export function clearUserDrafts(storage: DraftStorage, userId: number): number {
  const prefix = `${DRAFT_KEY_PREFIX}:v${DRAFT_VERSION}:u${userId}:`;
  const keys: string[] = [];
  if (typeof storage.key === "function" && typeof storage.length === "number") {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}
