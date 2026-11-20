// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL } from "../scripts/wait-for-deploy.mjs";

/**
 * issue #111 item 7：DEPLOY_BASE_URL 三份漂移守卫。
 *
 * 三份 DEPLOY_BASE_URL 存在于：
 * 1. scripts/wait-for-deploy.mjs → DEFAULT_BASE_URL（脚本默认，本地 / 未配置时用）
 * 2. .github/workflows/deploy.yml → env.DEPLOY_BASE_URL 的 fallback（CI 默认）
 * 3. tests/wait-for-deploy.test.ts → 断言 DEFAULT_BASE_URL 的值
 *
 * 旧状态：三份无守卫，改一份不会让另两份红。
 * 本测试锁定三份的关系：脚本默认与测试断言必须一致；
 * CI 默认与脚本默认刻意不同（CI 打 Pages 别名避免 WAF 拦截，
 * 脚本默认打自定义域供本地用），差异理由写在这里，改任一侧都会红。
 */

const ROOT = new URL("../", import.meta.url);

function readDeployYmlDefault(): string {
  const yml = readFileSync(
    new URL(".github/workflows/deploy.yml", ROOT),
    "utf8"
  );
  // 提取 DEPLOY_BASE_URL 的 fallback 值
  // 格式：DEPLOY_BASE_URL: ${{ vars.DEPLOY_BASE_URL || 'https://...' }}
  const match = yml.match(
    /DEPLOY_BASE_URL:\s*\$\{\{\s*vars\.DEPLOY_BASE_URL\s*\|\|\s*'([^']+)'\s*\}\}/
  );
  if (!match) {
    throw new Error(
      "无法从 deploy.yml 提取 DEPLOY_BASE_URL fallback——格式可能已变"
    );
  }
  return match[1];
}

describe("DEPLOY_BASE_URL 漂移守卫（#111 item 7）", () => {
  const scriptDefault = DEFAULT_BASE_URL;
  const ciDefault = readDeployYmlDefault();

  it("脚本默认值与测试断言一致（tests/wait-for-deploy.test.ts 锁定的值）", () => {
    // tests/wait-for-deploy.test.ts:90 断言 parseDeployConfig({}).baseUrl === 此值
    // 改脚本的 DEFAULT_BASE_URL 但不改测试 → 这里红
    expect(scriptDefault).toBe("https://blog.zenfishlog.dpdns.org");
  });

  it("CI 默认值（deploy.yml fallback）是 Pages 别名，与脚本默认刻意不同", () => {
    // CI 打 Pages 别名（blog-website-page.pages.dev）而非自定义域：
    // 自定义域的边缘 WAF/Bot 规则会拦 GitHub Actions 出口 IP（实测 2026-11-17
    // run 43987529351 恒 403），别名无此问题。
    // 脚本默认打自定义域供本地使用（本地出网 IP 不被 WAF 拦）。
    expect(ciDefault).toBe("https://blog-website-page.pages.dev");
    expect(ciDefault).not.toBe(scriptDefault);
  });

  it("两个默认值都是 https URL（fail-closed，防止误配 http 或非 URL）", () => {
    for (const url of [scriptDefault, ciDefault]) {
      expect(url).toMatch(/^https:\/\//);
      expect(() => new URL(url)).not.toThrow();
    }
  });
});
