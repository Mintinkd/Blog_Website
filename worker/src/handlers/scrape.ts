import { Env } from "../index";
import type { AuthResult } from "../middleware/auth";
import { error } from "../utils/response";
import {
  FETCH_TIMEOUT_MS,
  RATE_WINDOW_MS,
  readBodyWithLimit,
  validateTargetUrl,
  fetchWithValidatedRedirects,
  mapFetchedFailure,
} from "./img_proxy";

/**
 * 网页抓取代理（GET /admin/scrape?url=...，admin-only）
 *
 * 设计边界（#33 / #32 / ADR 0003）：
 * - Worker 只做「安全取回」：SSRF 校验（复用 img/text-proxy 的同一套
 *   validateTargetUrl + 解析后 IP 复核 + 逐跳重定向校验）、robots.txt 检查、
 *   2MB / 10s / 仅 HTML / 每管理员每分钟 10 次限流。正文提取与 Markdown
 *   转换全部在管理端浏览器执行，Worker 不解析、不缓存、不写库。
 * - 成功响应返回原始 HTML 字节；仅透传上游 Content-Type（含 charset），
 *   其余上游头一律不转发；final URL 与 robots 结果放在自有响应头。
 * - 错误沿用现有 JSON 信封（code / message / data）。
 */

export const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2MB
export const SCRAPE_TIMEOUT_MS = FETCH_TIMEOUT_MS; // 目标抓取 10s（robots 预检另有 5s 上限）
export const SCRAPE_RATE_MAX = 10; // 每管理员每分钟
export const ROBOTS_MAX_SIZE = 500 * 1024; // 500KB
export const ROBOTS_TIMEOUT_MS = 5_000;

export const SCRAPER_TOKEN = "ZenFishBlogScraper";
export const SCRAPER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 " +
  `${SCRAPER_TOKEN}/1.0`;

const HTML_MIME = new Set(["text/html", "application/xhtml+xml"]);

type RobotsDecision =
  | { allowed: true; status: "allowed" | "unchecked" }
  | { allowed: false; status: "disallowed"; rule: string };

interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

/**
 * 按 robots.txt 的组语义解析：连续的 User-agent 行共享同一组规则；
 * 规则行之后的 User-agent 开始新组。注释与空行忽略。
 */
function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if ((field === "allow" || field === "disallow") && current) {
      current.rules.push({ type: field, path: value });
    }
  }

  return groups;
}

/** 特定 UA 组匹配爬虫 token；忽略版本号差异（ZenFishBlogScraper/1.0） */
function agentMatches(agent: string, token: string): boolean {
  const a = agent.toLowerCase().split("/")[0].trim();
  const t = token.toLowerCase();
  if (!a || a === "*") return false;
  return t === a || t.startsWith(a);
}

function specificGroups(groups: RobotsGroup[], token: string): RobotsGroup[] {
  return groups.filter((g) => g.agents.some((a) => agentMatches(a, token)));
}

function wildcardGroups(groups: RobotsGroup[]): RobotsGroup[] {
  return groups.filter((g) => g.agents.some((a) => a.trim() === "*"));
}

/** robots 通配符：* 匹配任意字符，$ 只在末尾表示路径结束，其余字面量 */
function compileRule(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      source += ".*";
    } else if (ch === "$" && i === pattern.length - 1) {
      source += "$";
    } else {
      source += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(source);
}

/**
 * 标准最长匹配：命中规则中最长的生效；等长时 Allow 优先；
 * 空 Disallow 表示不限制。匹配路径包含 query。
 */
function matchRobots(
  text: string,
  path: string,
  token = SCRAPER_TOKEN
): RobotsDecision {
  const groups = parseRobots(text);
  const selected = specificGroups(groups, token);
  const chosen = selected.length > 0 ? selected : wildcardGroups(groups);
  if (chosen.length === 0) return { allowed: true, status: "allowed" };

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      if (!compileRule(rule.path).test(path)) continue;
      const length = rule.path.length;
      if (
        !best ||
        length > best.length ||
        (length === best.length &&
          rule.type === "allow" &&
          best.rule.type === "disallow")
      ) {
        best = { rule, length };
      }
    }
  }

  if (best && best.rule.type === "disallow") {
    return {
      allowed: false,
      status: "disallowed",
      rule: `Disallow: ${best.rule.path}`,
    };
  }
  return { allowed: true, status: "allowed" };
}

