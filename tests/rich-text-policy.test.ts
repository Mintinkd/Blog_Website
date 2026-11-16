// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_BODY_TAGS,
  ARTICLE_BODY_ATTRS,
  ARTICLE_BODY_URI_SCHEMES,
  ARTICLE_BODY_FORBID_CONTENT_TAGS,
} from "../src/utils/markdownPolicy";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 单一事实源 rich-text-policy.json —— 前端 markdownPolicy.ts 与 Worker 生成物都应与它一致。 */
const descriptor = JSON.parse(
  readFileSync(path.join(ROOT, "rich-text-policy.json"), "utf8")
);

/**
 * issue #92 / M6 + #99 / M19：跨端富文本策略单一来源守卫。
 *
 * 前端 markdownPolicy.ts 是 DOMPurify / 预览策略源，Worker 从 rich-text-policy.json
 * 生成白名单。两者 tags / attributes / schemes / forbidContentTags 必须逐项一致，
 * 否则同一份正文在前后端消毒结果漂移（报告 §M19）。
 */

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

describe("前端 markdownPolicy 与单一源一致（issue #99）", () => {
  it("标签集合一致", () => {
    expect(sameSet([...ARTICLE_BODY_TAGS], descriptor.tags)).toBe(true);
  });

  it("属性集合一致", () => {
    expect(sameSet([...ARTICLE_BODY_ATTRS], descriptor.attributes)).toBe(true);
  });

  it("URL scheme 集合一致", () => {
    expect(sameSet([...ARTICLE_BODY_URI_SCHEMES], descriptor.schemes)).toBe(
      true
    );
  });

  it("丢内容的标签集合一致", () => {
    expect(
      sameSet(
        [...ARTICLE_BODY_FORBID_CONTENT_TAGS],
        descriptor.forbidContentTags
      )
    ).toBe(true);
  });

  it("描述符无重复、无 script/svg 误入白名单", () => {
    for (const key of ["tags", "attributes", "schemes"]) {
      expect(new Set(descriptor[key]).size, `${key} 有重复`).toBe(
        descriptor[key].length
      );
    }
    expect(descriptor.tags).not.toContain("script");
    expect(descriptor.tags).not.toContain("svg");
    expect(descriptor.schemes).not.toContain("javascript");
  });
});

describe("Worker 生成物与单一源一致", () => {
  const generated = readFileSync(
    path.join(ROOT, "worker/src/generated/rich-text-policy.ts"),
    "utf8"
  );

  it("生成物含 JSON 中的全部标签 / 属性 / scheme（逐项字面量守卫）", () => {
    for (const tag of descriptor.tags) {
      expect(generated, `标签 ${tag} 应在生成物`).toContain(`"${tag}"`);
    }
    for (const attr of descriptor.attributes) {
      expect(generated, `属性 ${attr} 应在生成物`).toContain(`"${attr}"`);
    }
    for (const scheme of descriptor.schemes) {
      expect(generated, `scheme ${scheme} 应在生成物`).toContain(`"${scheme}"`);
    }
  });

  it("生成物标注禁止手工编辑 + 单一源路径", () => {
    expect(generated).toContain("禁止手工编辑");
    expect(generated).toContain("rich-text-policy.json");
  });
});
