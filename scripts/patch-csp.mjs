/**
 * 构建后 CSP 收紧脚本（审查报告 P1-5 / issue #10）
 *
 * 目标：产物中 script-src 不再包含 'unsafe-inline'，改为显式放行静态页面与
 * SSR 页面共用的内联脚本（主题初始化、Astro 运行时 shim）的 sha256。
 *
 * 机制（由 astro.config.mjs 的 astro:build:done 钩子调用，npm run build 后必执行）：
 *  1. 扫描 dist 下全部 *.html，提取可执行内联 <script>（排除 ld+json 等数据块），
 *     计算 sha256-<base64> 集合并去重（多技能脚本自动纳入，无需人工登记）；
 *  2. 将 dist/_headers 与 dist/_worker.js 产物中的
 *     "script-src 'self' 'unsafe-inline'" 替换为 "script-src 'self' <hashes>"；
 *  3. 断言：收紧后任何产物不再残留该 token；两份 CSP 逐字符一致（构建失败即报错）。
 *
 * 说明：src/middleware.ts 与 public/_headers 源码保留基线形态（含 'unsafe-inline'），
 * 供 astro dev 等开发场景使用；生产产物以本脚本输出为准。style-src 因动态 settings
 * 内联样式维持 'unsafe-inline'，评估见 docs/security/csp-evaluation.md。
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRIPT_TAG_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const DATA_SCRIPT_RE = /type\s*=\s*["']?application\/(ld\+json|json)["']?/i;
const UNSAFE_SRC = "script-src 'self' 'unsafe-inline'";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function patchCsp(distDir) {
  const dist = resolve(distDir);
  const files = walk(dist);

  // 1) 收集静态页面的内联脚本 hash（去重）
  const hashes = new Set();
  let inlineCount = 0;
  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(SCRIPT_TAG_RE)) {
      if (DATA_SCRIPT_RE.test(m[0])) continue;
      if (!m[1].trim()) continue;
      inlineCount += 1;
      hashes.add(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    }
  }
  if (hashes.size === 0) {
    throw new Error('[csp] dist 中未发现任何内联脚本，拒绝收紧（预期至少包含主题初始化脚本）');
  }
  const replacement = `script-src 'self' ${[...hashes].sort().join(' ')}`;

  // 2) 替换 dist/_headers（静态资产与预渲染页面）
  const headersPath = join(dist, '_headers');
  const headers = readFileSync(headersPath, 'utf8');
  const headersHits = headers.split(UNSAFE_SRC).length - 1;
  if (headersHits !== 1) {
    throw new Error(`[csp] dist/_headers 中匹配 "${UNSAFE_SRC}" ${headersHits} 次（预期 1 次）`);
  }
  writeFileSync(headersPath, headers.replaceAll(UNSAFE_SRC, replacement));

  // 3) 替换 SSR Worker 产物（动态路由走 src/middleware.ts 编译结果）
  let workerHits = 0;
  for (const f of files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    const code = readFileSync(f, 'utf8');
    const n = code.split(UNSAFE_SRC).length - 1;
    if (n > 0) {
      writeFileSync(f, code.replaceAll(UNSAFE_SRC, replacement));
      workerHits += n;
    }
  }
  if (workerHits < 1) {
    throw new Error('[csp] SSR Worker 产物中未找到 CSP 字面量，收紧失败');
  }

  // 4) 断言：不残留基线 token；两份 CSP 逐字符一致
  const after = walk(dist);
  const offenders = after.filter(
    (f) =>
      (f.endsWith('.html') || f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('_headers')) &&
      readFileSync(f, 'utf8').includes(UNSAFE_SRC)
  );
  if (offenders.length) {
    throw new Error(`[csp] 收紧后仍有产物残留 "unsafe-inline"：\n${offenders.join('\n')}`);
  }

  const staticCsp = /Content-Security-Policy: (.+)/.exec(readFileSync(headersPath, 'utf8'))?.[1]?.trim();
  let workerCsp = null;
  for (const f of after.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
    const m = /"([^"\n]*default-src 'self'[^"\n]*)"/.exec(readFileSync(f, 'utf8'));
    if (m) {
      workerCsp = m[1];
      break;
    }
  }
  if (!staticCsp || !workerCsp) {
    throw new Error('[csp] 收紧后 CSP 提取失败（静态或 SSR 产物缺失）');
  }
  if (staticCsp !== workerCsp) {
    throw new Error('[csp] 两份产物 CSP 不一致：\nstatic: ' + staticCsp + '\nssr:    ' + workerCsp);
  }

  console.log(
    `[csp] script-src 已收紧：内联脚本 ${inlineCount} 处 / 唯一 hash ${hashes.size} 个；` +
      `已替换 dist/_headers(1) 与 SSR 产物(${workerHits})`
  );
  console.log(`[csp] 最终 script-src: 'self' ${[...hashes].sort().join(' ')}`);
  console.log('[csp] 静态与 SSR 两份 CSP 逐字符一致：OK');
}
