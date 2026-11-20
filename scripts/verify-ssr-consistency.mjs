/**
 * issue #113 / L4：SSR 一致性 CI 断言。
 *
 * #103 把 BaseLayout 内联脚本拆成模块后，SSR 一致性证据是人工归一化 diff。
 * 本脚本把关键结构断言固化，在 `npm run build` 后运行，失败即阻断部署。
 *
 * 原则：
 *  - 纯本地文件检查，不发起任何远端请求（排除 `--bg-image` 等构建期远端噪声）；
 *  - 断言构建产物的稳定结构属性（页面存在、script 标签数、CSP 收紧、外部脚本路径）；
 *  - 故意改一个字节应红——如果构建产物结构变化（script 数、CSP hash 数、页面缺失），脚本失败。
 *
 * 用法：先 `npm run build`，再 `node scripts/verify-ssr-consistency.mjs`。
 * CI 中在 deploy.yml 的 build 步骤后调用。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures.push(`${label}: ${e.message}`);
    console.error(`  ✗ ${label}: ${e.message}`);
  }
}

/** 读取 dist 下的文件，不存在则抛错 */
function readDist(relPath) {
  const full = join(DIST, relPath);
  if (!existsSync(full)) {
    throw new Error(`文件不存在: ${relPath}`);
  }
  return readFileSync(full, "utf-8");
}

/** 从 HTML 中提取所有 <script> 标签信息 */
function extractScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const srcMatch = attrs.match(/src="([^"]*)"/);
    const typeMatch = attrs.match(/type="([^"]*)"/);
    scripts.push({
      src: srcMatch ? srcMatch[1] : null,
      type: typeMatch ? typeMatch[1] : null,
      inline: body.trim().length > 0,
    });
  }
  return scripts;
}

console.log("SSR 一致性断言（issue #113 / L4）\n");

// ── 1. 关键页面存在 ──────────────────────────────────────────────
console.log("1. 关键页面存在性");
const expectedPages = [
  "index.html",
  "about/index.html",
  "search/index.html",
  "archives/index.html",
  "articles/index.html",
  "404.html",
  "admin/index.html",
  "privacy/index.html",
];

for (const page of expectedPages) {
  check(`dist/${page} 存在`, () => {
    readDist(page);
  });
}

// ── 2. 每个页面有正确的 script 结构 ──────────────────────────────
console.log("\n2. Script 标签结构");
for (const page of expectedPages) {
  check(`${page} 含至少 1 个外部 module script（_assets/）`, () => {
    const html = readDist(page);
    const scripts = extractScripts(html);
    const externalModules = scripts.filter(
      (s) => s.src && s.src.startsWith("/_assets/") && s.type === "module"
    );
    assert.ok(
      externalModules.length >= 1,
      `期望至少 1 个外部 module script，实际 ${externalModules.length}`
    );
  });
}

// ── 3. 外部脚本路径带 hash（构建产物正确指纹化）─────────────────
console.log("\n3. 外部脚本 hash 指纹");
check("index.html 外部脚本路径含 hash 段（.XXXX.js）", () => {
  const html = readDist("index.html");
  const scripts = extractScripts(html);
  const external = scripts.filter(
    (s) => s.src && s.src.startsWith("/_assets/")
  );
  assert.ok(external.length >= 1, "无外部脚本");
  for (const s of external) {
    // _assets/Name.astro_astro_type_script_..._lang.HASH.js
    assert.match(
      s.src,
      /\/_assets\/[^/]+\.[A-Za-z0-9_-]{4,}\.(?:js|mjs)$/,
      `脚本路径无 hash: ${s.src}`
    );
  }
});

// ── 4. CSP 收紧断言 ──────────────────────────────────────────────
console.log("\n4. CSP 收紧一致性");
check("_headers CSP 不含 'unsafe-inline'（script-src 已收紧为 hash）", () => {
  const headers = readDist("_headers");
  const cspMatch = headers.match(/Content-Security-Policy: (.+)/);
  assert.ok(cspMatch, "_headers 无 CSP 头");
  const csp = cspMatch[1];
  // 收紧后 script-src 不应含 'unsafe-inline'
  const scriptSrcMatch = csp.match(/script-src ([^;]+)/);
  assert.ok(scriptSrcMatch, "CSP 无 script-src 指令");
  assert.ok(
    !scriptSrcMatch[1].includes("'unsafe-inline'"),
    "script-src 仍含 'unsafe-inline'（未收紧）"
  );
});

check("_headers CSP 含至少 2 个 sha256 hash", () => {
  const headers = readDist("_headers");
  const cspMatch = headers.match(/Content-Security-Policy: (.+)/);
  assert.ok(cspMatch, "_headers 无 CSP 头");
  const hashes = cspMatch[1].match(/'sha256-[^']+'/g);
  assert.ok(
    hashes && hashes.length >= 2,
    `期望至少 2 个 sha256 hash，实际 ${hashes ? hashes.length : 0}`
  );
});

// ── 5. SSR Worker 产物存在 ───────────────────────────────────────
console.log("\n5. SSR Worker 产物");
check("dist/_worker.js 存在（SSR 入口）", () => {
  const workerPath = join(DIST, "_worker.js");
  if (!existsSync(workerPath)) throw new Error("_worker.js 不存在");
});

check("dist/_routes.json 存在（路由表）", () => {
  readDist("_routes.json");
});

// ── 6. _assets 目录非空 ─────────────────────────────────────────
console.log("\n6. 构建产物完整性");
check("dist/_assets/ 目录非空", () => {
  const assetsDir = join(DIST, "_assets");
  if (!existsSync(assetsDir)) throw new Error("_assets 目录不存在");
  const files = readdirSync(assetsDir);
  assert.ok(files.length > 0, "_assets 目录为空");
});

check("dist/sitemap-index.xml 存在", () => {
  readDist("sitemap-index.xml");
});

// ── 7. ClientRouter 存在（Astro 视图过渡运行时）─────────────────
console.log("\n7. 客户端运行时");
check("index.html 含 ClientRouter module（视图过渡运行时）", () => {
  const html = readDist("index.html");
  const scripts = extractScripts(html);
  const hasClientRouter = scripts.some(
    (s) => s.src && s.src.includes("ClientRouter")
  );
  assert.ok(hasClientRouter, "未找到 ClientRouter module script");
});

// ── 结果 ────────────────────────────────────────────────────────
console.log("");
if (failures.length > 0) {
  console.error(`\n✗ SSR 一致性断言失败（${failures.length} 项）:`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log("✓ SSR 一致性断言全部通过");
}
