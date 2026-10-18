/**
 * 构建后 CSP 收紧脚本（审查报告 P1-5 / issue #10；单源改造 issue #28 / ADR 0002）
 *
 * 目标：产物中 script-src 不再包含 'unsafe-inline'，改为显式放行静态页面与
 * SSR 页面共用的内联脚本（主题初始化、Astro 运行时 shim）的 sha256。
 *
 * 机制（由 astro.config.mjs 的 astro:build:done 钩子调用，npm run build 后必执行）：
 *  1. 字节校验 dist/_headers 与安全头模块整文件渲染一致——生成物不得绕过 prebuild
 *     或手工编辑（不一致即报错，先于任何产物改写）；
 *  2. 扫描 dist 下全部 *.html，提取可执行内联 <script>（排除 ld+json 等数据块），
 *     计算 sha256-<base64> 集合并去重（多技能脚本自动纳入，无需人工登记）；
 *  3. 以安全头模块为源构造收紧后的 CSP（tightenCsp：基线 script-src 去
 *     'unsafe-inline' + 追加 hash 列表），替换 dist/_headers 与 SSR Worker 产物
 *     中的基线 CSP 整串；
 *  4. 断言：任何文本产物不再残留基线 CSP 整串；JS 产物内的字符串字面量不得存在
 *     放行 'unsafe-inline' 的 script-src（注释 / 文案不算策略；style-src 等其它
 *     指令的保留不受影响）；静态与 SSR 两份 CSP 逐字符一致且等于模块构造结果
 *     （构建失败即报错）。
 *
 * 单源（ADR 0002）：CSP 基线与其余 4 头只在 scripts/security-headers.mjs 手工
 * 维护；src/middleware.ts 直接 import 该模块（dev / SSR 基线），public/_headers
 * 为其生成物。style-src 因动态 settings 内联样式维持 'unsafe-inline'，评估见
 * docs/security/csp-evaluation.md。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CSP_BASELINE,
  renderHeadersFile,
  scriptSrcAllowsUnsafeInline,
  tightenCsp,
} from "./security-headers.mjs";

const SCRIPT_TAG_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const DATA_SCRIPT_RE = /type\s*=\s*["']?application\/(ld\+json|json)["']?/i;
const DOUBLE_QUOTED_LITERAL_RE = /"([^"\n]*)"/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function isJsArtifact(f) {
  return f.endsWith(".js") || f.endsWith(".mjs");
}

function isTextArtifact(f) {
  return isJsArtifact(f) || f.endsWith(".html") || f.endsWith("_headers");
}

export function patchCsp(distDir) {
  const dist = resolve(distDir);
  const files = walk(dist);

  // 1) dist/_headers 必须是安全头模块的当前渲染（生成物契约，绕过 prebuild 即报错）
  const headersPath = join(dist, "_headers");
  const headers = readFileSync(headersPath, "utf8");
  if (headers !== renderHeadersFile()) {
    throw new Error(
      "[csp] dist/_headers 与安全头模块渲染不一致：先跑 npm run gen:headers 修复漂移" +
        "（并检查构建是否绕过 prebuild），再重新构建"
    );
  }

  // 2) 收集静态页面的内联脚本 hash（去重）
  const hashes = new Set();
  let inlineCount = 0;
  for (const f of files.filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(f, "utf8");
    for (const m of html.matchAll(SCRIPT_TAG_RE)) {
      if (DATA_SCRIPT_RE.test(m[0])) continue;
      if (!m[1].trim()) continue;
      inlineCount += 1;
      hashes.add(
        `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`
      );
    }
  }
  if (hashes.size === 0) {
    throw new Error(
      "[csp] dist 中未发现任何内联脚本，拒绝收紧（预期至少包含主题初始化脚本）"
    );
  }

  // 3) 以安全头模块为源构造收紧后的 CSP，替换静态与 SSR 产物中的基线整串
  const tightened = tightenCsp([...hashes]);
  writeFileSync(headersPath, headers.replaceAll(CSP_BASELINE, tightened));

  let workerHits = 0;
  for (const f of files.filter(isJsArtifact)) {
    const code = readFileSync(f, "utf8");
    const hits = code.split(CSP_BASELINE).length - 1;
    if (hits > 0) {
      writeFileSync(f, code.replaceAll(CSP_BASELINE, tightened));
      workerHits += hits;
    }
  }
  if (workerHits < 1) {
    throw new Error("[csp] SSR Worker 产物中未找到基线 CSP 字面量，收紧失败");
  }

  // 4) 断言：不残留基线 CSP；静态/SSR 两份 CSP 逐字符一致且 = 模块构造结果
  const after = walk(dist);
  const offenders = after.filter((f) => {
    if (!isTextArtifact(f)) return false;
    const text = readFileSync(f, "utf8");
    if (text.includes(CSP_BASELINE)) return true;
    // JS 产物：策略只存在于字符串字面量内——逐字面量判定，注释 / 文案不计
    return (
      isJsArtifact(f) &&
      [...text.matchAll(DOUBLE_QUOTED_LITERAL_RE)].some((match) =>
        scriptSrcAllowsUnsafeInline(match[1])
      )
    );
  });
  if (offenders.length) {
    throw new Error(
      `[csp] 收紧后仍有产物残留基线 CSP 或未收紧的 script-src：\n${offenders.join("\n")}`
    );
  }

  const staticCsp = /Content-Security-Policy: (.+)/
    .exec(readFileSync(headersPath, "utf8"))?.[1]
    ?.trim();
  const [firstDirective] = tightened.split("; ");
  let workerCsp = null;
  for (const f of after.filter(isJsArtifact)) {
    const code = readFileSync(f, "utf8");
    const match = [...code.matchAll(DOUBLE_QUOTED_LITERAL_RE)].find(
      (candidate) => candidate[1].includes(firstDirective)
    );
    if (match) {
      workerCsp = match[1];
      break;
    }
  }
  if (!staticCsp || !workerCsp) {
    throw new Error("[csp] 收紧后 CSP 提取失败（静态或 SSR 产物缺失）");
  }
  if (staticCsp !== workerCsp) {
    throw new Error(
      "[csp] 两份产物 CSP 不一致：\nstatic: " +
        staticCsp +
        "\nssr:    " +
        workerCsp
    );
  }
  if (staticCsp !== tightened) {
    throw new Error("[csp] 收紧产物与安全头模块构造结果不一致：\n" + staticCsp);
  }

  console.log(
    `[csp] script-src 已收紧：内联脚本 ${inlineCount} 处 / 唯一 hash ${hashes.size} 个；` +
      `已替换 dist/_headers 与 SSR 产物(${workerHits})`
  );
  console.log("[csp] 收紧结果 = 安全头模块构造（tightenCsp）");
  console.log("[csp] 静态与 SSR 两份 CSP 逐字符一致：OK");
}
