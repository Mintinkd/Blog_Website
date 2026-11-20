// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

/**
 * issue #111 item 6：GitHub Actions workflow YAML 语法门禁。
 *
 * #106 验收要求 workflow YAML 语法校验，但仓库无任何 YAML 解析门禁。
 * 若 deploy.yml 有语法错误（缩进 / 引号 / tab），GitHub Actions 会静默
 * 不执行或报不直观的错误。本测试在 CI 的 npm test 步骤中提前拦截。
 *
 * js-yaml 已作为 astro / eslint 的传递依赖安装，不引入新依赖。
 */

const WORKFLOW_PATH = new URL(
  "../.github/workflows/deploy.yml",
  import.meta.url
);

describe("deploy.yml YAML 语法门禁（#111 item 6）", () => {
  const raw = readFileSync(WORKFLOW_PATH, "utf8");

  it("YAML 语法合法：js-yaml 能解析且产出对象", () => {
    const parsed = yaml.load(raw);
    expect(parsed).toBeInstanceOf(Object);
    expect((parsed as Record<string, unknown>).name).toBe("部署博客");
  });

  it("不含 tab 缩进（YAML 禁止 tab，GitHub Actions 会静默失败）", () => {
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 只检查非空行、非注释行的前导空白
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      expect(line).not.toMatch(/^\t/);
      expect(line).not.toMatch(/^ *\t/);
    }
  });

  it("关键结构存在：on / jobs / steps", () => {
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.on).toBeDefined();
    expect(parsed.jobs).toBeDefined();
    const job = (parsed.jobs as Record<string, unknown>).deploy as Record<
      string,
      unknown
    >;
    expect(job).toBeDefined();
    expect(Array.isArray(job.steps)).toBe(true);
    expect((job.steps as unknown[]).length).toBeGreaterThan(0);
  });
});
