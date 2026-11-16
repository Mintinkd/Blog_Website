// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderHeadersFile } from "../scripts/security-headers.mjs";

/**
 * issue #96 / M16：指纹资产 immutable 长缓存。
 *
 * 接缝：renderHeadersFile() 生成的 public/_headers（Pages 静态头规则）。
 * 票面要求 /_assets/* 规则在 /* 通用安全头块之后，避免被通用块覆盖。
 */

describe("指纹资产 immutable 长缓存（issue #96）", () => {
  const content = renderHeadersFile();

  it("含 /_assets/* 规则块，Cache-Control 为 public + 1 年 + immutable", () => {
    expect(content).toMatch(/^\/_assets\/\*\s*$/m);
    // 规则块头后紧跟的一行即 Cache-Control
    expect(content).toMatch(
      /\/_assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/
    );
  });

  it("顺序：/_assets/* 规则在 /* 通用安全头块之后", () => {
    const wildcard = content.indexOf("\n/*\n");
    const assets = content.indexOf("\n/_assets/*\n");
    expect(wildcard).toBeGreaterThan(-1);
    expect(assets).toBeGreaterThan(-1);
    expect(assets).toBeGreaterThan(wildcard);
  });

  it("既有 5 安全头块与 HTML 护栏不变（无回归）", () => {
    expect(content).toContain("X-Content-Type-Options: nosniff");
    expect(content).toContain(
      "Cache-Control: public, max-age=0, must-revalidate, no-transform"
    );
    expect(content).toContain("/404*");
  });

  it("提交态 public/_headers 与生成物逐字节一致（drift 镜像）", () => {
    expect(readFileSync("public/_headers", "utf8")).toBe(content);
  });
});
