import { describe, expect, it } from "vitest";
import { safeFriendLinkUrl } from "../src/utils/friend-link-url";

/**
 * issue #43（T1 / 审查报告 C1）防线三：友链 URL 渲染兜底。
 * 存量脏数据（修复前入库的 javascript:/data: 等）由本函数在绑定 href 前拦截，
 * 协议非 http/https 一律不产出可点击 URL。期望值均为手写字面量。
 */

describe("safeFriendLinkUrl 渲染兜底（C1 防线三）", () => {
  it("http/https 绝对 URL 原样放行", () => {
    expect(safeFriendLinkUrl("https://example.com")).toBe(
      "https://example.com"
    );
    expect(safeFriendLinkUrl("http://example.com:8080/a/b?c=1#d")).toBe(
      "http://example.com:8080/a/b?c=1#d"
    );
  });

  it("javascript: 不产出可点击 URL（含大小写混淆与制表符插入变体）", () => {
    expect(safeFriendLinkUrl("javascript:alert(document.cookie)")).toBe("");
    expect(safeFriendLinkUrl("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeFriendLinkUrl("java\tscript:alert(1)")).toBe("");
  });

  it("data: / vbscript: / file: / ftp: 等其余协议不产出可点击 URL", () => {
    expect(safeFriendLinkUrl("data:text/html,<script>alert(1)</script>")).toBe(
      ""
    );
    expect(safeFriendLinkUrl("vbscript:msgbox(1)")).toBe("");
    expect(safeFriendLinkUrl("file:///etc/passwd")).toBe("");
    expect(safeFriendLinkUrl("ftp://example.com/x")).toBe("");
  });

  it("空值/非字符串输入返回空串", () => {
    expect(safeFriendLinkUrl("")).toBe("");
    expect(safeFriendLinkUrl(null)).toBe("");
    expect(safeFriendLinkUrl(undefined)).toBe("");
  });

  it("协议相对 URL / 相对路径 / 无 scheme 与写入侧同集合拒绝", () => {
    expect(safeFriendLinkUrl("//evil.com")).toBe("");
    expect(safeFriendLinkUrl("/friend/page")).toBe("");
    expect(safeFriendLinkUrl("evil.com")).toBe("");
  });
});
