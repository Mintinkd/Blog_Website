# 代码审查报告：M6 消毒器白名单化（issue #92）

**日期**：2026-11-16
**固定点**：`6fb4a86`（改动前 HEAD）
**审查范围**：`git diff 6fb4a86...HEAD`（提交 `d554ec4` 实现 + follow-up 修复）
**双轴**：Standards（仓库明文标准 + Fowler smell）、Spec（issue #92 验收），并行子代理独立审查。

---

## Standards

**HARD（1 项，已修）**：

1. `worker/src/utils/sanitizer.ts` 的 ALLOWED_TAGS / ALLOWED_ATTR 仍零引用——`SANITIZE_OPTIONS` 直接用 RICH_TEXT_* 绕开两常量，正是票面要消除的「白名单常量定义后零引用假象」。→ follow-up 改为 `allowedTags: [...ALLOWED_TAGS]` / `allowedAttributes: ALLOWED_ATTR`，两常量成为配置唯一输入；测试补「白名单内保留 / 外丢弃」行为断言证明被真正消费。

**JUDGEMENT（4 项）**：

| #   | 位置                       | finding                                                                                            | 处置                                                                                                                                   |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 单一源守卫覆盖             | 前端 markPolicy 的 DOM-clobbering forbid-ids / transformTags 未纳入单一源，worker 消毒器无对应防护 | **接受并留痕**：worker 消毒后交付前台会再过 DOMPurify（markdownPolicy 二次消毒）兜底成立；纳入单一源列为 #99 深化项，README 已写明边界 |
| 2   | `stripAllHtml`             | 旧正则去标签函数零调用点，语义与白名单「整段丢弃」冲突                                             | **已修**：删除该函数                                                                                                                   |
| 3   | `docs/agents/testing.md:7` | 仍写「两份生成物漂移断言」与 README「四份」不一致                                                  | **已修**：改为四份并列出 gen:rich-text                                                                                                 |
| 4   | 精确版本锁                 | worker 锁 `sanitize-html@2.17.5` vs 根包 `^2.17.5`                                                 | **接受**：精确锁避免跨端消毒行为漂移，是有意选择                                                                                       |

（lock 259 行为依赖树正常展开，非问题。）

**最严重（Standards）**：HARD-1 常量零引用（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「至少不比前端更宽松」：tags / attrs / schemes / forbid 四集合与前端逐项一致并由交叉测试守卫；DOM-clobbering id 防护仅前端有（见 Standards #1），由前台 DOMPurify 兜底，#99 深化。

**(b) scope creep**

- 新增 rich-text-policy.json + 生成器 + CI drift + README/docs，承担了 M19 单一源基建——票面 Related 明确两票同域共享白名单归属决策，属协同而非越界。

**(c) 实现有误**

- 「两个常量被真正消费」字面未满足 → **已修**（见 HARD-1）。

**核对通过**：5 类 XSS 全部封堵且有回归；合法标签 / 属性 / 表格 / data-* / aria-* 不丢失；comment.ts / admin.ts 调用点未改；未触碰前端 markdownPolicy / DOMPurify / 图片代理（out-of-scope）；worker 375 tests + typecheck、根包 518 tests + check 全绿；drift check 通过。

**最严重（Spec）**：常量零引用（已修）。

---

## 门禁（修复后）

- Worker：39 files / 375 tests PASS；typecheck 0 errors。
- 根包：44 files / 518 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints。
- 跨端一致性：`tests/rich-text-policy.test.ts` 7 PASS（前端 markdownPolicy ↔ rich-text-policy.json ↔ worker 生成物）。
- drift：`npm run gen:rich-text` 重生成后 git diff 为空。

## 交接 #99

- 搜索高亮 `['mark']` 白名单边界待文档化（#99 验收）。
- DOM-clobbering forbid-ids 纳入单一源待 #99 深化。
