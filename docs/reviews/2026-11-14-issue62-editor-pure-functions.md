# issue #62（编辑器 T1）编辑器纯函数与行为基线 — 实施与两轴复审

- 日期：2026-11-14
- 工单：[#62](https://github.com/Mintinkd/Blog_Website/issues/62)（Part of #60；为 #64 / #65 提供测试护栏）
- 范围：新增 `src/utils/editor/` 五个纯函数模块与五个 vitest 行为基线；不改 `App.vue`、不动 Worker、不引入 Milkdown
- 标准来源：`README.md`（主契约）、`CODING_STANDARDS.md`、`docs/agents/testing.md`、`GLOSSARY.md`、`docs/ARTICLE_EDITOR_UPGRADE.md` §5 / §7 / §10.1、`docs/adr/0006-wysiwyg-markdown-editor.md`、`.github/workflows/deploy.yml`

## 改动清单

| 文件                                 | 内容                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/utils/editor/editorCommands.ts` | 源码模式命令：`mdEscapeText` / `mdEscapeUrl`（同名同规则迁自 `App.vue`）、`isAllowedLinkUrl`、`insertSnippet`、`wrapSelection`、`toggleLinePrefix`、`continueList`、`buildLinkSnippet` / `insertLink`、`buildImageSnippet` / `insertImage` |
| `src/utils/editor/draftStore.ts`     | 草稿键（版本 + 用户 + 文章）、白名单投影序列化、按用户 + 文章隔离、7 天惰性过期、1MB UTF-8 配额、storage 注入、按用户批量清理                                                                                                              |
| `src/utils/editor/slug.ts`           | `generateSlug` / `isValidSlug`；生成规则与 Worker `generateSlug` 逐步对齐                                                                                                                                                                  |
| `src/utils/editor/wordCount.ts`      | `countWords` / `readingTimeMinutes`；算法与 Worker `calculateReadingTime` 逐步对齐                                                                                                                                                         |
| `src/utils/editor/editorState.ts`    | `useArticleEditor` 纯 reducer：状态转移、派生脏状态、关闭决策、保存守卫、锁丢失、加载失败、Esc 分层、会话失效保留草稿                                                                                                                      |
| `tests/editor-commands.test.ts`      | 22 用例：包裹 / 行前缀 / 列表续行 / 链接与图片插入 / Markdown 与 HTML 转义分工                                                                                                                                                             |
| `tests/editor-draft.test.ts`         | 14 用例：键结构 / 隔离 / 过期边界 / 1MB 边界 / 坏数据清理 / 清理范围 / token 不落盘                                                                                                                                                        |
| `tests/editor-state.test.ts`         | 12 用例：脏状态 / 关闭决策三出口 / 保存失败 / 锁丢失 / 加载失败不可编辑 / Esc 分层                                                                                                                                                         |
| `tests/editor-slug.test.ts`          | 15 用例：与服务端同组样例对齐、120 字符截断、合法性校验                                                                                                                                                                                    |
| `tests/editor-word-count.test.ts`    | 14 用例：与服务端同组样例对齐、300 字 / 200 词边界、混合速率、最少 1 分钟                                                                                                                                                                  |
| `README.md`                          | 项目结构新增 `src/utils/editor/` 目录条目（标注尚未接入 UI）、`tests/` 行补编辑器行为基线                                                                                                                                                  |
| `docs/agents/testing.md`             | 前端单元测试段落补五个 T1 测试文件的分层说明与对齐约定                                                                                                                                                                                     |

五个模块均未被 `App.vue` 或任何运行时入口 import，因此本票 **零运行时行为变更**。

## Standards（契约面同步 / 测试约定）

- **契约面同步**（`CODING_STANDARDS.md` 头号复发项）：新增目录后 README 项目结构与 `tests/` 注释同步；本票无行为变更，README 行为 / API 契约段无需改写，结构条目明确写「尚未接入 UI，由 T3 #64 起消费」，避免读者把纯函数基线误读为已上线能力。`docs/agents/testing.md` 同步测试分层，避免测试导航失真。
- **行为锁期望值独立来源**（`docs/agents/testing.md`）：全部期望值为手写字面量。slug / 阅读时长的服务端规则在测试头注中逐字抄录作为独立推导来源，样例表按规则人工写出；不跨包 import Worker 实现，也不从被测函数反推。1MB 边界测试仅在**构造输入**时用 `serializeDraft` / `utf8ByteLength` 计算固定开销，断言的 `{ ok: true }` / `{ ok: false, reason: "oversize" }` 仍为手写字面量。
- **接缝分层**：按 `docs/agents/testing.md`「按改动面选择对应小节」，本票只做 node vitest；编辑器 Playwright 回归与 CI 门禁扩展由 T7 #68 承接，同一行为不两边重复测。
- **术语**：沿用 GLOSSARY「源码模式」「本地草稿」「文章编辑器」「语义等价回写」「编辑锁」等口径，未引入新术语；`GLOSSARY.md` 的「编辑」分组为 #60 前置在建改动，本票未触碰、未纳入提交。
- **无新增依赖 / 改动**：`package.json`、`package-lock.json`、Worker、`App.vue`、i18n、ADR 0006 状态、`deploy.yml`、生成物均未改。

## Spec（逐条对照工单）

| 工单条目                                                              | 落地与证据                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editorCommands.ts` 包裹选区 / 切换行前缀 / 列表续行 / 插入链接与图片 | 纯函数返回 `{ text, selection }`；22 用例钉住单行 / 多行前缀、有序列表序号递增与分隔符保留、空列表项退出、alt 选中、越界选区 clamp                                                                                                         |
| 迁入 `mdEscapeText` / `mdEscapeUrl` 并补测试                          | 同名同规则实现；测试显式对比 `escapeHtml("a[b]") === "a[b]"` 与 `mdEscapeText("a[b]") === "a\\[b\\]"`，钉住「`escape.ts` 的 HTML 编码不能替代 Markdown 转义」                                                                              |
| `draftStore.ts` 键 / 序列化 / 隔离 / 7 天 / 1MB / storage 注入        | `blog:article-draft:v1:u7:a42` 手写字面量；`DraftStorage` 接口注入内存桩；白名单投影保证 token 不进草稿；恰好 7 天有效、+1ms 清理；恰好 1MB 写入、+1 字节拒绝且不落盘；`clearUserDrafts` 只清该用户                                        |
| `slug.ts` 生成与合法性，规则对齐服务端                                | 10 组手写样例 + 120 字符截断；`isValidSlug` 允许首尾 `-`（服务端生成规则本身会产出，否则自相矛盾），拒绝空白 / `/` / `?` / `_` / `.`                                                                                                       |
| `wordCount.ts` 字数与阅读时长，算法对齐服务端                         | 9 组手写样例 + 300 字 / 200 词 / 混合速率边界；钉住「Markdown 标记与中文标点计入英文词」这一服务端既有口径，客户端不擅自修正                                                                                                               |
| `useArticleEditor` 状态 reducer 纯逻辑                                | `editorState.ts`：脏状态为基线派生值（不存第二份 dirty），覆盖关闭决策、保存失败保持打开/持锁/留草稿、锁丢失禁止保存、加载失败不可编辑、Esc 分层、会话失效保留表单供落盘                                                                   |
| 五个测试文件通过 `npm test`                                           | 根包 25 文件 / 279 用例全绿（新增 5 文件 / 77 用例）                                                                                                                                                                                       |
| 纯函数不依赖 DOM / Vue 运行时                                         | 五个测试文件全部 `@vitest-environment node`（node 无 `localStorage` / `document`）；`draftStore` 用内存 Map 桩；`editorCommands` 内嵌链接分支复用 `escape.ts` 的 `escapeAttr` / `escapeHtml`，不调用 DOMPurify 消毒路径，node 导入实测可用 |
| README 项目结构同步                                                   | 已同步（见改动清单）                                                                                                                                                                                                                       |
| 非目标：不引入 Milkdown / 不改 `App.vue` / 不动 Worker                | diff 中三者均无改动；`mdEscapeText` / `mdEscapeUrl` 在 `App.vue` 的旧副本按非目标保留，删除义务已由 #64 票面承接（「迁到 T1 的 `editorCommands.ts`，不得直接删除」）                                                                       |

## 红测验证（行为锁有效性）

临时把 `mdEscapeText` 换成 `escapeHtml`（模拟 issue 点名的「误把 HTML 编码当 Markdown 转义」），并删掉 `generateSlug` 的 `.replace(/-+/g, "-")`：

- 结果：`2 failed | 3 passed`（文件），`6 failed | 71 passed`（用例）—— commands 的 4 条转义 / 链接构造用例、slug 的 `a---b` 与 `- 标题 -` 样例变红，其余三个测试文件保持绿，证明各模块行为锁互相独立。
- 恢复后 `diff -r` 确认 5 个模块字节级一致，`npm test` 复跑 279 全绿。

## 验证

- 根包 `npm test`：25 文件 / 279 用例通过（新增 5 文件 / 77 用例）
- 根包 `npm run check`：0 errors（7 hints，均为既有未使用变量）
- 新增模块与测试单独 `tsc --noEmit --strict`：0 errors（astro check 不覆盖未被 import 的 .ts，故补跑）
- Worker `npm run typecheck` / `npm test`：通过，27 文件 / 285 用例
- CI 生成物漂移断言：`npm run gen:settings` / `npm run gen:headers` 后 `git diff --exit-code` 为空
- Prettier `--check`（本次 12 个改动文件）：通过
- 未跑 Playwright 浏览器回归：本票零运行时 / UI 改动，按 `docs/agents/testing.md`「按改动面选择对应小节」不重复测；CI 的三条 Playwright 门禁仍照常在推送后执行

## Out of scope（如实保留）

- `App.vue` 内 `mdEscapeText` / `mdEscapeUrl` / `escapeAttr` / `escapeHtmlText` 旧副本未删除、未改为 import：#62 非目标明确「不改 `App.vue`」，#64 票面已写明迁移与复用 `escape.ts` 的义务，属 T3 范围。
- `useArticleEditor` 的 Vue 包装、`useEditLock` 心跳与保存前锁校验的 mock fetch 测试、UI 层草稿防抖与「超限提示只显示一次」由 #64 / #66 承接；本票只提供纯 reducer 与结构化 `oversize` 返回值。
- `markdownBridge.ts`（回写守卫）、`uploadImage.ts`、Milkdown / Crepe、线上预览、i18n 文案、Playwright 脚本与 CI 门禁扩展、ADR 0006 状态转 `accepted`、审查批次 L3 证据分别属 #61 / #65 / #66 / #67 / #68，本票未提前实施。
- `docs/ARTICLE_EDITOR_UPGRADE.md`、`docs/adr/0006-wysiwyg-markdown-editor.md`、`GLOSSARY.md` 的「编辑」分组、`.t0-prototype/`、`tests/markdown-corpus.test.ts` 与 `tests/fixtures/` 为 #60 / T0 / 并行工单在建文件，未纳入本次提交。
- 未改 `markdownPolicy.ts` 正文白名单，未启用 `content_html`，未新增 D1 迁移或接口。
