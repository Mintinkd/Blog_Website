import type { APIRoute } from "astro";
import { speculationRulesResponse } from "../../scripts/cloudflare-guards.mjs";

/**
 * 自有空预取规则集端点（cloudflare-guards 的一半，见 docs/security/cloudflare-guards.md）
 *
 * Cloudflare Speed Brain 会在 origin 未声明 Speculation-Rules 时注入
 * `Speculation-Rules: "/cdn-cgi/speculation"`，浏览器对站内链接发起 Sec-Purpose:
 * prefetch；本站路由全部经 Pages Functions / Worker，边缘一律 503 拒绝，控制台持续
 * net::ERR_ABORTED 503。Cloudflare 口径：origin 自带 Speculation-Rules 头则「不会
 * 覆盖」→ _headers（静态页）与 middleware（SSR 页）把该头指向本端点，规则集刻意
 * 不匹配任何链接，浏览器不再发起预取。
 *
 * 动态渲染（prerender = false）以显式声明 MIME：HTML 规范要求规则集资源必须是
 * application/speculationrules+json，静态 .json 资产由 Pages 按 application/json
 * 提供，会被浏览器忽略；规则体与响应头均取自 cloudflare-guards 单源。
 */
export const prerender = false;

export const GET: APIRoute = () => speculationRulesResponse();
