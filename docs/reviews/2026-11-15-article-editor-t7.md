# 代码审查：#68 编辑器 T7（回归、CI 门禁与文档收尾）

- 日期：2026-11-15
- 固定点：`7243cf6`（`git rev-parse` 确认可解析）
- 审查对象：`git diff 7243cf6...HEAD`（三点，对 merge-base）
- 提交：`git log 7243cf6..HEAD --oneline` → `523f27c feat(editor): add stateful E2E regression, CI gate and contract sync (#68)`（15 文件，+1990 / −334）；`8a0fba5 fix(editor): address T7 review findings (#68)`（11 文件，+138 / −55）
- 审查针对 `523f27c`；`8a0fba5` 是本报告发现项的修复提交，哈希在两处引用保持一致
- Spec 来源：GitHub issue #68（`[编辑器 T7] 编辑器回归、CI 门禁与文档收尾`）、`docs/ARTICLE_EDITOR_UPGRADE.md` §10.3 / §10.4 / §13、母票 #60
- Standards 来源：`CODING_STANDARDS.md`、`AGENTS.md`、`README.md`、`GLOSSARY.md`、`docs/agents/testing.md`、`docs/agents/windows-shell.md`，外加 Fowler《Refactoring》ch.3 smell baseline

两个轴由并行子代理独立产出，按 `/code-review` 约定分开呈现，不合并、不重排。

## Standards

**Standards 轴 · `523f27c`（15 文件，只读）**

**硬性违规**（`CODING_STANDARDS.md`「契约面同步」，所引规则未标 judgement call）

1. `README.md:452`、`docs/agents/testing.md:21`：同段仍称 `verify-editor-responsive.mjs`「手动回归」，段末又写「已由 T7 #68 接入 CI 门禁」，而 `deploy.yml` 确已纳入门禁——旧行为陈述未删，自相矛盾。
2. `README.md:166,451,603`、`testing.md:19,80`、`deploy.yml:105` 一律写「9 条场景／每场景独立 context」；但 `verify-article-editor.mjs` 实跑 **12 个 `withScenario`**（检查单 1/5/7 各拆 2、8 拆 3），仅 `UPGRADE.md §10.3` 写对「12 个独立 context 覆盖 9 条」。契约数字失真。
3. `mock-admin-api.d.mts:44` 注释引 `createAdminApi` 却未标出处，易被读成 mock 内部不存在的函数（实现为 `createAdminApiState`）。
4. `docs/agents/testing.md:158`「共享定义只有一份」：`verify-article-editor.mjs` 硬编码 `/__control` `/__reset` `/__stats`，而同类 `verify-article-ssr.mjs` 用 `MOCK_PATHS` 常量；`/__stats` 双定义（`article-ssr-fixture.mjs`／`mock-admin-api.mjs`），`MOCK_CONTROL_PATHS.stats` 无消费方，`testing.md:82` 却称该导出供脚本与测试「共用」。
5. 1×1 PNG base64 重复于 `verify-article-editor.mjs`／`mock-article-api.mjs`；`/media/cover.png` 兜底 route 在 editor / admin-responsive 各写一份且响应格式不同（PNG / SVG）。

**判断性意见**（Fowler ch.3 baseline，皆 possible 启发式，永非硬性；仓库标准优先）

- possible **Duplicated Code**：`ok` 同形多处；`/edit` + `edit-lock` 分支与正则在 `editor-meta-fixture.mjs` 和 `verify-admin-responsive.mjs` 重复。
- possible **Repeated Switches**：`catalogFixture` 与 `fixtureFor` 两套 pathname 级联分散两文件。
- possible **Speculative Generality**：`MOCK_CONTROL_PATHS.stats` 死导出。
- possible **Mysterious Name**：`mock-admin-api.mjs` 的 `const once`。
- possible **Shotgun Surgery**：加一个故障标志须散改 `flags`／`.d.mts`／test／`control()`／三处文档。

已核对：删除的 3 个 i18n key 全仓无残留引用；跳过 astro check / vitest / 生成物 drift 等工具强制项。

## Spec

**Spec 轴 · `523f27c`（只读）**

**(a) spec 要求但缺失 / 部分实现**

