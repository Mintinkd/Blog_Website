import { Env } from "../index";
import { getClientIpString } from "../utils/client_ip";
import { consumeRateLimit } from "../utils/rate_limiter";

/**
 * 外链图片智能代理（GET /img-proxy?url=...）
 *
 * 设计目标：
 * 1. 外链图片因防盗链（Referer 校验）、域名失效等无法直接显示时，前端 img onerror
 *    自动把 src 换成本站 /api/v1/img-proxy?url=<原图>，由本 handler 代理拉取。
 * 2. 安全性（P1-8 / issue #14 加固）：
 *    - 仅接受 http/https，URL 长度限制；
 *    - 统一 validateTargetUrl 校验：拒绝内网/保留地址（IPv4 私有段、IPv6 回环/
 *      未指定/唯一本地/链路本地、IPv4-mapped 与 IPv4-compatible 的十六进制形式、
 *      localhost、内部域名、workers.dev 递归代理等）；
 *    - 解析后 IP 复核（issue #19）：域名经 DoH（A/AAAA）解析，任一结果落入受限段即拒绝；
 *      解析失败/超时/无记录 fail-closed 拒绝；每一跳重定向同样复核（TOCTOU 说明见函数注释）；
 *    - #88 / H10：解析判定只在 RESOLUTION_TTL_MS 内复用，过期即重新 DoH，缩短校验到建连的窗口；
 *      blocked 判定写结构化日志（[ssrf-blocked] JSON）供告警；连接级绑定仍为已知残余风险。
 *    - 重定向不自动跟随（redirect: 'manual'），每一跳都复用同一校验，超跳数报错；
 *    - 请求头净化：去掉 Referer/Cookie，防被当作中间人带出敏感上下文；
 *    - 仅允许图片 Content-Type，响应体流式读取、超 10MB 即取消上游（不整块入内存）；
 *    - 总超时覆盖「重定向 + 响应头 + 响应体读取」全程；
 *    - 每 IP 独立限流（默认 120 次/分钟）。
 * 3. 用户体验：命中 KV 缓存直接返回（浏览器侧再配 Cache-Control），代理仅在直连失败
 *    时触发，用户基本无感。
 * 4. 缓存自动过期删除：KV 写入带 expirationTtl（24h），过期由 KV 自动清理，无需手动删。
 */

const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/x-icon",
  "image/bmp",
  "image/tiff",
  "image/jxl",
];

/**
 * SVG 响应纵深防御头（issue #93 / M7）。
 *
 * 外链 SVG 若以 image/svg+xml 在博客源下内联返回，内嵌 <script> 可同源执行。
 * 唯一拦截原本是 API 侧 CSP（单点防护）——本函数给 SVG 响应额外加：
 *   - Content-Disposition: attachment（attachment 处置与 media.ts 一致；<img src> 展示不受影响）
 *   - 沙箱 CSP default-src 'none'; sandbox（即使 CSP 主策略失效仍隔离脚本）
 *   - nosniff（防 MIME 嗅探成 HTML）
 * 与 media.ts 的 serve 路径口径相同。非 SVG 返回空对象，响应头完全不变。
 */
export function svgSafeHeaders(contentType: string): Record<string, string> {
  const mime = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (mime !== "image/svg+xml") return {};
  return {
    "Content-Disposition": "attachment",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_URL_LEN = 2048;
export const MAX_REDIRECTS = 5;
export const CACHE_TTL = 60 * 60 * 24; // 24h，到期 KV 自动删除
export const FETCH_TIMEOUT_MS = 10_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 120; // 每 IP 每分钟

// 拒绝的域名：内部/保留/示例域名，及 Cloudflare workers.dev（防递归代理本站 API）
export const BLOCKED_HOST_RE =
  /(^|\.)(localhost|local|internal|intranet|example\.com|example\.org|example\.net|test|invalid|onion|home|lan)$/i;
export const WORKERS_DEV_RE = /\.workers\.dev$/i;

function isBlockedIpv4(ip: string): boolean {
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip) ||
    /^0\./.test(ip) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)
  );
}

