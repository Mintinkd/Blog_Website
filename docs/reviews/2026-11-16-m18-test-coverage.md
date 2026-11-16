# 代码审查报告：M18 全局测试覆盖补强（issue #98）

**日期**：2026-11-16
**固定点**：`d7d59fc`（改动前 HEAD）
**审查范围**：`git diff d7d59fc...HEAD`（提交 `8538552` 实现 + follow-up 修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## 处置总览

两轴一致裁定：实现提交违反票面 **Out of scope「实现代码重构（测试暴露的缺陷另票修）」**——补测过程中改了 `api-proxy.ts`（hop-by-hop 剥离）与 `[...path].ts`（路径前缀校验），且测试注释自称"只补测"、文档称"本票最小修复"，自相矛盾。此外路径前缀校验在正常请求下不可达（WHATWG URL 入口已规范化），用 `Object.defineProperty` 伪造 pathname 才触发，属实现耦合测试。

**follow-up 已完整纠正**：

1. 撤销 `api-proxy.ts` / `[...path].ts` 的实现改动（恢复原状）。
2. hop-by-hop 缺陷改用 `it.fails` 留痕（当前失败=整体通过，修复后「意外通过」变红提示移除标记），按 Cross-ticket obligations 开 **#110** 承接（body 写明 Source: Deferred from #98、验收、与 #85 的关系）。
3. 删除伪造 url 的 dead-code 测试；保留「入口 URL 规范化」断言说明攻击面在平台层已关闭。
4. README / testing.md 契约面同步为「已知边界 → #110」。

---

## Standards

**HARD**：无遗留（越界改动已撤销）。

**JUDGEMENT（审查原始 findings 与处置）**：

| finding                                                             | 处置                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| 越界改实现 + 文档自相矛盾                                           | **已修**：撤销实现、文档改为「另票修」、开 #110            |
| 路径前缀校验 dead code / 伪造测试                                   | **已修**：删伪造测试，保留平台规范化断言                   |
| CORS `*` 断言与既有 `api-proxy-headers.test.ts` 重复                | **已修**：改用新样本（`X-Evil` 自定义头、非白名单 Origin） |
| `settings-injection.test.ts` 期望值取自 `getDefaultSettings()` 基线 | **接受**：非反推，无 tautology                             |

---

## Spec

**(a) 验收缺失/部分**

- ④escape / ⑤后台权限未新增测试：escape 由既有 `escape-unified.test.ts`（#95）、后台由既有 `admin-composables` / `admin-content-panels`（#69）覆盖，符合 Related「不重复造轮子」；侧边栏 `minRole` 门控为低风险纯展示、未单测，关票评论如实列为刻意未覆盖项。
- ③i18n 由既有 `i18n-key-parity.test.ts`（#68）覆盖（键+占位符差异 0），属复用既有设施。

**(b) scope creep**

- 审查发现的实现越界已撤销；本票最终只新增测试 + 文档 + #110 移交，符合 Out of scope。

**(c) 实现有误**

- 无（实现改动已全部撤销）。

---

## 门禁（修复后）

- 根包：50 files / 553 tests PASS + 1 expected fail（#110 缺陷留痕）；`npm run check` 0 errors / 0 warnings / 8 hints。
- Playwright 本票无改动（全批门禁将在第二批收口时统一跑）。
