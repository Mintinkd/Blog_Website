// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_PBKDF2_ITERATIONS } from "../scripts/seed-credential.mjs";

/**
 * issue #112 item 14：PBKDF2 迭代数漂移守卫 + 熵文档。
 *
 * `SEED_PBKDF2_ITERATIONS`（seed-credential.mjs）与 `PBKDF2_ITERATIONS`
 *（password.ts）两侧各写 100_000，无守卫——改一侧另一侧不红。
 * 本测试锁定两侧一致：改任一侧的迭代数，此测试立刻红。
 *
 * 另：`randomUUID().slice(0,16)` 生成约 60 bit 熵的初始口令，
 * 在 seed-credential.mjs 注释与 README 中写明取舍与适用边界。
 */

const ROOT = resolve(import.meta.dirname, "..");

describe("PBKDF2 迭代数漂移守卫（#112 item 14）", () => {
  it("seed-credential.mjs 的 SEED_PBKDF2_ITERATIONS 与 password.ts 的 PBKDF2_ITERATIONS 一致", () => {
    // 从 password.ts 源码提取 PBKDF2_ITERATIONS 的值
    const passwordSrc = readFileSync(
      resolve(ROOT, "src/utils/password.ts"),
      "utf8"
    );
    const match = passwordSrc.match(
      /(?:const|export\s+const)\s+PBKDF2_ITERATIONS\s*=\s*(\d[\d_]*)/
    );
    expect(match, "password.ts 应定义 PBKDF2_ITERATIONS").not.toBeNull();
    const workerIterations = parseInt(match![1].replace(/_/g, ""), 10);

    expect(SEED_PBKDF2_ITERATIONS).toBe(workerIterations);
    // 锁定具体值（改任一侧但不改此断言 → 红）
    expect(SEED_PBKDF2_ITERATIONS).toBe(100_000);
    expect(workerIterations).toBe(100_000);
  });

  it("seed-credential.mjs 注释包含 60 bit 熵说明", () => {
    const seedSrc = readFileSync(
      resolve(ROOT, "scripts/seed-credential.mjs"),
      "utf8"
    );
    // 注释应说明 randomUUID().slice(0,16) 的熵与适用边界
    expect(seedSrc).toContain("60 bit");
    expect(seedSrc).toContain("randomUUID().slice(0,16)");
  });
});
