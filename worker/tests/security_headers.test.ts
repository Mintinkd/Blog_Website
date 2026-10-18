import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import {
  SECURITY_HEADERS,
  renderHeadersFile,
  scriptSrcAllowsUnsafeInline,
  tightenCsp,
} from "../../scripts/security-headers.mjs";
import { patchCsp } from "../../scripts/patch-csp.mjs";

/**
 * workers-types 的全局 URL 与 node:url 的 URL 类型不兼容（tests 下全局被
 * workers-types 抢注）；本测试需要 node:fs 逐字节对读生成物，这里做一次显式桥接。
 */
function toNodeFsPath(u: URL): string {
  return fileURLToPath(u as unknown as NodeURL);
}

/**
 * issue #28（ADR 0002）：安全头模块单源 + 构建期 CSP 收紧管线的行为锁定。
 *
 * 接缝：
 *   - 安全头模块（scripts/security-headers.mjs）——5 头声明式常量的唯一手工维护点；
 *   - patchCsp（scripts/patch-csp.mjs）——构建期以模块为源构造收紧后 CSP 并替换产物。
 * 前端 middleware 直接 import 模块，无测试设施，由 astro check 类型门禁覆盖
 * （docs/agents/testing.md）。
 */

/** #9/#10 基线（独立手写字面量；「指令内容与基线完全一致」的锁定源） */
const EXPECTED_BASELINE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; connect-src 'self'; frame-src https://player.bilibili.com https://www.youtube.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** 固定 hash 输入下的收紧结果（独立手写字面量；hash 由测试内注释给出推导来源） */
const EXPECTED_TIGHTENED_CSP =
  "default-src 'self'; script-src 'self' 'sha256-FtbCoOfHAhkEEZZ8zqmtyaFizkNhGfjMmKl45p19avA=' 'sha256-IiZ9V931LXTU8ucguCP9fqTlLsCVGl1R2+c4hueY06Y='; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; connect-src 'self'; frame-src https://player.bilibili.com https://www.youtube.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

describe("安全头模块单源（issue #28）", () => {
  it("CSP 基线逐字节等于 #9/#10 基线（唯一手工维护点）", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toBe(
      EXPECTED_BASELINE_CSP
    );
  });

  it("tightenCsp：script-src 去 'unsafe-inline' 并追加 sha256（内部排序），其余指令逐字节不变", () => {
    // 乱序传入，钉住「内部排序」；hash 分别 = sha256("console.log(\"theme-init\")")
    // 与 sha256("console.log(\"astro-shim\")")
    const hashes = [
      "'sha256-IiZ9V931LXTU8ucguCP9fqTlLsCVGl1R2+c4hueY06Y='",
      "'sha256-FtbCoOfHAhkEEZZ8zqmtyaFizkNhGfjMmKl45p19avA='",
    ];
    const tightened = tightenCsp(hashes);
    expect(tightened).toBe(EXPECTED_TIGHTENED_CSP);
    expect(tightened).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("scriptSrcAllowsUnsafeInline：只认 script-src 上下文（其它指令的 'unsafe-inline' 是预期保留）", () => {
    expect(scriptSrcAllowsUnsafeInline(EXPECTED_BASELINE_CSP)).toBe(true);
    expect(scriptSrcAllowsUnsafeInline(EXPECTED_TIGHTENED_CSP)).toBe(false);
    expect(
      scriptSrcAllowsUnsafeInline("style-src 'self' 'unsafe-inline'")
    ).toBe(false);
  });
});

describe("public/_headers 生成物（issue #28）", () => {
  it("renderHeadersFile 与提交态 public/_headers 逐字节一致（CI 漂移断言的本地镜像）", () => {
    const committed = readFileSync(
      toNodeFsPath(new URL("../../public/_headers", import.meta.url)),
      "utf8"
    );
    expect(renderHeadersFile()).toBe(committed);
  });

  it("生成标记注释 + 5 头规则块全量渲染（整文件生成态）", () => {
    const content = renderHeadersFile();
    expect(content).toContain("生成物 —— 禁止手工编辑");
    // 5 头规则块逐行钉住（独立手写字面量）
    expect(content).toContain(
      `  Content-Security-Policy: ${EXPECTED_BASELINE_CSP}`
    );
    expect(content).toContain("  X-Content-Type-Options: nosniff");
    expect(content).toContain("  X-Frame-Options: DENY");
    expect(content).toContain(
      "  Referrer-Policy: strict-origin-when-cross-origin"
    );
    expect(content).toContain(
      "  Permissions-Policy: camera=(), microphone=(), geolocation=()"
    );
  });
});

/* ── B 组：构建期收紧管线（patchCsp）──
 * 接缝：patchCsp 对 dist 目录的整目录行为（fixture 逐文件构造）：
 *   - 收紧产物 = 安全头模块构造结果，静态/SSR 双份逐字符一致；
 *   - #10 守卫保留：无内联脚本拒绝收紧；
 *   - #28 新增守卫：dist/_headers 与模块渲染不一致即拒绝（防绕过 prebuild / 手工漂移）。
 */

/** fixture 内联脚本内容；对应 hash 钉在 EXPECTED_TIGHTENED_CSP（sha256-base64） */
const SCRIPT_THEME_INIT = 'console.log("theme-init")';
const SCRIPT_ASTRO_SHIM = 'console.log("astro-shim")';
const NO_CSP_JS = 'console.log("no csp here");';

/** SSR 产物夹具形态：与 Astro cloudflare 适配器产物一致的整串字面量 */
function workerBundle(): string {
  return `const SECURITY_HEADERS = ${JSON.stringify(SECURITY_HEADERS)};\n`;
}

/** 逐文件写出临时 dist 夹具；返回根目录（afterEach 统一清理） */
const fixtureDirs: string[] = [];
afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "patch-csp-"));
  fixtureDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

