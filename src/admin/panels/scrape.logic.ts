/**
 * ScrapePanel 的可测纯逻辑接缝。不依赖 DOM / Vue / window / fetch，
 * 且仅以 type-only 方式引用 scrape.ts 的类型——抓取管线运行时仍由面板
 * `await import("../../utils/scrape")` 惰性加载，绝不进入后台首屏 chunk。
 */
import type { ScrapeDraft, ScrapeWarning } from "../../utils/scrape";

export interface ScrapePreviewMeta {
  finalUrl: string;
  robotsStatus: "allowed" | "unchecked";
  charset: string;
}

/** 与 App.vue 的 SCRAPE_WARNING_KEYS 逐字一致；面板内 scrapeWarningText 调 t()。 */
export const SCRAPE_WARNING_KEYS: Record<ScrapeWarning, string> = {
  no_article: "admin.scrape_warning_no_article",
  readability_failed: "admin.scrape_warning_readability_failed",
  convert_failed: "admin.scrape_warning_convert_failed",
  charset_fallback: "admin.scrape_warning_charset_fallback",
};

export function scrapeWarningKey(warning: ScrapeWarning): string {
  return SCRAPE_WARNING_KEYS[warning];
}

/** 注入 t 的纯函数版；面板里保留同名 scrapeWarningText(warning) = t(key)。 */
export function scrapeWarningText(
  warning: ScrapeWarning,
  translate: (key: string) => string
): string {
  return translate(scrapeWarningKey(warning));
}

/** 解码 warnings 在前、草稿 warnings 在后，meta 与 draft 逐字合并。 */
export function previewFromDraft(
  draft: ScrapeDraft,
  warnings: ScrapeWarning[],
  meta: ScrapePreviewMeta
): ScrapeDraft & ScrapePreviewMeta {
  return {
    ...meta,
    ...draft,
    warnings: [...warnings, ...draft.warnings],
  };
}

/** 初次抓取与 selector 重提取共用同一组标签 / 日期参数。 */
export function buildScrapeOptions(existingTags: string[], scrapedAt: Date) {
  return { existingTags, scrapedAt };
}

/** X-Final-URL 解码；非法 percent-encoding 回退原始 header。 */
export function resolveFinalUrl(target: string, header: string | null): string {
  if (!header) return target;
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

/** X-Robots-Status 仅 allowed 放行，其余一律 unchecked。 */
export function resolveRobotsStatus(
  header: string | null
): "allowed" | "unchecked" {
  return header === "allowed" ? "allowed" : "unchecked";
}