/** 解析 IPv6 字面量为 8 组 16 位值；非法返回 null */
function parseIpv6(addr: string): number[] | null {
  if (!addr.includes(":") || !/^[0-9a-f:]+$/.test(addr)) return null;
  const dbl = addr.split("::");
  if (dbl.length > 2) return null;

  const toHextets = (s: string): number[] | null => {
    if (!s) return [];
    const out: number[] = [];
    for (const part of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const left = toHextets(dbl[0]);
  if (!left) return null;
  if (dbl.length === 2) {
    const right = toHextets(dbl[1]);
    if (!right) return null;
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    return [...left, ...Array(fill).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

/**
 * issue #14 加固：除常见私网段外，解析 IPv6 字面量并展开 IPv4-mapped/兼容形式
 * （如 [::ffff:127.0.0.1]、[::ffff:7f00:1]、[::7f00:1]），避免借 mapped 地址绕过。
 * 注：WHATWG URL 解析器已把 0177.0.0.1 / 2130706433 等 IPv4 变体规范化为点分十进制。
 */
export function isBlockedIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();

  // 纯 IPv4 点分形式
  if (/^[0-9.]+$/.test(h)) return isBlockedIpv4(h);

  // IPv4-mapped / 兼容的点分形式（::ffff:127.0.0.1、::127.0.0.1；须为完整四段，避免误吞 ::1 等纯十六进制形式）
  const dotted = h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return isBlockedIpv4(dotted[1]);

  // IPv6 字面量
  const hextets = parseIpv6(h);
  if (!hextets) return false;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

  // ::1 回环 / :: 未指定
  if (
    h0 === 0 &&
    h1 === 0 &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0 &&
    h6 === 0 &&
    (h7 === 0 || h7 === 1)
  )
    return true;
  // fc00::/7 唯一本地
  if ((h0 & 0xfe00) === 0xfc00) return true;
  // fe80::/10 链路本地
  if ((h0 & 0xffc0) === 0xfe80) return true;

  // IPv4-mapped ::ffff:a.b.c.d / IPv4-translated ::ffff:0:a.b.c.d / IPv4-compatible ::a.b.c.d
  const mappedPrefix =
    h0 === 0 &&
    h1 === 0 &&
    h2 === 0 &&
    h3 === 0 &&
    (h4 === 0xffff ? h5 === 0 : h4 === 0 && (h5 === 0xffff || h5 === 0));
  if (mappedPrefix) {
    const v4 = `${h6 >> 8}.${h6 & 0xff}.${h7 >> 8}.${h7 & 0xff}`;
    return isBlockedIpv4(v4);
  }
  return false;
}

/**
 * #84 / H3：委托 client_ip 单点（含可信跳验签）。保留导出名供 text_proxy 复用；
 * 由调用方传入共享 secret，未配置时 fail-closed 不采信 X-Real-IP。
 */
export function clientIp(
  request: Request,
  secret?: string | null
): Promise<string> {
  return getClientIpString(request, secret);
}

export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type UrlValidation =
  { ok: true; url: URL } | { ok: false; status: number; message: string };

/**
 * issue #14：初始目标与每一跳重定向共用的唯一同步校验入口（协议 / 长度 / 字面量层）。
 * issue #19：解析后 IP 复核作为异步第二层（resolveAndCheckTarget），由
 * fetchWithValidatedRedirects 在实际拉取前执行；两层都在同一拉取流水线上，缺一不可。
 */
export function validateTargetUrl(raw: string): UrlValidation {
  if (!raw || raw.length > MAX_URL_LEN) {
    return { ok: false, status: 400, message: "url 参数缺失或过长" };
  }

  let tu: URL;
  try {
    tu = new URL(raw);
  } catch {
    return { ok: false, status: 400, message: "url 参数不是合法地址" };
  }

  if (tu.protocol !== "https:" && tu.protocol !== "http:") {
    return { ok: false, status: 400, message: "仅支持 http/https" };
  }

  const host = tu.hostname.toLowerCase();
  if (
    BLOCKED_HOST_RE.test(host) ||
    WORKERS_DEV_RE.test(host) ||
    isBlockedIp(host)
  ) {
    return { ok: false, status: 403, message: "目标地址被禁止代理" };
  }

  return { ok: true, url: tu };
}

export type ProxyFetchResult =
  | { kind: "ok"; response: Response; finalUrl: string }
  | { kind: "blocked" }
  | { kind: "resolution_failed" }
  | { kind: "too_many_redirects" }
  | { kind: "fetch_failed" };

/** 拉取失败的四种 kind（不含成功路径——ok 分支由调用方分流后各自继续） */
export type ProxyFetchFailure = Exclude<ProxyFetchResult, { kind: "ok" }>;

/**
 * issue #22：fetched.kind → 错误 Response 的单一共享映射（img/text 两通道原同形 if 级联的收敛点，#33 抓取通道复用）。
 * 行为契约（status / code / message 与收敛前两通道级联逐字一致，改失败规则只动这里）：
 *   blocked → 403；resolution_failed / too_many_redirects / fetch_failed → 502。
 * fetch_failed 的措辞按通道传入（图片「上游图片拉取失败」/ 文字「上游内容拉取失败」/ 抓取「上游页面拉取失败」）。
 * 输入不含 kind 'ok'；文字通道拿到返回的 Response 后统一 corsify() 补 CORS 头。
 */
export function mapFetchedFailure(
  fetched: ProxyFetchFailure,
  fetchFailedMessage: string
): Response {
  switch (fetched.kind) {
    case "blocked":
      return Response.json(
        { code: 403, message: "目标地址被禁止代理", data: null },
        { status: 403 }
      );
    case "resolution_failed":
      return Response.json(
        {
          code: 502,
          message: "目标域名解析失败或超时，已拒绝代理",
          data: null,
        },
        { status: 502 }
      );
    case "too_many_redirects":
      return Response.json(
        {
          code: 502,
          message: `重定向次数超过 ${MAX_REDIRECTS} 次`,
          data: null,
        },
        { status: 502 }
      );
    case "fetch_failed":
      return Response.json(
        { code: 502, message: fetchFailedMessage, data: null },
        { status: 502 }
      );
  }
}

// issue #19：解析后 IP 复核所用的 DoH（DNS over HTTPS）JSON 端点与单查询超时
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
/**
 * #109 / H10-R：第二解析器。两个独立解析器的答案集合必须一致，
 * 否则视为「DNS 不稳定 / 分裂解析」直接拒绝——这是 Workers 平台上能做到的最强
 * rebinding 检测（无法把 fetch 绑定到已校验 IP，见 ADR 0007）。
 */
const SECONDARY_DOH_ENDPOINT = "https://dns.google/resolve";
const DOH_TIMEOUT_MS = 3_000;

/**
 * #88 / H10：一次解析判定在同一请求内可复用的最长时间。
 * 同主机重定向不必重复 DoH；但判定比这更旧时必须在下一次 fetch 前重新查询，
 * 把「校验完成 → 实际建连」的窗口上界从整个请求生命周期压到 1 秒。
 * 注意：Workers fetch 无法绑定已校验 IP，这只能缩窗，不能消除 DNS rebinding。
 */
export const RESOLUTION_TTL_MS = 1_000;

/** #88 / H10：blocked 日志的可选上下文（img 通道传 channel/clientIp，其余通道留默认） */
export interface ProxyLogContext {
  channel?: string;
  clientIp?: string;
}

type BlockReason =
  | "literal"
  | "doh"
  | "rebinding"
  | "lookup_failed"
  | "empty"
  | "redirect_validation"
  | "malformed_location";

interface ResolutionDecision {
  status: "ok" | "blocked" | "failed";
  reason: BlockReason;
  blockedIps: string[];
  /** 判定完成时刻（Date.now()），用于判定是否超过 RESOLUTION_TTL_MS */
  checkedAt: number;
  /**
   * rebinding 判定的证据（#109 review：只写「因为 rebinding」等于没有可复现信息）。
   * 两轮答案集都记下来，才看得出是「分裂解析」还是「备用解析器不可用」。
   */
  evidence?: {
    primaryIps: string[];
    secondaryIps: string[];
    secondaryUnavailable: boolean;
  };
}

/** #88 / H10：blocked 判定统一出口——结构化 JSON 日志，供日志查询/告警规则匹配 [ssrf-blocked] */
async function logSsrfBlocked(
  host: string,
  hop: number,
  decision: Pick<ResolutionDecision, "reason" | "blockedIps" | "evidence">,
  context?: ProxyLogContext
): Promise<void> {
  const payload: Record<string, unknown> = {
    event: "ssrf_blocked",
    channel: context?.channel ?? "unknown",
    host,
    hop,
    reason: decision.reason,
    blocked_ips: decision.blockedIps,
    at: new Date().toISOString(),
  };
  if (decision.evidence) payload.evidence = decision.evidence;
  // 不记录原始 client IP / 完整目标 URL（可能含敏感 query），只记哈希与主机名
  if (context?.clientIp)
    payload.client_ip_hash = await sha1Hex(context.clientIp);
  console.warn("[ssrf-blocked] " + JSON.stringify(payload));
}

/** 主机是否为 IP 字面量（IPv4 点分 / IPv6 含冒号，URL 中带方括号） */
function isIpLiteralHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return /^[0-9.]+$/.test(h) || h.includes(":");
}

/**
 * 单次 DoH 查询的结论。三态必须分开（#109 review）：
 * - `ok`：Status=0，`ips` 为该记录类型下的地址集合（可能为空）
 * - `deny`：Status=3（NXDOMAIN）——解析器**明确答复**「这个名字不存在」
 * - `error`：传输层失败 / 非 2xx / 其它非 0 Status（SERVFAIL / REFUSED 等），结论不可用
 *
 * 把 `deny` 混进 `error` 会留一个降级口子：只要备用解析器对目标域名回 NXDOMAIN，
 * 「双解析器复核」就退化成「主解析器单查」，rebinding 检测形同虚设。
 */
type DohAnswer =
  { ok: true; ips: string[] } | { ok: false; kind: "deny" | "error" };

/** Status 3 = NXDOMAIN；其余非 0（1 FORMERR / 2 SERVFAIL / 5 REFUSED…）算「结论不可用」 */
const DNS_STATUS_NXDOMAIN = 3;

/** DoH 查询单个记录类型，返回三态结论 */
async function queryDoh(
  endpoint: string,
  host: string,
  type: "A" | "AAAA",
  signal: AbortSignal
): Promise<DohAnswer> {
  try {
    const res = await fetch(
      `${endpoint}?name=${encodeURIComponent(host)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        signal,
      }
    );
    if (!res.ok) return { ok: false, kind: "error" };
    const data = (await res.json()) as {
      Status?: number;
      Answer?: { type?: number; data?: string }[];
    };
    if (data.Status === DNS_STATUS_NXDOMAIN) return { ok: false, kind: "deny" };
    if (data.Status !== 0) return { ok: false, kind: "error" };
    const wantType = type === "A" ? 1 : 28;
    return {
      ok: true,
      ips: (data.Answer || [])
        .filter((r) => r.type === wantType && typeof r.data === "string")
        .map((r) => r.data as string),
    };
  } catch {
    return { ok: false, kind: "error" };
  }
}

interface DohRound {
  a: DohAnswer;
  aaaa: DohAnswer;
}

/** 单轮解析：同一解析器并发查 A + AAAA（任一失败即整轮失败，fail-closed） */
async function resolveRound(
  endpoint: string,
  host: string,
  signal?: AbortSignal | null
): Promise<DohRound> {
  const dnsSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DOH_TIMEOUT_MS)])
    : AbortSignal.timeout(DOH_TIMEOUT_MS);
  const [a, aaaa] = await Promise.all([
    queryDoh(endpoint, host, "A", dnsSignal),
    queryDoh(endpoint, host, "AAAA", dnsSignal),
  ]);
  return { a, aaaa };
}

/** 一轮查询的地址集合；任一半结论不可用时返回 null */
function roundIps(round: DohRound): string[] | null {
  if (!round.a.ok || !round.aaaa.ok) return null;
  return [...round.a.ips, ...round.aaaa.ips];
}

/**
 * 一轮查询的失败性质：`deny` 优先于 `error`。
 * 只要有一半明确答复「不存在」，这轮就不能再当「暂时查不到」处理。
 */
function roundFailure(round: DohRound): "deny" | "error" | null {
  const failures = [round.a, round.aaaa].filter((x) => !x.ok);
  if (failures.length === 0) return null;
  return failures.some((x) => !x.ok && x.kind === "deny") ? "deny" : "error";
}

/**
 * 地址集合比较（顺序无关，重复项视为同一集合）。
 *
 * #112 item 15：要求两解析器答案集**完全相等**——对 GeoDNS / 分地域解析的站点
 * 不友好（同一域名从 Cloudflare 与 Google 解析到不同 CDN 节点会被判 rebinding）。
 * 这是刻意选择「宁可少显示一张图，也不放行一次内网请求」；
 * 代价与后续放宽路径见 ADR 0007「误拒风险」段落
 *（docs/adr/0007-dns-rebinding-connection-binding.md）。
 */
function sameAddressSet(x: string[], y: string[]): boolean {
  const a = [...new Set(x)].sort();
  const b = [...new Set(y)].sort();
  return a.length === b.length && a.every((ip, i) => ip === b[i]);
}

/**
 * issue #19：解析后 IP 复核。对需要 DNS 解析的主机做 DoH A/AAAA 查询，
 * 任一结果落入受限段（复用 isBlockedIp 语义）即拒绝；IP 字面量无需解析。
 *
 * #88 / H10：返回带 reason / blockedIps / checkedAt 的判定对象，供 1 秒 TTL 复用与结构化告警。
 * 仍存在 TOCTOU 窗口（DNS 可变更/轮换）：本复核只保证「校验时」解析结果安全；
 * Workers 运行时无法把 fetch 绑定到已校验 IP，连接级绑定为 #19 明确的范围外事项（见 #88 残余风险）。
 */
async function resolveAndCheckTarget(
  host: string,
  signal?: AbortSignal | null
): Promise<ResolutionDecision> {
  const done = (
    status: ResolutionDecision["status"],
    reason: BlockReason,
    blockedIps: string[] = [],
    evidence?: ResolutionDecision["evidence"]
  ): ResolutionDecision => ({
    status,
    reason,
    blockedIps,
    checkedAt: Date.now(),
    ...(evidence ? { evidence } : {}),
  });

  if (isIpLiteralHost(host))
    return isBlockedIp(host)
      ? done("blocked", "literal")
      : done("ok", "literal");

  // #109：两个解析器**并发**查询。串行时最坏 3 轮 × 3s = 9s，撞上代理 10s 预算
  // （robots 预检另占 5s），正常图片直接 504；并发后最坏 2 轮 × 3s = 6s。
  const [primary, secondary] = await Promise.all([
    resolveRound(DOH_ENDPOINT, host, signal),
    resolveRound(SECONDARY_DOH_ENDPOINT, host, signal),
  ]);

  // 主解析器都拿不到结论：fail-closed，明确拒绝而非放行
  if (roundFailure(primary) !== null) return done("failed", "lookup_failed");
  const ips = roundIps(primary) ?? [];
  if (ips.length === 0) return done("failed", "empty");

  const blocked = ips.filter(isBlockedIp);
  if (blocked.length > 0) return done("blocked", "doh", blocked);

  // #109 / H10-R：第二解析器复核。答案集合不一致 → 视为 rebinding / 分裂解析并拒绝。
  const secondaryFailure = roundFailure(secondary);

  // 备用解析器**明确**答复「不存在」，而主解析器有记录：这是分裂解析的强证据，
  // 直接拒绝，不再走任何降级路径（否则攻击者让备用回 NXDOMAIN 即可绕过复核）。
  if (secondaryFailure === "deny") {
    return done("blocked", "rebinding", [], {
      primaryIps: ips,
      secondaryIps: [],
      secondaryUnavailable: false,
    });
  }

  // 备用解析器暂时不可用（传输失败 / SERVFAIL / REFUSED）：退回主解析器再查一次，
  // 两次不一致同样拒绝——不能因为备用挂了就放行。
  if (secondaryFailure === "error") {
    const retry = await resolveRound(DOH_ENDPOINT, host, signal);
    if (roundFailure(retry) !== null) return done("failed", "lookup_failed");
    const retryIps = roundIps(retry) ?? [];
    if (!sameAddressSet(ips, retryIps)) {
      return done("blocked", "rebinding", retryIps.filter(isBlockedIp), {
        primaryIps: ips,
        secondaryIps: retryIps,
        secondaryUnavailable: true,
      });
    }
    return done("ok", "doh");
  }

  const secondaryIps = roundIps(secondary) ?? [];
  if (!sameAddressSet(ips, secondaryIps)) {
    return done("blocked", "rebinding", secondaryIps.filter(isBlockedIp), {
      primaryIps: ips,
      secondaryIps,
      secondaryUnavailable: false,
    });
  }
  return done("ok", "doh");
}

/**
 * issue #14：redirect: 'manual' 手动逐跳跟随；每一跳都复用 validateTargetUrl。
 * issue #19：每一跳（含首跳）拉取前先做解析后 IP 复核——命中受限段返回 kind: 'blocked'，
 * 解析失败/超时返回 kind: 'resolution_failed'。
 * #88 / H10：判定只在 RESOLUTION_TTL_MS 内复用（同主机 http→https 不重复 DoH）；
 * 过期则在下一次 fetch 前重新查询，把校验到建连的窗口压到 TTL 内。所有 blocked 出口写结构化日志。
 * 重定向目标落入黑名单/校验不通过时立即停止（kind: 'blocked'），不发起后续请求；
 * 跳数超过 MAX_REDIRECTS 返回 kind: 'too_many_redirects'。
 */
export async function fetchWithValidatedRedirects(
  initial: URL,
  init: RequestInit,
  context?: ProxyLogContext
): Promise<ProxyFetchResult> {
  let current = initial;
  // 同一请求内按主机复用解析结果（同主机重定向如 http→https 不重复 DoH 查询）
  const resolutions = new Map<string, Promise<ResolutionDecision>>();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // issue #19：每次拉取前对主机做解析后 IP 复核（含首跳与每一跳重定向）
    const host = current.hostname;
    let resolution = resolutions.get(host);
    if (!resolution) {
      resolution = resolveAndCheckTarget(host, init.signal);
      resolutions.set(host, resolution);
    }
    let outcome = await resolution;
    // #88 / H10：判定过期（例如同主机重定向耗时 > TTL）时，fetch 前必须重新查询
    if (Date.now() - outcome.checkedAt > RESOLUTION_TTL_MS) {
      resolution = resolveAndCheckTarget(host, init.signal);
      resolutions.set(host, resolution);
      outcome = await resolution;
    }
    if (outcome.status === "blocked") {
      await logSsrfBlocked(host, hop, outcome, context);
      return { kind: "blocked" };
    }
    if (outcome.status === "failed") return { kind: "resolution_failed" };

    let res: Response;
    try {
      res = await fetch(current.toString(), { ...init, redirect: "manual" });
    } catch {
      return { kind: "fetch_failed" };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      if (!loc)
        return { kind: "ok", response: res, finalUrl: current.toString() };

      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        await logSsrfBlocked(
          current.hostname,
          hop + 1,
          { reason: "malformed_location", blockedIps: [] },
          context
        );
        return { kind: "blocked" };
      }

      const v = validateTargetUrl(next.toString());
      if (!v.ok) {
        await logSsrfBlocked(
          next.hostname,
          hop + 1,
          { reason: "redirect_validation", blockedIps: [] },
          context
        );
        return { kind: "blocked" };
      }

      current = v.url;
      continue;
    }

    return { kind: "ok", response: res, finalUrl: current.toString() };
  }

  return { kind: "too_many_redirects" };
}

export type BodyReadResult =
  | { kind: "ok"; body: Uint8Array }
  | { kind: "too_large" }
  | { kind: "read_failed" };

/**
 * issue #14：流式读取响应体，累计超过 maxBytes 立即 cancel 上游（避免整块入内存）；
 * 读取全程受调用方传入的 AbortSignal/总超时约束，中断时返回 kind: 'read_failed'。
 */
export async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<BodyReadResult> {
  const reader = response.body?.getReader();
  if (!reader) return { kind: "read_failed" };

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "read_failed" };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", body };
}

export async function handleImgProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") || "";

  const validation = validateTargetUrl(target);
  if (!validation.ok) {
    return Response.json(
      { code: validation.status, message: validation.message, data: null },
      { status: validation.status }
    );
  }
  const tu = validation.url;

  // 每 IP 限流（独立于全局 rate_limit）：issue #91 收敛到统一 RateLimiter，
  // 滑动窗口计数抑制边界突发，await 写缩小 KV 非原子窗口。
  const ip = await clientIp(request, env.VISITOR_IP_SIGNING_SECRET);
  const verdict = await consumeRateLimit(env.RATE_LIMIT, {
    scope: "imgproxy",
    identity: ip,
    config: { windowMs: RATE_WINDOW_MS, maxRequests: RATE_MAX },
    nowMs: Date.now(),
  });
  if (!verdict.allowed) {
    return Response.json(
      { code: 429, message: "代理请求过于频繁，请稍后再试", data: null },
      { status: 429 }
    );
  }

  // KV 缓存（TTL 到期自动删除 = 过期内容自动清理）
  const cacheKey = `imgproxy/${await sha1Hex(target)}`;
  const cached = await env.MEDIA.getWithMetadata(cacheKey, {
    type: "arrayBuffer",
  });
  if (cached.value) {
    const meta = (cached.metadata as { ct?: string } | null) || {};
    const cachedCt = meta.ct || "image/*";
    return new Response(cached.value, {
      status: 200,
      headers: {
        "Content-Type": cachedCt,
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
        "X-Img-Proxy": "cache-hit",
        // issue #93 / M7：SVG 走 attachment + 沙箱 CSP（attachment 口径同 media.ts）
        ...svgSafeHeaders(cachedCt),
      },
    });
  }

  // 拉取目标：manual 重定向逐跳校验；总超时覆盖重定向 + 响应头 + 响应体读取全程
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const fetched = await fetchWithValidatedRedirects(
      tu,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        signal: ctrl.signal,
      },
      { channel: "img", clientIp: ip }
    );

    // issue #22：四类失败 kind 收敛为共享映射（成功路径降落到下方检查）
    if (fetched.kind !== "ok") {
      return mapFetchedFailure(fetched, "上游图片拉取失败");
    }
    const upstream = fetched.response;

    if (!upstream.ok) {
      return Response.json(
        {
          code: upstream.status,
          message: `上游返回 ${upstream.status}`,
          data: null,
        },
        { status: 502 }
      );
    }

    const contentType = (upstream.headers.get("Content-Type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_MIME.includes(contentType)) {
      return Response.json(
        { code: 415, message: "目标不是受支持的图片类型", data: null },
        { status: 415 }
      );
    }

    const declaredLen = parseInt(
      upstream.headers.get("Content-Length") || "0",
      10
    );
    if (declaredLen > MAX_FILE_SIZE) {
      return Response.json(
        { code: 413, message: "图片超过 10MB 限制", data: null },
        { status: 413 }
      );
    }

    const read = await readBodyWithLimit(upstream, MAX_FILE_SIZE);
    if (read.kind === "too_large") {
      return Response.json(
        { code: 413, message: "图片超过 10MB 限制", data: null },
        { status: 413 }
      );
    }
    if (read.kind === "read_failed") {
      return Response.json(
        { code: 502, message: "上游图片拉取失败", data: null },
        { status: 502 }
      );
    }
    const body = read.body;

    // 写入 KV 缓存（TTL 自动过期删除）
    ctx.waitUntil(
      env.MEDIA.put(cacheKey, body, {
        expirationTtl: CACHE_TTL,
        metadata: { ct: contentType },
      })
    );

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
        "X-Img-Proxy": "cache-miss",
        ...svgSafeHeaders(contentType),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
