/**
 * scripts/cloudflare-guards.mjs 的类型声明（Cloudflare 平台注入护栏单源，2026-10-20）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */

/** 自有空规则集路径（src/pages/speculation-rules.ts 提供） */
export declare const SPECULATION_RULES_PATH: string;

/** 规则集 MIME：HTML 规范要求 application/speculationrules+json，否则浏览器忽略 */
export declare const SPECULATION_RULES_CONTENT_TYPE: string;

/** 空规则集 JSON 体（document 规则永不匹配任何链接） */
export declare const SPECULATION_RULES_BODY: string;

/** 静态 HTML 护栏的 Cache-Control 基线：Pages 默认值 + no-transform */
export declare const NO_TRANSFORM_CACHE_CONTROL: string;

/** Speculation-Rules 头值（URL 加引号） */
export declare const SPECULATION_RULES_HEADER_VALUE: string;

/** HTML 文档护栏头基线（public/_headers 规则块与 middleware 共用） */
export declare const HTML_GUARD_HEADERS: Record<string, string>;

/** 需要护栏的预渲染 HTML 路由（新增预渲染页面时同步） */
export declare const HTML_ROUTE_PATTERNS: readonly string[];

/** 依 content-type 判定 HTML 文档响应（含 charset 参数，大小写不敏感） */
export declare function isHtmlDocument(
  contentType: string | null | undefined
): boolean;

/** Cache-Control 追加 no-transform（保留已有指令；已含则幂等；空值只留 no-transform） */
export declare function appendNoTransform(
  cacheControl: string | null | undefined
): string;

/** 给 HTML 文档响应追加护栏（就地修改 Headers；非 HTML 不动） */
export declare function guardHtmlResponse(
  headers: Headers,
  contentType: string | null | undefined
): void;

/** 空规则集端点的响应（正确 MIME + 浏览器长缓存） */
export declare function speculationRulesResponse(): Response;
