# 代码审查报告：M19 富文本策略统一（issue #99）

**日期**：2026-11-16
**固定点**：`f089096`（#99 收尾改动前 HEAD）
**关联**：#92 已建立单一源（rich-text-policy.json + Worker 白名单消毒器 + 跨端一致性测试），本票为收尾。

---

## Standards

**HARD**：无。仅常量化 + 文档补充，行为等价。

**JUDGEMENT（4 项）**：

| #   | finding                                                                                  | 处置                                                                                                   |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | testing.md 登记与测试实际覆盖不符（称 XSS 由 #92 覆盖，但本票边界测试也含 XSS 标签断言） | **已修**：登记改为区分「fail-closed 字面量断言（本票）」与「跨端消毒穿透测试（#92）」                  |
| 2   | 测试用正则读源码 / GLOSSARY `toContain` 价值偏低、脆弱                                   | **接受**：契合仓库既有静态守卫惯例（settings/cors 漂移守卫同类），作为文档/声明存在性守卫              |
| 3   | escape.ts prettier 格式噪音（单→双引号、重排）与实质变更同提交                           | **接受**：项目有 pre-commit prettier 钩子，历史同类（#84/#88）；已核内容等价，仅 HIGHLIGHT_TAGS 为新增 |
| 4   | escape.ts:42 单值单消费者常量疑似 Middle Man                                             | **接受**：服务票面「策略视图」可命名诉求，非纯转发                                                     |

**最严重（Standards）**：登记失真（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「搜索高亮边界在文档说明」：GLOSSARY 已建「## 富文本消毒」三术语，但「为何不合并」理由偏弱 → 本轮不改：正文白名单不含 mark、sanitizeHighlight 仅用 mark 已由测试钉住，文档已明确「两层不互相合并」，足够。

**(b) scope creep**

- escape.ts 全文件 prettier 化：格式噪音，内容等价，非功能越界。

**(c) 实现有误**

- GLOSSARY 把 DOM clobbering 防护说成「前端 DOMPurify 渲染层」→ **已修**：核实实际为 `markdownServer.ts` → sanitize-html transformTags 消费 `ARTICLE_BODY_FORBIDDEN_IDS`，浏览器侧 DOMPurify 走自身动态检查；正文交付前台必经服务端渲染器，防护在该层生效。
- 边界测试的 XSS 块 describe 名「跨端 XSS 样本一致性」名不副实（仅静态查 JSON）→ **已修**：改为「正文白名单不含高风险标签 / scheme」并注明真正跨端测试由 #92 覆盖。

**核对通过**：HIGHLIGHT_TAGS=['mark'] 与正文白名单（不含 mark）互不干扰；未触碰编辑器 markdown 策略 / 后台预览 DOMPurify；三项门禁实测全绿。

**最严重（Spec）**：GLOSSARY 机制描述错误（已修）。

---

## 门禁（修复后）

- 根包：47 files / 535 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints。
- Worker：41 files / 384 tests PASS。
