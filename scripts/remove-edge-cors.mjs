/**
 * 自动删除 zone 级通配 CORS 头（Transform Rule）——纯脚本路径，保留 wizard 人工兜底。
 *
 * 背景：`zenfishlog.dpdns.org` zone 曾有一条 Response Header Transform Rule 给全站
 * 硬加 `Access-Control-Allow-Origin: *`，绕过 origin 的 CORS 白名单。API token 现
 * 已具备 Transform Rules Edit + Zone Read 权限，可用 Rulesets API 自动删除。
 *
 * 用法（需 CLOUDFLARE_API_TOKEN 环境变量）：
 *   CLOUDFLARE_API_TOKEN=... node scripts/remove-edge-cors.mjs
 *   CLOUDFLARE_API_TOKEN=... node scripts/remove-edge-cors.mjs --dry-run   # 只诊断
 *   ZONE=example.com SITE_URL=https://example.com/ node scripts/remove-edge-cors.mjs
 *
 * 保守原则：只删「明确 set/add `*`（大小写不敏感）到 Access-Control-Allow-Origin」
 * 的规则；具体域名、其他 header、remove 操作、动态表达式一律不动。找不到目标规则
 * 即打印「无需删除」并退出 0（幂等）。删除后 curl 复验响应头。
 *
 * 纯函数导出供 node 单测锁定；CLI 仅在主模块执行。
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const RESPONSE_PHASE = "http_response_headers_transform";
const ACAO = "access-control-allow-origin";

/** 从 zone rulesets 中选出响应头转换 phase 的 zone 级 ruleset（唯一）。 */
export function pickResponseHeaderRuleset(rulesets) {
  if (!Array.isArray(rulesets)) return null;
  return (
    rulesets.find((r) => r?.phase === RESPONSE_PHASE && r?.kind === "zone") ??
    null
  );
}

/**
 * 判断单条规则是否「明确给 ACAO set/add 字面量 `*`」。
 * 大小写不敏感；属性名 canonical 化；只认 value === "*"，不认 expression。
 */
function isAcaoWildcardRule(rule) {
  if (!rule || rule.action !== "rewrite") return false;
  const headers = rule.action_parameters?.headers;
  if (!headers || typeof headers !== "object") return false;
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === ACAO
  );
  if (!entry) return false;
  const value = entry[1];
  if (!value || typeof value !== "object") return false;
  return (
    (value.operation === "set" || value.operation === "add") &&
    value.value === "*" &&
    value.expression === undefined
  );
}

/** 筛出所有通配 CORS 规则（保持原顺序）。 */
export function findAcaoWildcardRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.filter(isAcaoWildcardRule);
}

/**
 * 把 GET 回来的 rule 规整为 PUT 可接受的形状：只保留文档示例里的可写字段，
 * 剥离 id / version / last_updated 等服务端元数据（PUT 是整体替换，原样回传
 * 只读字段可能被拒或产生非预期版本）。
 */
export function sanitizeRuleForPut(rule) {
  const allowed = [
    "ref",
    "description",
    "expression",
    "action",
    "action_parameters",
    "enabled",
  ];
  const out = {};
  for (const key of allowed) {
    if (rule?.[key] !== undefined) out[key] = rule[key];
  }
  return out;
}

/**
 * 从 rules 数组中剔除指定规则，按原顺序返回其余。
 * 优先按 id 匹配；无 id 时按 ref 匹配（规则可能尚未分配 id）。
 */
export function stripRules(rules, toRemove) {
  const ids = new Set(toRemove.map((r) => r.id).filter(Boolean));
  const refs = new Set(toRemove.map((r) => r.ref).filter(Boolean));
  return rules.filter(
    (r) => !ids.has(r?.id) && !(r?.id == null && refs.has(r?.ref))
  );
}

