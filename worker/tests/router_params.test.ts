import { describe, expect, it } from "vitest";
import { compileRoutePath, matchRoute } from "../src/router";

/**
 * issue #100 / M20：路由参数解析分型 + 具名通配 + 元字符转义。
 *
 * 接缝：compileRoutePath（纯编译）与 matchRoute（匹配 + 参数解析）——工单 Key interfaces。
 * 期望值全部手写字面量。
 */

describe("路径编译分型（issue #100）", () => {
  it(":id 只匹配纯数字，非数字不入参（避免 bind(NaN)）", () => {
    const { pattern, paramNames } = compileRoutePath("/articles/:id");
    expect(paramNames).toEqual(["id"]);
    expect("/articles/123".match(pattern)?.[1]).toBe("123");
    expect("/articles/abc".match(pattern)).toBeNull();
    expect("/articles/-1".match(pattern)).toBeNull();
    expect("/articles/1.5".match(pattern)).toBeNull();
  });

  it("slug 允许点号 / 波浪号（兼容 v1.0 等存量 slug）", () => {
    const { pattern } = compileRoutePath("/articles/:slug");
    expect("/articles/v1.0".match(pattern)?.[1]).toBe("v1.0");
    expect("/articles/my~post".match(pattern)?.[1]).toBe("my~post");
  });

  it("多段 :article_id / :tag_id 同样分型为数字", () => {
    const { pattern, paramNames } = compileRoutePath(
      "/articles/:article_id/comments/:comment_id"
    );
    expect(paramNames).toEqual(["article_id", "comment_id"]);
    expect("/articles/7/comments/12".match(pattern)?.[1]).toBe("7");
    expect("/articles/abc/comments/12".match(pattern)).toBeNull();
  });

  it(":slug 匹配安全字符集与百分号编码的中文 slug，拒绝注入字符", () => {
    const { pattern, paramNames } = compileRoutePath("/articles/:slug");
    expect(paramNames).toEqual(["slug"]);
    expect("/articles/hello-world_1".match(pattern)?.[1]).toBe("hello-world_1");
    // 中文 slug 在 pathname 里是 %xx 编码（浏览器/客户端自动编码）
    const cn = encodeURIComponent("中文slug");
    expect(`/articles/${cn}`.match(pattern)?.[1]).toBe(cn);
    // 原始尖括号 / 引号 / 反斜杠等注入字符不得匹配
    expect("/articles/<script>".match(pattern)).toBeNull();
    expect("/articles/a'b".match(pattern)).toBeNull();
    expect("/articles/a\\b".match(pattern)).toBeNull();
    // 路径段分隔（额外 slash）不得被单段 slug 吞掉
    expect("/articles/a/b".match(pattern)).toBeNull();
    // 注：%3C 等百分号编码是合法 URL 编码，slug 正则允许它（中文 slug 同样靠 %xx），
    // 解码后的内容安全由 handler 的 DB 参数绑定 + 前端 escapeHtml 保证，不靠路由层拒绝。
  });

  it("字面量路径中的正则元字符被转义（. + ? 等不当作通配）", () => {
    const { pattern } = compileRoutePath("/files/v1.0+hotfix");
    expect(pattern.test("/files/v1.0+hotfix")).toBe(true);
    expect(pattern.test("/files/v1X0Yhotfix")).toBe(false);
    expect(pattern.test("/files/v1.0Zhotfix")).toBe(false);
  });

  it("通配参数具名 *path，paramNames 不再含 '0'", () => {
    const { pattern, paramNames } = compileRoutePath("/media/serve/*path");
    expect(paramNames).toEqual(["path"]);
    expect(paramNames).not.toContain("0");
    expect("/media/serve/abc/def.png".match(pattern)?.[1]).toBe("abc/def.png");
  });
});

describe("matchRoute 分型行为（issue #100）", () => {
  it("非法 id 路径返回 404（不进入 handler、不 bind(NaN)）", async () => {
    // matchRoute 是同步纯函数，此处的 async 仅为描述——直接断言结果为 null。
    const res = matchRoute("GET", "/articles/abc/edit");
    expect(res).toBeNull();
  });

  it("合法 :id 与 :slug 各命中正确路由，不互相串味", async () => {
    const edit = matchRoute("GET", "/articles/7/edit");
    expect(edit).not.toBeNull();
    expect(edit!.params).toEqual({ id: "7" });

    const detail = matchRoute("GET", "/articles/hello-world");
    expect(detail).not.toBeNull();
    expect(detail!.params).toEqual({ slug: "hello-world" });
  });

  it("具名通配解析出 path 而非数字键", async () => {
    const res = matchRoute("GET", "/media/serve/a/b.png");
    expect(res).not.toBeNull();
    expect(res!.params.path).toBe("a/b.png");
    expect(res!.params["0"]).toBeUndefined();
  });

  it("原型属性名作为 method 不崩溃（Map 桶，无原型链污染）", () => {
    for (const method of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(() => matchRoute(method, "/articles/1")).not.toThrow();
      expect(matchRoute(method, "/articles/1")).toBeNull();
    }
  });

  // issue #108 / L10：method 分桶的结构断言——匹配只在该 method 的桶里找，
  // 不会跨 method 串味（#100 的 routesByMethod Map 已实现，本票仅补断言）。
  it("只匹配同 method 的路由，不跨桶串味（含大小写敏感）", () => {
    expect(matchRoute("GET", "/articles")).not.toBeNull();
    expect(matchRoute("DELETE", "/articles")).toBeNull();
    expect(matchRoute("PUT", "/articles")).toBeNull();
    // method 来自 request.method，按原样取桶：小写不是合法 HTTP method，落空桶
    expect(matchRoute("get", "/articles")).toBeNull();
    // 同一路径不同 method 各自命中自己的桶
    expect(matchRoute("POST", "/articles/1/like")).not.toBeNull();
    expect(matchRoute("GET", "/articles/1/like")).toBeNull();
  });
});
