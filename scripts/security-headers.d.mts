/**
 * scripts/security-headers.mjs 的类型声明（安全头模块单源，issue #28 / ADR 0002）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */

/** 全部 5 个响应头的基线值：CSP 基线 + 其余 4 头 */
export declare const SECURITY_HEADERS: Record<string, string>;

/** CSP 基线：声明态 CSP（script-src 含 'unsafe-inline'），#9/#10 指令内容原样 */
export declare const CSP_BASELINE: string;

/**
 * 以基线为源构造收紧后的 CSP：script-src 去 'unsafe-inline' + 追加给定 sha256
 * （内部排序，字节稳定）；基线形状异常时抛错。
 */
export declare function tightenCsp(hashes: readonly string[]): string;

/**
 * 收紧残留断言：script-src 指令内是否仍放行 'unsafe-inline'（其它指令的
 * 'unsafe-inline' 是预期保留，不计入）。
 */
export declare function scriptSrcAllowsUnsafeInline(csp: string): boolean;

/** 整文件渲染 public/_headers 生成物内容：生成标记注释 + 规则块（5 头全量） */
export declare function renderHeadersFile(): string;