function isMainModule() {
  try {
    return (
      process.argv[1] &&
      path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
}

async function api(path, token, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    const msg = (body.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(
      `Cloudflare API ${path} 失败 (${res.status}): ${msg || res.statusText}`
    );
  }
  return body.result;
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error("缺少 CLOUDFLARE_API_TOKEN 环境变量");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const zoneName = process.env.ZONE ?? "zenfishlog.dpdns.org";
  const siteUrl = process.env.SITE_URL ?? "https://blog.zenfishlog.dpdns.org/";

  // 1) zone 名 → zone_id（token 需 Zone:Read）
  const zones = await api(`/zones?name=${encodeURIComponent(zoneName)}`, token);
  const zone = Array.isArray(zones) ? zones[0] : null;
  if (!zone?.id)
    throw new Error(`找不到 zone ${zoneName}（或 token 无 Zone:Read 权限）`);
  console.log(`zone ${zoneName} → ${zone.id}`);

  // 2) 列出 rulesets → 选响应头转换 phase。
  // zone 级每个 phase 恰有一个 ruleset，总数远小于 50，无需翻页。
  const rulesets = await api(`/zones/${zone.id}/rulesets?per_page=50`, token);
  const ruleset = pickResponseHeaderRuleset(rulesets);
  if (!ruleset) {
    console.log("无 http_response_headers_transform ruleset，无需删除。");
    return;
  }

  // 3) 始终 GET 单条拿完整 rules 作为 PUT 的权威来源。
  // 严禁用 list 摘要的 rules：PUT 是【整体替换】，摘要缺 enabled/ref/description/
  // action_parameters 等字段会重置其他 Transform Rule，漏列规则则被直接删除。
  const detail = await api(`/zones/${zone.id}/rulesets/${ruleset.id}`, token);
  const rules = detail?.rules;
  if (!Array.isArray(rules))
    throw new Error("ruleset 详情未返回 rules 数组，拒绝盲写 PUT");

  const targets = findAcaoWildcardRules(rules);
  if (targets.length === 0) {
    console.log("未发现通配 ACAO 规则，无需删除（幂等）。");
    return;
  }
  console.log(
    `发现 ${targets.length} 条通配 ACAO 规则：${targets.map((r) => r.id ?? r.ref ?? "?").join(", ")}`
  );

  if (dryRun) {
    console.log("--dry-run：仅诊断，不执行 PUT。");
    return;
  }

  // 4) 剔除目标规则，规整为 PUT 形状后先 dry_run 验证，再真正整体替换。
  // PUT 是整体替换：dry_run=true 能在不落库的情况下验证规则形状是否被接受，
  // 避免一次错误 PUT 把同 ruleset 的其他 Transform Rule 改坏。
  const nextRules = stripRules(rules, targets).map(sanitizeRuleForPut);
  const putPath = `/zones/${zone.id}/rulesets/${ruleset.id}`;
  await api(`${putPath}?dry_run=true`, token, {
    method: "PUT",
    body: JSON.stringify({ rules: nextRules }),
  });
  console.log("dry_run 校验通过，提交真实 PUT…");
  await api(putPath, token, {
    method: "PUT",
    body: JSON.stringify({ rules: nextRules }),
  });
  console.log(`已删除 ${targets.length} 条规则，剩余 ${nextRules.length} 条。`);

  // 5) 复验站点响应头（边缘生效有延迟，最多 4 次 × 2s）
  // 跟随重定向（默认 redirect:"follow"）：若站点跳转，应检查最终落地页的头。
  for (let i = 1; i <= 4; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(siteUrl);
    const header = res.headers.get("access-control-allow-origin");
    if (!header) {
      console.log(
        `✓ 复验通过：${siteUrl} 已无 Access-Control-Allow-Origin 头。`
      );
      return;
    }
    console.log(`复验 ${i}/4：仍存在 Access-Control-Allow-Origin: ${header}`);
  }
  // 规则已删但边缘缓存未刷新属常见情况，不判失败——用退出码 0 + 明确告警，
  // 避免 wizard 把「已成功删除但缓存未失效」误判为操作失败。
  console.warn("规则已删除，但复验仍见响应头（可能边缘缓存未失效）。");
  console.warn(
    "请稍后手动 curl 复核；若持续存在，检查是否有其他 zone 规则注入。"
  );
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