describe("patchCsp 收紧管线（issue #10 / #28）", () => {
  it("以安全头模块为源构造收紧：静态/SSR 逐字符一致，其余产物与其余 4 头不动", () => {
    const html =
      `<!doctype html><html><head><script>${SCRIPT_THEME_INIT}</script>` +
      `<script>${SCRIPT_ASTRO_SHIM}</script>` +
      `<script type="application/ld+json">{"@context":"https://schema.org"}</script>` +
      `</head><body></body></html>`;
    const dir = writeFixture({
      "index.html": html,
      _headers: renderHeadersFile(),
      "_worker.js/entry.mjs": workerBundle(),
      "_worker.js/other.js": NO_CSP_JS,
    });

    patchCsp(dir);

    const headers = readFileSync(join(dir, "_headers"), "utf8");
    const staticCsp = /Content-Security-Policy: (.+)/
      .exec(headers)?.[1]
      ?.trim();
    expect(staticCsp).toBe(EXPECTED_TIGHTENED_CSP);
    // 其余 4 头保持基线内容（基线由渲染侧唯一维护）
    expect(headers).toContain("X-Frame-Options: DENY");

    const worker = readFileSync(join(dir, "_worker.js/entry.mjs"), "utf8");
    expect(worker).toContain(staticCsp as string); // 静态/SSR 逐字符一致
    expect(worker).not.toContain(EXPECTED_BASELINE_CSP);

    // 无 CSP 的产物与 HTML 不被改写
    expect(readFileSync(join(dir, "_worker.js/other.js"), "utf8")).toBe(
      NO_CSP_JS
    );
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(html);
  });

  it("dist/_headers 与模块渲染不一致 → 拒绝收紧（防绕过 prebuild / 手工漂移）", () => {
    const dir = writeFixture({
      _headers: renderHeadersFile().replace(
        "X-Frame-Options: DENY",
        "X-Frame-Options: SAMEORIGIN"
      ),
      "index.html": `<!doctype html><html><body><script>${SCRIPT_THEME_INIT}</script></body></html>`,
      "_worker.js/entry.mjs": workerBundle(),
    });

    expect(() => patchCsp(dir)).toThrow(/gen:headers/);
  });

  it("残留变体脚本策略（script-src 仍放行 unsafe-inline，非基线整串）→ 拒绝收紧", () => {
    const dir = writeFixture({
      _headers: renderHeadersFile(),
      "index.html": `<!doctype html><html><body><script>${SCRIPT_THEME_INIT}</script></body></html>`,
      "_worker.js/entry.mjs": workerBundle(),
      // 变体：整串不等于基线，精确替换拦不住——由 script-src 上下文断言兜底
      "_worker.js/legacy.mjs":
        "const OLD = \"default-src 'none'; script-src 'self' 'unsafe-inline'\";\n",
    });

    expect(() => patchCsp(dir)).toThrow(/残留/);
  });

  it("无内联脚本 → 拒绝收紧（#10 守卫保留）", () => {
    const dir = writeFixture({
      _headers: renderHeadersFile(),
      "index.html": "<!doctype html><html><body>no scripts</body></html>",
    });

    expect(() => patchCsp(dir)).toThrow(/内联脚本/);
  });
});
