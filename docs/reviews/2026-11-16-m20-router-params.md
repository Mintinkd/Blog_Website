# 代码审查报告：M20 路由参数解析（issue #100）

**日期**：2026-11-16
**固定点**：`eca8780`（改动前 HEAD）
**审查范围**：`git diff eca8780...HEAD`（提交 `0c5fb30` 实现 + follow-up 修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## Standards

**HARD（1 项，已修）**：

1. `routesByMethod = {}` 的键取自未归一化的 `request.method`——`constructor` / `__proto__` / `toString` 等原型属性名命中继承属性，`?? []` 失效，`for...of` 对非数组抛错 → 500（审查 node 实测）。旧线性过滤无此问题，属 method 分桶引入的回归。→ follow-up 改 `Map<string, Route[]>`，未知 method 落空桶 → 404；补 4 个原型键断言。

**JUDGEMENT（3 项）**：

| #   | 位置                   | finding                                                          | 处置                                                                                      |
| --- | ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `compileRoutePath:139` | `:name` 读到下一 `/`，参数后紧跟字面量（`:name.json`）会编译错误 | **接受**：当前全部路由参数为独占段，无此形态；属 speculative 地雷，改造需额外词法边界逻辑 |
| 2   | `matchRoute` 导出      | 仅测试消费，扩大 API 面                                          | **接受**：纯函数编译 + 匹配 seam 是工单 Key interfaces 点名处，测试直接消费合理           |
| 3   | `media.test.ts`        | prettier 全文件重排（195 行 diff），实质仅 serve 桩一处          | **接受**：项目 pre-commit prettier 钩子，历史同类（#84/#88/#99）；已核内容等价            |

**最严重（Standards）**：HARD-1 原型键 500（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「cd worker && npm run check 全绿」：worker 无 `check` 脚本（验收实指根包 astro check + worker typecheck），两者均绿。

**(b) scope creep**

- 无。method 分桶票面明示可一并实现；无 taxonomy v2 新端点。

**(c) 实现有误**

- `:slug` 正则漏点号 / 波浪号，存量 `v1.0` 类 slug 会 404 → **已修**：补 `[A-Za-z0-9._~-]`，并加单测。
- 注释称 slug「拒绝尖括号 / 引号 / 空格」，但编码后的 `%3C` / `%20` 会放行 → **已修**：注释改为准确描述（只拒未编码字符，编码内容由 handler 参数绑定 + 前端 escapeHtml 保证安全）。

**核对通过**：`:id` 非数字 → 404、纯数字违契约 → 400，无 `bind(NaN)`；`params['0']` 用法清零；元字符转义有测试；既有路由回归全过、无顺序回归。

**最严重（Spec）**：slug 点号 404（已修）。

---

## 门禁（修复后）

- Worker：42 files / 394 tests PASS；typecheck 0 errors。
- 根包：47 files / 535 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints；README 契约测试 13 PASS。
