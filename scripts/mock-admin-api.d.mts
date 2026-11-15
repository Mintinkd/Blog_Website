/**
 * scripts/mock-admin-api.mjs 的类型声明（issue #68 / T7）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */

export declare const EDITOR_ARTICLE_ID: number;
export declare const EDITOR_ARTICLE_SLUG: string;
export declare const BASE_MARKER: string;
export declare const FOOTER_MARKER: string;
export declare const MOCK_UPLOAD_URL: string;

/** 打开后应进入 WYSIWYG 的安全语料（手写字面量）。 */
export declare const SAFE_MARKDOWN: string;
/** 应触发回写守卫进入源码模式的有损语料。 */
export declare const LOSSY_MARKDOWN: string;

export interface AdminApiFlags {
  failLoad: boolean;
  failSave: boolean;
  lockConflict: boolean;
  verifyConflict: boolean;
}

export interface AdminApiStats {
  putRequests: number;
  postRequests: number;
  lockAcquireRequests: number;
  lockDeleteRequests: number;
  lockForceRequests: number;
  uploadRequests: number;
  savedBodies: Record<string, unknown>[];
  flags: AdminApiFlags;
  articles: Record<string, unknown>[];
}

export interface AdminApiResponse {
  status: number;
  /** fixture 的 data 是任意 JSON 读模型，与 src/admin/composables/useAdminApi.ts 的 createAdminApi 一致。 */
  body: {
    code: number;
    message: string;
    data: any;
  };
}

export interface AdminApiState {
  /** null 表示该请求不由 admin 层处理，交回 SSR mock 分支。 */
  handle(
    method: string,
    pathWithQuery: string,
    body?: Record<string, unknown> | null
  ): AdminApiResponse | null;
  stats(): AdminApiStats;
  control(patch?: Partial<AdminApiFlags>): AdminApiFlags;
  reset(): void;
}

export declare function createAdminApiState(): AdminApiState;