/**
 * robots.txt 先于目标抓取；与目标共用 SSRF 护栏。
 * 404/410/非 2xx/网络异常/超时/超 500KB 一律放行并标记 unchecked
 * （管理员在 UI 上会看到警告）；只有明确的 Disallow 才拒绝。
 */
async function checkRobots(target: URL): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", target.origin);
  const validation = validateTargetUrl(robotsUrl.toString());
  if (!validation.ok) return { allowed: true, status: "unchecked" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ROBOTS_TIMEOUT_MS);
  try {
    const fetched = await fetchWithValidatedRedirects(validation.url, {
      headers: {
        "User-Agent": SCRAPER_UA,
        Accept: "text/plain, */*;q=0.8",
      },
      signal: ctrl.signal,
    });
    if (fetched.kind !== "ok") return { allowed: true, status: "unchecked" };

    const res = fetched.response;
    if (!res.ok) return { allowed: true, status: "unchecked" };

    const read = await readBodyWithLimit(res, ROBOTS_MAX_SIZE);
    if (read.kind !== "ok") return { allowed: true, status: "unchecked" };

    const text = new TextDecoder("utf-8").decode(read.body);
    return matchRobots(text, target.pathname + target.search);
  } catch {
    return { allowed: true, status: "unchecked" };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleScrape(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  auth?: AuthResult
): Promise<Response> {
  if (!auth || auth.role !== "admin") {
    return error(403, "权限不足，仅管理员可执行此操作", 403);
  }

  const targetRaw = new URL(request.url).searchParams.get("url") || "";
  const validation = validateTargetUrl(targetRaw);
  if (!validation.ok) {
    return error(validation.status, validation.message, validation.status);
  }
  const target = validation.url;

  // 每管理员独立限流（不是每 IP；admin token 已由路由层校验）。
  // KV 无原子自增，get/put 之间存在并发窗口、可能少量超发；管理端单用户场景接受，
  // 强一致需要 Durable Objects（#33 明确不新增绑定）。
  const rlKey = `scrape:${auth.username}:${Math.floor(Date.now() / RATE_WINDOW_MS)}`;
  const rlCount = parseInt((await env.RATE_LIMIT.get(rlKey)) || "0", 10);
  if (rlCount >= SCRAPE_RATE_MAX) {
    const retryIn = Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - (Date.now() % RATE_WINDOW_MS)) / 1000)
    );
    return error(
      429,
      `抓取请求过于频繁（每个管理员每分钟 ${SCRAPE_RATE_MAX} 次），请 ${retryIn} 秒后重试`,
      429
    );
  }
  ctx.waitUntil(
    env.RATE_LIMIT.put(rlKey, String(rlCount + 1), { expirationTtl: 60 })
  );

  const robots = await checkRobots(target);
  if (!robots.allowed) {
    return error(403, `robots.txt 禁止抓取该路径（${robots.rule}）`, 403);
  }

  // 目标抓取：manual 重定向逐跳复核；总超时覆盖响应头 + 响应体读取
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const fetched = await fetchWithValidatedRedirects(target, {
      headers: {
        "User-Agent": SCRAPER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });

    if (ctrl.signal.aborted) {
      return error(504, "抓取超时（10 秒）", 504);
    }
    if (fetched.kind !== "ok") {
      return mapFetchedFailure(fetched, "上游页面拉取失败");
    }

    const upstream = fetched.response;
    if (!upstream.ok) {
      return error(502, `上游返回 ${upstream.status}`, 502);
    }

    const contentType = (upstream.headers.get("Content-Type") || "").trim();
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (!HTML_MIME.has(mediaType)) {
      return error(415, "目标不是 HTML 页面", 415);
    }

    const declaredLen = parseInt(
      upstream.headers.get("Content-Length") || "0",
      10
    );
    if (declaredLen > MAX_HTML_SIZE) {
      return error(413, "HTML 超过 2MB 限制", 413);
    }

    const read = await readBodyWithLimit(upstream, MAX_HTML_SIZE);
    if (read.kind === "too_large") {
      return error(413, "HTML 超过 2MB 限制", 413);
    }
    if (read.kind === "read_failed") {
      return ctrl.signal.aborted
        ? error(504, "抓取超时（10 秒）", 504)
        : error(502, "上游页面读取失败", 502);
    }

    return new Response(read.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Final-URL": encodeURIComponent(fetched.finalUrl),
        "X-Robots-Status": robots.status,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
