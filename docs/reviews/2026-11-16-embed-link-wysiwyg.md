# Code Review: #74 WYSIWYG 插入内嵌链接保真

- **Fixed point:** `2a0f9b0`
- **Diff:** `git diff 2a0f9b0...HEAD`
- **Commits under review:** `0c66f97 fix(editor): preserve data-embed when inserting embedded links in WYSIWYG (#74)`
- **Spec:** GitHub issue #74（Deferred from #68 T7 已知限制 1）
- **Standards sources:** `CODING_STANDARDS.md`、`AGENTS.md`、`docs/agents/testing.md`、`docs/ARTICLE_EDITOR_UPGRADE.md`、`tests/editor-commands.test.ts`
- **Review date:** 2026-11-16

> diff 中 `docs/reviews/2026-11-16-m22-index-columns.md` 的 2 行是上票报告哈希回填，非本票逻辑，审查跳过。

## Standards

（子代理报告，lightly cleaned）

- **H1 [hard]**：`editorCommands.ts` 模块头声明"源码模式纯插入逻辑，输入 Markdown+选区、输出新文本+选区"，新增 `isEmbedSnippet`（string→boolean 判定）越出契约且注释未同步；README L140 结构清单未登记新导出（违反 CODING_STANDARDS.md「契约面同步」）。
- **H1 [judgement, 最严重]**：`isEmbedSnippet` 的 `(?:"1"|'1'|1)` 是 `embedLink.ts` 的 `EMBED_FLAG`（L36）第二份拷贝，且前缀 `\bdata-embed` 与 EMBED_FLAG 的 `(?:^|\s)` 不等价——`<a aria-data-embed="1">` 会被误判。两份 data-embed 口径漂移正是本票要根除的风险回流口。
- **H1 [judgement]**：Feature Envy + Primitive Obsession——embed 语义归属 embedLink.ts，判定却落在纯命令模块；上层 LinkDialog 已知 LinkMode，链路退化为裸 snippet 串后正则回判类型。
- **H2 [judgement]**：WYSIWYG 插入按字符串分三路；embed 路 `selection()` 在无 textarea 时落正文末尾，与普通链接的光标处插入行为分叉（非 documented rule）。
- **H3 [judgement]**：测试首例用 `buildLinkSnippet` 输出喂 `isEmbedSnippet`（producer/consumer 自证面）；非法样本未含 `*-data-embed` 前缀边界。
- **H4 [pass]**：回归脚本无 finding（条件等待、精确选择器、独立来源期望值）。

**Standards: 5 findings（hard 1 / judgement 4）；最严重 data-embed 口径两份不等价。**

## Spec

（子代理报告，lightly cleaned）

**逐项结论**：验收 1（PUT 含 data-embed、无预览 HTML、无 content_html）✅；验收 2（专用节点/点击不导航/文字可编辑/源码逐字保真）✅；验收 3（SSR 内嵌容器）✅；验收 4（断言升级+删降级注释）✅；验收 5（普通链接/源码模式/三测试全绿）✅。

**(a) 缺失/部分**

- **F1 [最严重]**：验收 6「审查报告『已知限制 1』与 README / testing.md 相关描述同步」未做。`docs/reviews/2026-11-15-article-editor-t7.md:73` 仍写降级为待修缺口，与本票已修复矛盾。

**(b) scope creep**：无。

**(c) 看似实现但有误**

- **F2**：WYSIWYG 下 `selection()` 因 textarea 不存在返回正文末尾，新 embed 分支把片段追加到文末而非 ProseMirror 当前光标；`replaceAll` 又重置选区。普通链接走 `insertMarkdown` 保留光标。用户提示的「光标位置」副作用坐实。`insertLink` helper 未设光标，恰好末尾插入，掩盖了此问题。

**方案评估**：草稿/脏状态安全（emit 绕过被 suppressChange 吞掉的 onChange）；编辑锁未改，不回归。唯光标/插入点未覆盖。

**Spec: 2 findings；最严重 F1 文档同步缺失。**

## 处置

| 来源                    | Finding                                                                                    | 处置                                                                                                                                                                                                                                                        | Fix commit                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Spec 1 [最严重]         | 验收6：T7 报告「已知限制 1」未同步为已修复                                                 | `docs/reviews/2026-11-15-article-editor-t7.md` 已知限制 1 标记为 #74 已修复，写明新方案与回归升级，并如实记录光标取舍                                                                                                                                       | 见下方 follow-up                                                                             |
| Standards 1 [judgement] | isEmbedSnippet 的 data-embed 口径与 embedLink.ts EMBED_FLAG 不等价，`aria-data-embed` 误判 | 正则前缀从 `\b` 改为 `(?:^                                                                                                                                                                                                                                  | \s)`（与 EMBED_FLAG 同口径）；尾部保留 `>`边界并注释差异原因；补`aria-data-embed` 不误判测试 | 同上 |
| Standards 1 [hard]      | 模块头契约（"源码模式纯插入逻辑"）未同步新导出；README 结构清单缺项                        | editorCommands.ts 头注释说明 isEmbedSnippet 属跨模式锚点判定；README L140 结构清单补登记                                                                                                                                                                    | 同上                                                                                         |
| Standards 1 [judgement] | Feature Envy / Primitive Obsession（embed 语义落纯命令模块）                               | 接受不改：保持 editorCommands 不依赖 milkdown 域（分层约束），判定与 EMBED_FLAG 口径一致且有测试守卫，不引入跨层 import                                                                                                                                     | —                                                                                            |
| Standards 2 [judgement] | WYSIWYG embed 落文末 vs 普通链接落光标（行为分叉）                                         | 与 Spec F2 合并处置：见下                                                                                                                                                                                                                                   | —                                                                                            |
| Standards 3 [judgement] | 测试首例 producer/consumer 自证面                                                          | 首例仍保留（验 buildLinkSnippet 与 isEmbedSnippet 的契约配对，有价值）；另加 6 个独立字面量非法样本含 `aria-data-embed`，独立来源充分                                                                                                                       | 同上                                                                                         |
| Spec 2 [judgement]      | WYSIWYG 插入点在文末而非光标，`replaceAll` 重置选区                                        | **如实保留为已知取舍，不扩大改动**：票面修复方向明确指定「更新 form.content → setMarkdown 整篇重解析」，已接受整篇重载；验收标准未要求保留 WYSIWYG 光标位置，且改精确光标需动 MilkdownEditor handle 定位（超本票范围）。已写入 T7 报告已知限制 1 与关票评论 | —                                                                                            |

> follow-up commit hash 在提交后回填。修复后验证：根包 `npm test` 471 测试、`isEmbedSnippet` 23 单测、5 个 Playwright 门禁（含升级后的编辑器回归 12 场景）、worker 304 测试、`npm run check`（0 errors）、`npm run build` 全绿。
