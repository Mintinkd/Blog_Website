// @vitest-environment node
/**
 * issue #113 / M18：后台侧边栏 minRole 门控测试。
 *
 * AdminSidebar.vue 的 navItems 声明了每项的 minRole（"admin" | "editor"），
 * visibleNavItems 的过滤逻辑是：minRole === "admin" 且 role !== "admin" 时隐藏。
 *
 * 本测试从 SFC 源码提取 navItems 的 key + minRole 声明（不依赖 Vue 运行时），
 * 按 role 表驱动断言可见项集合符合预期。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidebarSource = readFileSync(
  join(__dirname, "..", "src", "admin", "AdminSidebar.vue"),
  "utf-8"
);

/** 从 SFC 源码提取 navItems 的 key + minRole 声明 */
function extractNavItems(
  source: string
): Array<{ key: string; minRole: string }> {
  const items: Array<{ key: string; minRole: string }> = [];
  // 匹配 navItems 数组中的每个对象：key: "xxx", ... minRole: "yyy",
  const re = /key:\s*"([^"]+)"[^}]*?minRole:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    items.push({ key: m[1], minRole: m[2] });
  }
  if (items.length === 0) {
    throw new Error("未能从 AdminSidebar.vue 提取 navItems——正则可能过时");
  }
  return items;
}

/** 复刻 AdminSidebar.vue 的 visibleNavItems 过滤逻辑 */
function visibleKeys(
  items: Array<{ key: string; minRole: string }>,
  role: string
): string[] {
  return items
    .filter((item) => !(item.minRole === "admin" && role !== "admin"))
    .map((item) => item.key);
}

const navItems = extractNavItems(sidebarSource);
const adminOnlyItems = navItems.filter((i) => i.minRole === "admin");
const editorItems = navItems.filter((i) => i.minRole === "editor");

describe("AdminSidebar minRole 门控（issue #113 / M18）", () => {
  it("提取到 navItems 非空，且每项都有 key + minRole", () => {
    expect(navItems.length).toBeGreaterThan(0);
    for (const item of navItems) {
      expect(item.key).toBeTruthy();
      expect(["admin", "editor"]).toContain(item.minRole);
    }
  });

  it("admin 角色可见全部菜单项", () => {
    const visible = visibleKeys(navItems, "admin");
    expect(visible).toEqual(navItems.map((i) => i.key));
  });

  it("editor 角色只看到 minRole=editor 的项，admin-only 项全部隐藏", () => {
    const visible = visibleKeys(navItems, "editor");
    // editor 可见的项
    for (const item of editorItems) {
      expect(visible).toContain(item.key);
    }
    // admin-only 项不可见
    for (const item of adminOnlyItems) {
      expect(visible).not.toContain(item.key);
    }
    // 数量恰好等于 editor 项数
    expect(visible.length).toBe(editorItems.length);
  });

  it("未知角色（如 viewer）与 editor 同口径——admin-only 项不可见", () => {
    const visible = visibleKeys(navItems, "viewer");
    for (const item of adminOnlyItems) {
      expect(visible).not.toContain(item.key);
    }
    expect(visible.length).toBe(editorItems.length);
  });

  it("空字符串角色同样不泄露 admin-only 项", () => {
    const visible = visibleKeys(navItems, "");
    for (const item of adminOnlyItems) {
      expect(visible).not.toContain(item.key);
    }
  });

  it("admin-only 项与 editor 项的集合不重叠（每项只属于一个 minRole 桶）", () => {
    const adminKeys = new Set(adminOnlyItems.map((i) => i.key));
    for (const item of editorItems) {
      expect(adminKeys.has(item.key)).toBe(false);
    }
  });

  // 表驱动：逐项断言 (role, item) → visible
  it("表驱动：每个 navItem 在 admin / editor / viewer 下的可见性", () => {
    const roles = ["admin", "editor", "viewer"];
    for (const item of navItems) {
      for (const role of roles) {
        const visible = !(item.minRole === "admin" && role !== "admin");
        if (role === "admin") {
          expect(visible).toBe(true); // admin 永远可见
        } else if (item.minRole === "admin") {
          expect(visible).toBe(false); // 非 admin 看不到 admin-only
        } else {
          expect(visible).toBe(true); // editor 项对所有人可见
        }
      }
    }
  });
});