1.【高】票面「`docs/reviews/YYYY-MM-DD-article-editor.md` 审查报告」「#42 留言编辑器批次 L3 证据」：提交态无报告，#42 仅立项留言，#68 仍 OPEN，§13「逐条映射与关闭证据在 #68 / #69 关票留言」未执行。2.【中】票面「7. 锁冲突 / 心跳冲突禁止保存」：仅取锁冲突、保存前校验失锁两场景；`verifyConflict` 命中下一次 `POST /edit-lock` 即 save 校验（与心跳同构），心跳 409 → lock-lost 无浏览器场景，§13 自认「10 分钟真实心跳…不在浏览器重复」。3.【中】票面「新增编辑器目标（工具栏、元信息、弹窗、选中态）」：未增 target，只补一条 VF-07，注释自认「不新增 target 条目」。4.【低】票面「检查包体与后台首屏 chunk」「校验 zh/en 键集合一致」：提交内无检查物。

**(b) 范围蔓延**

5.【低】票面「接入新脚本，失败阻断部署」：额外把 T6 的 `verify-editor-responsive.mjs` 接进 `deploy.yml`，超出「新脚本 + 两扩展」清单。

**(c) 看似实现、实为简化 / 绕开**

6.【中】§10.3「插入普通链接与内嵌链接」：只断言 `data-embed="1"`（语料存量 anchor 即满足，自注「存量…必须保留」），未断言新插入文本；WYSIWYG `insertMarkdown` 把 embed 片段降级为普通链接，测试仍会通过。7.【低】§10.4「真实用户从桌面拖图片文件进编辑器（…T7 未自动化复现）」：回归仅 `setInputFiles`。

**已核实覆盖到位**：有状态 mock 含登录 / 列表 / edit 详情 / PUT / 锁三端点 / 上传 / 公开读取，`PUT` 与 SSR `GET` 共用内存 `articles`，SSR 走 `ARTICLE_API_ORIGIN` 直连、非仅 `page.route`；9 条中 1、3、4、5、6、8、9 均有对应场景；旧模式 i18n key 已从 zh/en/settings.ts 全删且无残留引用；`App.vue` 已无编辑器残留（226 行）；GLOSSARY 编辑分组、ADR 0006 accepted、README 技术栈 / API / 编辑器小节均已就位（早于固定点）。

## 门禁结果（`8a0fba5` 修复后复跑）

| 检查                             | 结果                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                  | 0 errors / 0 warnings / 8 hints（146 files，8 hints 均为既有）                                                                              |
| `npm test`（根包 vitest）        | 39 files / 470 tests PASS（含新增 `tests/mock-admin-api.test.ts` 9 项、`tests/i18n-key-parity.test.ts` 3 项）                               |
| worker `npm run typecheck`       | PASS                                                                                                                                        |
| worker `npm test`                | 27 files / 285 tests PASS                                                                                                                   |
| `npm run build`                  | PASS（CSP 静态与 SSR 逐字符一致）                                                                                                           |
| 设置白名单 / 安全头生成物 drift  | 无漂移（`npm run gen:settings` / `gen:headers` 后 `git diff --exit-code` 为空）                                                             |
| `verify-article-ssr.mjs`         | PASS（#41 六项全通过，确认扩展后的 mock 未破坏原 SSR 三态）                                                                                 |
| `verify-article-editor.mjs`      | PASS（12 场景，spec §10.3 的 9 条全部覆盖）                                                                                                 |
| `verify-admin-responsive.mjs`    | PASS（280 / 375 / 1280，含新增编辑器遮罩检查）                                                                                              |
| `verify-editor-responsive.mjs`   | PASS（24 组断言）                                                                                                                           |
| `verify-visual-friendliness.mjs` | PASS（10 组场景 × 838 条断言）                                                                                                              |
| zh/en i18n 键集合                | 362 / 362 完全一致；参数占位符 0 处不一致                                                                                                   |
| 包体 / 后台首屏                  | Milkdown + ProseMirror 仅在懒加载 `createEditor` chunk（gzip 181,013 B < 350 KiB 预算）；`App` 壳层 chunk gzip 34,125 B，未被编辑器内核污染 |

