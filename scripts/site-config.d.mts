/**
 * scripts/site-config.mjs 的类型声明（站点 / 部署环境配置单源）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */

export declare const DEFAULT_SITE_URL: string;
export declare const DEFAULT_WORKER_ORIGIN: string;
export declare const DEFAULT_API_PREFIX: string;
export declare const DEFAULT_SITEMAP_PAGE_SIZE: number;

export declare function normalizeOrigin(value: unknown): string;

export declare function resolveSiteUrl(
  env?: Record<string, string | undefined>
): string;

export declare function resolveWorkerOrigin(
  env?: Record<string, string | undefined>
): string;

export declare function resolveApiPrefix(
  env?: Record<string, string | undefined>
): string;

export declare function resolveSitemapApiBase(
  env?: Record<string, string | undefined>
): string;

export declare function resolvePositiveInt(
  value: string | undefined | null,
  fallback: number,
  name: string
): number;
