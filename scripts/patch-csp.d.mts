/**
 * scripts/patch-csp.mjs 的类型声明（构建期 CSP 收紧，issue #10 / #28）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */

/**
 * 收紧 dist 产物：先校验 _headers 与安全头模块渲染一致，再以模块为源构造收紧后
 * 的 CSP，替换静态与 SSR 产物中的基线 CSP；任一守卫（漂移 / 无内联脚本 / 残留 /
 * 不一致）失败即抛错。
 */
export declare function patchCsp(distDir: string): void;