## 已知限制 / out-of-scope（如实保留）

1. **WYSIWYG 下插入内嵌链接被降级**（~~已知缺口~~ → **#74 已修复**）：`buildLinkSnippet(..., "embed")` 生成 `<a href="…" data-embed="1">`，T7 时期 `MilkdownEditor.insertMarkdown()` 的 inline `insert(snippet, true)` 序列化往返会把它降级成普通 `[text](url)`，`data-embed` 不进请求体。当时属 T4/T5 实现缺口、超出 #68「回归 / CI / 文档」范围，故 `8a0fba5` 起回归只断言「链接文本进入请求体」并注释成因，不把降级固化成期望。**#74 收口**：embed 片段改走「更新 form.content → `setMarkdown` 整篇重解析」路径，`embedLinkRemark` 正确建 `embed_link` 节点；回归断言已升级为「新插入链接带 `data-embed="1"`」并加编辑器 DOM 节点断言（`docs/reviews/2026-11-16-embed-link-wysiwyg.md`）。存量 anchor 保真证据不变。已知取舍：整篇重载会把新节点追加到正文末尾而非 ProseMirror 当前光标（普通链接仍走光标处 inline 插入）。
2. **10 分钟真实心跳未在浏览器快进**：`verifyConflict` 覆盖的是 `save()` 的保存前持有权校验；心跳与它共用 `createEditLock.request → conflictFound → onConflict` 同一分支。`tests/edit-lock.test.ts` 已有「10 分钟心跳用同一 POST 续期」与「心跳冲突立即停表并通知失锁，不再续期」两条 fake timers 用例锁定定时器与冲突路径，按 `docs/agents/testing.md`「同一行为不重复测」口径未在浏览器重复。
3. **真实用户拖拽未自动化**：T5 只有合成 `DragEvent`；T7 用 `setInputFiles` 覆盖上传链路，真实桌面拖拽保留为 `docs/ARTICLE_EDITOR_UPGRADE.md` §10.4 手工检查项。
4. **观感 target 未新增独立条目**：四类编辑器目标由既有 `TARGETS[0]`（弹窗 / 选中态）与 `EDITOR_TARGETS[0]`（元信息 / 工具栏）采集覆盖，本票补 `toggles` 采集与 VF-07 断言；新增 target 会重复跑同一套 `collectEditorSnapshot` 断言。按票面「部分实现」如实保留。
5. **包体检查无 CI 断言**：结论记录在本报告门禁表（懒加载 chunk gzip 181,013 B、`App` chunk 34,125 B）；chunk 哈希随构建变化，体积阈值断言易 flaky，未加入 CI。
6. **全量 L3 关闭证据**：编辑器批次 L3 证据由 #42 留言收口；全量 L3 仍由 T8 #69 与 #60 收口（#69 当前仍 OPEN），不在本票关闭。

## 处置与修复提交

修复统一落在 follow-up commit **`8a0fba5`** `fix(editor): address T7 review findings (#68)`（11 文件，+138 / −55），因此下面的哈希在报告与关票留言里恒有效；审查报告与关票证据另由 docs commit 与 issue 留言收口。

### Standards 轴

| #   | 处置                                                                                                                                                                                                                                 | 提交      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| S-1 | `README.md` / `docs/agents/testing.md` 的「手动回归」改为「浏览器回归（已由 T7 接入 CI 门禁）」，消除同段自相矛盾                                                                                                                    | `8a0fba5` |
| S-2 | 六处契约数字统一为「§10.3 九条检查单 → 12 个独立 `withScenario` 场景」，`testing.md:80` 写明拆分（1/5/7 各 2、8 拆三档视口）                                                                                                         | `8a0fba5` |
| S-3 | `.d.mts` 注释改为完整路径 `src/admin/composables/useAdminApi.ts 的 createAdminApi`，消除与 `createAdminApiState` 的混淆                                                                                                              | `8a0fba5` |
| S-4 | `MOCK_PATHS` 扩为 mock 自有端点单一事实源（`health` / `stats` / `control` / `reset`）；删除死导出 `MOCK_CONTROL_PATHS` 及其 `.d.mts` 声明；`mock-article-api.mjs` / `verify-article-editor.mjs` 不再硬编码端点；`testing.md:82` 同步 | `8a0fba5` |
| S-5 | `PLACEHOLDER_PNG` / `PLACEHOLDER_IMAGE_ROUTE` 提到 `article-ssr-fixture.mjs`，mock、编辑器回归、`verify-admin-responsive.mjs` 共用同一 PNG（移除 SVG 分叉）                                                                          | `8a0fba5` |

