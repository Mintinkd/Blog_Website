import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * issue #101 / M21：死代码清理守卫。
 *
 * models/*.ts 中「文档式」interface（仅定义、零引用）与 response.ts 中
 * 无外部调用的 success/paginated 导出，删除后由本测试防止复活。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

function allSource(): string {
  let out = "";
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts"))
        out += readFileSync(full, "utf8") + "\n";
    }
  };
  walk(SRC);
  return out;
}

describe("死代码删除（issue #101）", () => {
  it("三个全死 models 文件已删除", () => {
    for (const name of ["friend_link.ts", "media_asset.ts", "site_config.ts"]) {
      expect(existsSync(path.join(SRC, "models", name)), `${name} 仍存在`).toBe(
        false
      );
    }
  });

  it("零引用 interface（CommentListItem / CreateTagRequest）不再出现在源码", () => {
    const src = allSource();
    for (const name of ["CommentListItem", "CreateTagRequest"]) {
      expect(src, `${name} 仍存在`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("response.ts 的 success / paginated 导出已去除（内部函数仍供 Response 包装复用）", () => {
    const responseSrc = readFileSync(
      path.join(SRC, "utils", "response.ts"),
      "utf8"
    );
    expect(responseSrc).not.toMatch(/export function success\b/);
    expect(responseSrc).not.toMatch(/export function paginated\b/);
    // 保留内部函数（successResponse / paginatedResponse 依赖）
    expect(responseSrc).toMatch(/function success\b/);
    expect(responseSrc).toMatch(/function paginated\b/);
    // 有真实调用的导出不动
    expect(responseSrc).toMatch(/export function serverError\b/);
  });
});
