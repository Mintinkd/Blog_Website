/**
 * 前端类型门禁入口（issue #26）：`npm run check` → @astrojs/check 的 astro-check，
 * 输出结构化错误清单；存在 error 时以非零码退出（CI 在 Build 前执行，失败即拦截部署）。
 *
 * 钉住的工具链组合（node_modules 实测，三包向下链式依赖）：
 *   @astrojs/check 0.9.10 → @astrojs/language-server 2.17.2（CJS）
 *   → 以 require() 拉取 @astrojs/astro2tsx 0.1.3（该包所有已发布版本均为 ESM-only）。
 * require(ESM) 自 Node 22.12 起内置可用；更早的 22.x（如本次实测 22.9.0）必须开
 * --experimental-require-module 旗标。本脚本按当前 Node 自动决定是否补旗标——
 * 旧版补旗标、新版直接跑；工具链组合变更时在此调整，不散落到各处命令行。
 *
 * 版本钉住的另一面：根 .npmrc 为 legacy-peer-deps=true，@napi-rs/wasm-runtime 的
 * peer（@emnapi/runtime）不会被传递安装，已显式锁入 root devDependencies
 * （与其 peer 规则匹配的 1.11.3，与传递树里的 @emnapi/core 同系；升级 check 工具链时同步复核）。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// npm（本仓库的包管理器）会把 @astrojs/check 提升（hoist）到根 node_modules；
// bin 子路径不在包的 exports 映射内（ERR_PACKAGE_PATH_NOT_EXPORTED），故按文件系统路径直达。
const bin = fileURLToPath(
  new URL("../node_modules/@astrojs/check/bin/astro-check.js", import.meta.url)
);
if (!existsSync(bin)) {
  console.error(
    "check 工具链缺失：node_modules/@astrojs/check/bin/astro-check.js 不在（先执行 npm install；钉版布局见头注）"
  );
  process.exitCode = 1;
} else {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .map((n) => parseInt(n, 10));
  const requireEsmBuiltIn = major > 22 || (major === 22 && minor >= 12);
  const args = requireEsmBuiltIn
    ? [bin]
    : ["--experimental-require-module", bin];

  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
