// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findAcaoWildcardRules,
  pickResponseHeaderRuleset,
  sanitizeRuleForPut,
  stripRules,
} from "../scripts/remove-edge-cors.mjs";

/**
 * 边缘 CORS 自动删除脚本的纯逻辑 seam（无网络、无凭证）。
 * 期望值用手写 fixture，独立来源；保守原则：只删明确加 `*` 的 ACAO 规则。
 */

describe("pickResponseHeaderRuleset", () => {
  it("从 zone rulesets 中选出 http_response_headers_transform 的 zone 级 ruleset", () => {
    const rulesets = [
      { id: "r1", phase: "http_request_firewall_managed", kind: "zone" },
      { id: "r2", phase: "http_response_headers_transform", kind: "zone" },
      { id: "r3", phase: "http_response_headers_transform", kind: "account" },
    ];
    expect(pickResponseHeaderRuleset(rulesets)).toEqual(rulesets[1]);
  });

  it("无匹配返回 null（fail-closed，不误删别的 phase）", () => {
    expect(
      pickResponseHeaderRuleset([
        { id: "r1", phase: "http_request_firewall_managed", kind: "zone" },
      ])
    ).toBeNull();
    expect(pickResponseHeaderRuleset([])).toBeNull();
  });
});

describe("findAcaoWildcardRules", () => {
  // fixture 需在后续用例里改成不同 header 形状，显式放宽类型避免 TS 推断过窄
  const wildcard: Record<string, any> = {
    id: "w1",
    ref: "add_wildcard_cors",
    action: "rewrite",
    expression: "true",
    action_parameters: {
      headers: {
        "Access-Control-Allow-Origin": { operation: "set", value: "*" },
      },
    },
  };
  const specific = {
    id: "s1",
    action: "rewrite",
    action_parameters: {
      headers: {
        "Access-Control-Allow-Origin": {
          operation: "set",
          value: "https://a.io",
        },
      },
    },
  };
  const otherHeader = {
    id: "o1",
    action: "rewrite",
    action_parameters: {
      headers: { "X-Source": { operation: "set", value: "Cloudflare" } },
    },
  };

  it("识别 set/add '*' 的 ACAO 规则（大小写不敏感）", () => {
    expect(findAcaoWildcardRules([wildcard])).toEqual([wildcard]);
    const lower = structuredClone(wildcard);
    lower.action_parameters.headers["access-control-allow-origin"] = {
      operation: "add",
      value: "*",
    };
    delete lower.action_parameters.headers["Access-Control-Allow-Origin"];
    expect(findAcaoWildcardRules([lower])).toEqual([lower]);
  });

  it("保守：具体域名 / 其他 header / remove 操作 / 动态表达式都不动", () => {
    expect(findAcaoWildcardRules([specific, otherHeader])).toEqual([]);
    const removeOp = structuredClone(wildcard);
    removeOp.action_parameters.headers["Access-Control-Allow-Origin"] = {
      operation: "remove",
    };
    expect(findAcaoWildcardRules([removeOp])).toEqual([]);
    const dynamic = structuredClone(wildcard);
    dynamic.action_parameters.headers["Access-Control-Allow-Origin"] = {
      operation: "set",
      expression: "http.request.headers['origin']",
    };
    expect(findAcaoWildcardRules([dynamic])).toEqual([]);
  });

  it("空输入返回空数组", () => {
    expect(findAcaoWildcardRules([])).toEqual([]);
  });
});

describe("stripRules", () => {
  it("只剔除指定 rule id，其余按原顺序保留", () => {
    const rules = [
      { id: "a", ref: "a" },
      { id: "b", ref: "b" },
      { id: "c", ref: "c" },
    ];
    expect(stripRules(rules, [{ id: "b", ref: "b" }])).toEqual([
      { id: "a", ref: "a" },
      { id: "c", ref: "c" },
    ]);
  });

  it("无 id 时用 ref 匹配（规则可能尚未分配 id）", () => {
    const rules = [{ ref: "x" }, { ref: "y" }];
    expect(stripRules(rules, [{ ref: "x" }])).toEqual([{ ref: "y" }]);
  });

  it("空剔除集返回原数组的副本（幂等）", () => {
    const rules = [{ id: "a" }];
    expect(stripRules(rules, [])).toEqual(rules);
  });
});

describe("sanitizeRuleForPut", () => {
  it("只保留 PUT 允许的字段，剥离服务端只读元数据", () => {
    const fromGet = {
      id: "rule-1",
      ref: "my_ref",
      version: "3",
      last_updated: "2026-11-16T00:00:00Z",
      description: "keep me",
      expression: "true",
      action: "rewrite",
      enabled: true,
      action_parameters: {
        headers: { "X-A": { operation: "set", value: "b" } },
      },
    };
    expect(sanitizeRuleForPut(fromGet)).toEqual({
      ref: "my_ref",
      description: "keep me",
      expression: "true",
      action: "rewrite",
      enabled: true,
      action_parameters: {
        headers: { "X-A": { operation: "set", value: "b" } },
      },
    });
  });

  it("没有可选字段时不产出 undefined 键", () => {
    expect(
      sanitizeRuleForPut({ id: "x", expression: "true", action: "rewrite" })
    ).toEqual({
      expression: "true",
      action: "rewrite",
    });
  });
});