判断性意见：

- **Speculative Generality / Mysterious Name**：已修（`MOCK_CONTROL_PATHS` 删除；`once` → `consumeVerifyConflict`），`8a0fba5`。
- **Duplicated Code（`ok` 同形、`/edit` 正则）**：保留。`editor-meta-fixture.mjs` 的 `EDITOR_EDIT_DETAIL` 已是唯一字面量，`verify-admin-responsive.mjs` 已 import 它；`ok` 是跨 fixture 包边界的两行 envelope 包装，抽公共模块会引入 `scripts/` → `src/` 反向依赖，收益不抵耦合。
- **Repeated Switches**：保留。`catalogFixture`（可写状态机）与 `fixtureFor`（只读观感响应）职责不同，合并会让观感脚本依赖 admin 状态。
- **Shotgun Surgery**：接受。故障标志是显式契约，跨状态机 / 类型声明 / 单测 / 文档同步正是 `CODING_STANDARDS.md`「契约面同步」的要求，不是缺陷。

### Spec 轴

| #   | 处置                                                                                                                                                                                                                                                                                                                       | 提交 / 出口            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| P-1 | 归档本双轴报告；#42 编辑器批次 L3 证据与 #68 验收对照长文由关票留言收口（全量 L3 仍由 T8 #69 / #60 收口）                                                                                                                                                                                                                  | 见 #42 / #68 留言      |
| P-2 | 部分接受。`tests/edit-lock.test.ts` 已有「10 分钟心跳用同一 POST 续期」与「心跳冲突立即停表并通知失锁，不再续期」两条 fake timers 用例；浏览器 `verifyConflict` 走同一 `createEditLock.request → conflictFound → onConflict` 分支。按 `docs/agents/testing.md`「同一行为不重复测」不新增浏览器快进，如实保留在「已知限制」 | 已知限制 2             |
| P-3 | 接受工程判断并固化说明：`verify-visual-friendliness.mjs` 文件头已逐项映射四类目标（工具栏 / 元信息 / 弹窗 / 选中态），本票新增 `toggles` 采集与 VF-07 断言（10 组 × 838 条）。新增独立 target 会重复跑同一套 `collectEditorSnapshot` 断言，收益有限；票面按「部分实现」如实保留                                            | 已知限制（审查结论）   |
| P-4 | 新增 `tests/i18n-key-parity.test.ts`（3 项：键集合、花括号参数占位符、旧三档 key 不回归），把一次性比对变成可复跑门禁；包体结论记录在本报告，不做 CI 体积断言（chunk 哈希随构建变化，阈值易 flaky）                                                                                                                        | `8a0fba5` + 本报告     |
| P-5 | 有据保留，非蔓延：#67 关票留言 out-of-scope 第 3 条明确写「CI 门禁接线归 T7 #68」，`verify-editor-responsive.mjs` 是 T6 留下的手动脚本，接入符合票面「CI 门禁」意图                                                                                                                                                        | 保留                   |
| P-6 | `verify-article-editor.mjs` 加注释说明降级成因，并新增「embed 模式插入的链接文本应进入请求体」断言；`data-embed="1"` 保真断言明确限定为存量 anchor。产品侧修复超出 T7 范围                                                                                                                                                 | `8a0fba5` + 已知限制 1 |
| P-7 | 如实保留为 §10.4 手工检查项                                                                                                                                                                                                                                                                                                | 已知限制 3             |

**轴内小结**：Standards 5 项硬性 + 2 项判断性修复，最严重为契约数字失真（S-2）；Spec 1 项高（流程末端报告 / L3 证据，由本文件与关票留言收口）、3 项中（P-2 / P-3 / P-6，均已处置或如实保留），最严重为 P-1。两轴不合并、不重排。
