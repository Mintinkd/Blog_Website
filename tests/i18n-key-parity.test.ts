// @vitest-environment node

import { describe, expect, it } from "vitest";
import zh from "../src/i18n/zh.json";
import en from "../src/i18n/en.json";

/**
 * #68 / T7：中英 i18n 键集合与参数占位符必须逐字一致。
 *
 * 票面要求「校验 zh/en 键集合一致，删除旧模式 key」。此前只靠一次性脚本
 * 比对，没有留在仓库里的门禁；这里把它变成可复跑的行为断言，期望值是
 * 手写的空集合与旧 key 清单，不从被测文件反推。
 *
 * 旧三档 textarea 模式（编辑 / 分屏 / 预览）在 T4 改为
 * WYSIWYG / 源码 / 分屏 / 线上预览四档后已无引用，T7 从 zh/en 与
 * worker/src/handlers/settings.ts 的默认文案字典一并删除；此用例防止回归。
 */

type JsonObject = Record<string, unknown>;

function flattenKeys(value: JsonObject, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      keys.push(...flattenKeys(child as JsonObject, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function paramsByKey(value: JsonObject, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      result[full] = [...child.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .sort()
        .join(",");
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      Object.assign(result, paramsByKey(child as JsonObject, full));
    }
  }
  return result;
}

const zhKeys = flattenKeys(zh).sort();
const enKeys = flattenKeys(en).sort();

describe("中英 i18n 契约", () => {
  it("zh / en 的键集合完全一致", () => {
    expect(zhKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => !zhKeys.includes(key))).toEqual([]);
  });

  it("每条文案的花括号参数占位符一致", () => {
    const zhParams = paramsByKey(zh);
    const enParams = paramsByKey(en);
    expect(zhKeys.filter((key) => zhParams[key] !== enParams[key])).toEqual([]);
  });

  it("T4 之前的三档旧模式 key 已删除", () => {
    const removed = [
      "admin.edit_mode",
      "admin.split_mode",
      "admin.preview_mode",
    ];
    expect(zhKeys.filter((key) => removed.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => removed.includes(key))).toEqual([]);
  });

  it("#121 移除的首页热门标签 / 分类页全部标签入口文案已删除", () => {
    const removed = ["taxonomy.hot_tags", "page.all_tags"];
    expect(zhKeys.filter((key) => removed.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => removed.includes(key))).toEqual([]);
  });
});
