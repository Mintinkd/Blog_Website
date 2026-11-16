# 代码审查报告：M15 escape 四份收敛（issue #95）

**日期**：2026-11-16
**固定点**：`0b95c42`（改动前 HEAD）
**审查范围**：`git diff 0b95c42...HEAD`（提交 `d3e9b56` 实现 + follow-up 修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## Standards

**HARD（1 项，已修）**：

1. 全仓仍有 3 份逐字相同的 `escapeHtml`（前端单源 + `worker/src/utils/sanitizer.ts` + `worker/src/handlers/search.ts`），后两份同包可直接 import 却未收敛，违反 GLOSSARY「单一事实源」。→ follow-up 让 `search.ts` import `utils/sanitizer` 的 escapeHtml、删本地定义，并加测试守卫。

**JUDGEMENT（2 项）**：

| #   | 位置                           | finding                                                                           | 处置                                                                                                                                     |
| --- | ------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tests/escape-unified.test.ts` | 本地 esc 正则只覆盖 function/const，漏 let/var/箭头；import 正则绑死路径/具名写法 | **已修**：正则扩为 `(?:function                                                                                                          | const | let | var)\s+esc\s*[=(]`+ 箭头赋值；并加全仓`.astro`/`.vue` 通用扫描（以实体字面量过滤键盘 Esc 等无关 esc） |
| 2   | `escapeHtml` 对 undefined 行为 | 旧本地 `String(s)` → `"undefined"`，新单源 `String(s ?? '')` → `""`               | **接受并留痕**：字段缺失时不渲染 "undefined" 文本是行为改进；数值实体 `&#39;`→`&#039;` 语义等价、无字节依赖（审查独立确认 dataset 解码） |

**最严重（Standards）**：HARD-1 同包重复未收敛（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「禁止重复定义 escape 函数」规则原仅硬编码 3 个 .astro → **已修**：加全仓 `.astro`/`.vue` 通用扫描守卫（票面允许「否则至少加测试断言」；L2 ESLint 未落地，本票不引入工具链）。
- 「escapeAttr 五字符口径」断言名不副实 → **已修**：补 escapeAttr 与 escapeHtml 逐字一致测试。

**(b) scope creep**

- 无。搜索高亮 / DOMPurify / ESLint 工具链均未动。

**(c) 实现有误**

- 「统一 import escapeHtml, escapeAttr」：三页面属性位用 escapeHtml 而非 escapeAttr（两者是别名，语义等价）→ 属措辞口径，未造成行为差异；escapeAttr 别名存在本身即为审计命名，不强制调用点区分。

**核对通过**：三份本地 esc 删除、五字符统一（含 `'`）、正常中文/搜索词不受影响；`npm run check` 0 errors、根包 527 tests、worker 384 tests 全绿。

**最严重（Spec）**：通用守卫缺失（已修）。

---

## 门禁（修复后）

- 根包：45 files / 527 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints。
- Worker：41 files / 384 tests PASS；typecheck 0 errors。
- grep：三页面无本地 esc；worker search.ts 无本地 escapeHtml；全仓 .astro/.vue 无 escape 副本。
