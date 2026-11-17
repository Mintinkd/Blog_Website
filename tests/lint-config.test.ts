// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * issue #102 / L2：ESLint 门禁的契约测试。
 *
 * 锁的是「门禁存在且覆盖三处源码」这件事——规则本身是否生效由 CI 的
 * `npm run lint` 直接验证，这里只防止配置/脚本/CI 被无声删改。
 */

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("ESLint 门禁契约（#102）", () => {
  const config = read("eslint.config.mjs");

  it("根包与 worker 都有 lint 脚本，worker 复用根配置（单一来源）", () => {
    const root = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(root.scripts.lint).toBe("eslint . --max-warnings=0");
    expect(root.devDependencies.eslint).toMatch(/^\^?9/);
    expect(
      root.devDependencies["@typescript-eslint/eslint-plugin"]
    ).toBeTruthy();
    expect(root.devDependencies["eslint-plugin-vue"]).toBeTruthy();

    const worker = JSON.parse(read("worker/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(worker.scripts.lint).toContain("../eslint.config.mjs");
    // 与根包同口径：warning 也算失败（否则 `--max-warnings` 默认不限，告警会烂在 CI 里）
    expect(worker.scripts.lint).toContain("--max-warnings=0");
  });

  it("关键规则为 error 级：未使用变量（TS 版）/ 重复声明 / 未定义标识符", () => {
    // 未使用变量交给 @typescript-eslint（核心实现不认类型引用，会对 import type 误报）
    expect(config).toMatch(/"no-unused-vars":\s*"off"/);
    expect(config).toMatch(
      /"@typescript-eslint\/no-unused-vars":\s*\[\s*"error"/
    );
    expect(config).toMatch(/"no-redeclare":\s*"error"/);
    expect(config).toMatch(/"no-undef":\s*"error"/);
  });

  it("忽略生成物与本地 agent 目录（不把生成/临时文件当源码审）", () => {
    for (const pattern of [
      "dist/**",
      "worker/dist/**",
      "src/generated/**",
      "worker/src/generated/**",
      ".workbuddy/**",
    ]) {
      expect(config).toContain(`"${pattern}"`);
    }
  });

  it("pre-commit 与 CI 都接了 lint", () => {
    const lintStaged = read(".lintstagedrc");
    expect(lintStaged).toMatch(/eslint --fix/);

    const workflow = read(".github/workflows/deploy.yml");
    expect(workflow).toMatch(/^\s*- name: 代码静态检查$/m);
    expect(workflow).toMatch(/^\s*run: npm run lint$/m);
    // 顺序：类型检查之后、测试之前
    expect(workflow.indexOf("name: 代码静态检查")).toBeGreaterThan(
      workflow.indexOf("name: 前端类型检查")
    );
    expect(workflow.indexOf("name: 代码静态检查")).toBeLessThan(
      workflow.indexOf("name: 测试前端")
    );
  });

  it(".astro 刻意不纳入（由 astro check 覆盖），理由写在配置注释里", () => {
    expect(config).toMatch(/刻意不覆盖 `\.astro`/);
  });
});
