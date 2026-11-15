# 后台面板全量拆分与壳层收口（issue #69 / T8）代码审查报告

2026-11-15。固定点 `75c87f8`（并行 T6 #67 收尾、`#69` 起点），审查命令 `git diff 75c87f8...HEAD`（三点，对比 merge-base），提交清单 `git log 75c87f8..HEAD --oneline`。审查发现的修复提交为 `a1dae0d fix(admin): address T8 review findings (#69)`。

## 范围与工作区说明

实现提交（5 个，按文件创建顺序，前 4 个均不改 `App.vue`，保证每个 commit 独立通过类型检查与测试）：

```
2ea87d4 feat(admin): extract shell composables and sidebar (#69)
f31b923 refactor(admin): split content panels categories/tags/comments/media (#69)
32f74e2 refactor(admin): split config panels config/about/appearance (#69)
9b11d0e refactor(admin): split operations panels users/friend-links/scrape/analytics (#69)
8e65eb2 refactor(admin): collapse App.vue to shell and sync docs (#69)
```

**共享工作区干扰（如实记录）**：`README.md` 与 `docs/agents/testing.md` 的 #69 段落由并行 T6 #67 会话的 `db0f554` 一起提交（同一份文件无法按来源分离），因此不在 `75c87f8...HEAD` 的实现 diff 内；两轴审查已用 `git show db0f554 -- README.md docs/agents/testing.md` 核对，不按「缺失」判定。修复提交 `a1dae0d` 才把这两份文档的行数与措辞修正纳入 #69 序列。

**用户本次确认的范围调整**（不作为偏差）：一次做完 4 阶段全量 / 沿用仓库惯例 main 直接 commit（不建 PR 分支、不 push）/ 纯逻辑单测 + 现有门禁（不新增 Playwright 脚本）/ T8 先做、T7 #68 清理后置（不碰 `articles/*`、`editor/*`）。

## 验证结果

| 门禁                                    | 结果                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run check`（实现完成时）           | 0 error / 0 warning / 8 hints（144 files）                                                |
| 根包 `npm test`（实现完成时）           | 37 files / 458 tests 全过；修复后 38 files / 467 tests 全过（含并行 T7 新测试）           |
| Worker `npm run typecheck` + `npm test` | 27 files / 285 tests 全过；5 次 commit hook 均复跑通过                                    |
| `npm run build`                         | EXIT=0；CSP 静态与 SSR 两份逐字符一致                                                     |
| 生成物漂移                              | `public/_headers` 与 `src/generated/` 重新生成后无 diff                                   |
| `verify-admin-responsive.mjs`           | PASS；280 / 375 / 1280px，逐个点击 12 个 tab（6 张表格 + 6 个其他面板），等待面板加载完成 |
| `verify-visual-friendliness.mjs`        | PASS；10 组场景 × 812 条断言                                                              |
| `verify-article-ssr.mjs`                | PASS；服务端正文 / 无 JS / motion 兜底 / 404 / 502                                        |

**复核期竞态**：最终复核时并行 T7 #68 会话正在写 `tests/mock-admin-api.test.ts`、`scripts/mock-admin-api.mjs` 等 WIP 文件，`npm run check` 在 0 / 39 / 41 errors 之间波动；过滤该文件后，#69 改动本身 **0 error**。该 WIP 未被本次任何 commit 纳入。

## 拆分前后度量

| 项               | 拆分前                                          | 拆分后                                                            |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `App.vue` 行数   | 3206（票面 5001 行为 T3–T5 拆编辑器前的旧数字） | **226**（≤300 验收达标）                                          |
| 后台首屏 chunk   | `App.0CFMjVT7.js` 113,837 B                     | `App.SP8Znihm.js` 117,975 B（壳层依赖胶水 +4,138 B）              |
| analytics 懒加载 | 无独立 chunk，`analyticsView.ts` 静态打进 App   | `AnalyticsPanel.C5LZ1aSR.js` 12,876 B                             |
| scrape 懒加载    | `scrape.CBAiJISo.js` 54,639 B（仅抓取工具）     | `ScrapePanel.HHE3gfBI.js` 8,552 B + `scrape.CBAiJISo.js` 54,639 B |
| 后台样式         | `admin-shared.css` 1804 行，单源                | 未改动，面板均无 `<style>` 块                                     |
| 改动面           | —                                               | 37 files，+4791 / −3136（实现 5 commit）                          |

两次构建共用同一工作区，期间并行的 T6 #67 也修改了后台代码，chunk 数字含其影响，不能当作纯 #69 的净增量。

## Standards

> 以下为 Standards 子代理原文（按文件 / hunk 报告，区分硬违规与判断题）。

【硬违规·文档化标准】

1. `shared.logic.ts:12` `canEditCategory` 生产零引用，`CategoriesPanel.vue:76-78` 行内重写同一权限判断，`tests/admin-content-panels.test.ts:60-63` 却锁它 → 违反 `docs/agents/testing.md`「共享定义只有一份／不做镜像自证」，锁的是死镜像。并触 `CODING_STANDARDS.md` 契约面同步：`testing.md` #69 段「权限判定、面板逻辑与测试共用同一份实现」与代码不符（db0f554 属描述失真，非未同步）。
2. `README.md:39/416`「223 行」实为 226 → 契约面同步，结构清单／行为行失真。
3. `testing.md` #69 段把「模板/请求形状等价」托给 `verify-admin-responsive`／`verify-visual-friendliness`；`deploy.yml:104/108` 二者按同文档只测响应式／观感，不覆盖模板与请求 → 关联文档与代码不一致。

【判断题·baseline smell，均非违规】4. **Feature Envy／分层倒置**：`useAdminCatalog.ts:2` 壳层反向 import `panels/comments.logic`，而 `CommentsPanel` 自身不消费它；宜上移共享层。5. **Duplicated Code＋Data Clumps**：`categories/friend-links/users.logic.ts` 的 `editingId→PUT/POST` 分叉与 `{method,path,body}` 三字段成组重复。6. 抑制／排除：`useFeedback.ts` 薄封装是 **Middle Man** 候选，但头注释为已文档化注入接缝，按「文档化标准优先」抑制；`adminContext.ts` 经查 11 面板真实消费、`createAdminContext` 含装配逻辑，非 **Speculative Generality／Middle Man**。7. `App.vue` `handleLogin` 的 `catch (e)` 未用属 lint 类，按「工具已强制规则跳过」，不列 smell。

## Spec

> 以下为 Spec 子代理原文。

Spec 轴审查（75c87f8...HEAD，5 commit）

(a) 缺失/只做一部分

1. 验收「#42 L3 关闭证据（与 #60 一起）」属关票留言，本次未关票/未发 issue 留言 → **pending**（非实现缺失）。
2. 测试「构建：记录拆分前后 `App.vue` 行数、后台首屏 chunk 与 `scrape` / `analytics` 懒加载 chunk」：README（db0f554）仅记 223/3206 行，两类 chunk 实测值无留痕（仅定性「不进首屏」、build EXIT=0）→ 部分。

(b) 规格外行为
「目标结构」`composables/` 仅列 `useSession`/`useAdminApi`/`useFeedback`，diff 另增 `adminContext`/`useAdminCatalog`/`useAdminEditor`（后者重编排编辑器 21 个事件、文章删除、抓取转文章）；`panels/` 仅列 11 个 `.vue`，另增 12 个 `*.logic.ts`——超出票面结构树（为壳层收口/纯逻辑单测所需）。另 8e65eb2 称「sync docs」却未含 docs 文件（#69 文档实在 db0f554）。

(c) 可能不对

1. 约束「每阶段独立 PR，先壳层再领域面板」及阶段 1「`App.vue` 只留 tab 定义与编排」：前 4 commit 仅新增文件，`App.vue` 仍 3282 行、模板未引用新面板，末次 8e65eb2 才一次性 collapse，中间态为死代码，非独立渐进迁移（main 直 commit 已确认，不判 PR 偏差）。
2. 约束「若编辑器打开，先同步落盘（或按用户清理）、释放锁，再关闭编辑器」：logout 为 `disposeEditor()`→`clearDrafts()`，顺序与字面相反、主动登出无落盘（仅 10003 走 `sessionExpired`）；与 75c87f8 逐行等价、行为等价达标，风险低。

8 项验收/约束：①–⑦核验通过（App.vue 226 行、无领域模板/请求/大段样式；12 tab、权限 computed、登录重置 tab、data-locale、加载时机、错误码同旧版；about 保 textarea+预览无 WYSIWYG、scrape/analytics `defineAsyncComponent`+面板内 `await import`；登出清草稿等价且 12 个 `logic.ts` 全被 5 个测试引用；无 Worker/API/D1/设置规则/生成物改动；README 结构树与后台说明、testing.md #69 段经 db0f554 核对齐备），⑧ pending。

## 发现处置

| #         | 轴               | 结论                                  | 处置                                                                                                                                                                                      | 提交      |
| --------- | ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| S-1       | Standards 硬违规 | `canEditCategory` 为死镜像            | 已修：`CategoriesPanel.vue` 的 `v-if` 改为调用 `canEditCategory(userRole, c.created_by, currentUserId)`，生产与测试共用同一实现                                                           | `a1dae0d` |
| S-2       | Standards 硬违规 | README 行数失真                       | 已修：两处 223 → 226，并补「拆分度量」子项                                                                                                                                                | `a1dae0d` |
| S-3       | Standards 硬违规 | testing.md 把门禁说成覆盖模板 / 请求  | 已修：改写为「逐字搬移 + check/test 静态与纯逻辑锁保证」，明确三条 Playwright 门禁各自测什么、不测什么，手工清单另列                                                                      | `a1dae0d` |
| S-4       | Standards 判断题 | 壳层反向依赖 `panels/*`               | 已修：`commentsPath` 上移到 `useAdminCatalog.ts` 导出并由数据层唯一持有，删除 `panels/comments.logic.ts`，测试改从 composable import                                                      | `a1dae0d` |
| S-5       | Standards 判断题 | 三个 logic 的 upsert 分叉重复         | **接受**：category / user / friend-link 的 payload 形状与分支条件不同，抽公共 `buildUpsertRequest` 会引入跨面板耦合且收益低；票面以行为等价优先。记为后续优化候选                         | 无        |
| S-6 / S-7 | Standards        | 抑制 / 排除                           | 按文档化标准优先与「工具已强制跳过」处理，无需动作                                                                                                                                        | 无        |
| P-1       | Spec (a)         | chunk 度量无留痕                      | 已修：README 补度量子项，本报告「拆分前后度量」表给出完整数值与口径限制                                                                                                                   | `a1dae0d` |
| P-2       | Spec (a)         | #42 L3 关闭证据                       | **pending**：关票 / 发 issue 留言属外部写操作，本次未获授权，见「未闭环」                                                                                                                 | 无        |
| P-3       | Spec (b)         | 结构树多 3 个 composable + logic 模块 | **接受**：`App.vue` ≤300 行必须把共享状态、编辑器桥接与依赖聚合移出壳层；`*.logic.ts` 是用户确认的纯逻辑测试 seam。已在 README 结构树列明                                                 | 无        |
| P-4       | Spec (c)-1       | 中间 commit 未渐进接线                | **接受**：为保证每个 commit 独立通过 `npm run check` / `npm test`，刻意先落新文件、最后一次性收口；用户已确认 main 直 commit，不建 PR                                                     | 无        |
| P-5       | Spec (c)-2       | logout 顺序与票面字面相反             | **接受**：与固定点逐行等价，主动登出的编辑器关闭与锁释放由 T3 #64 的 `dispose()` 内部保证，`10003` 走 `sessionExpired()` 落盘；票面要求行为等价，本次不改既有语义。若需严格字面顺序另开票 | 无        |

## 未闭环

1. **#42 L3 关闭证据（与 #60 一起）**：需要在 #42 / #69 发关票留言并关票，属外部写操作，本次未执行，待老大授权后按 `docs/agents/issue-tracker.md` 的关票流程办理（先发证据长文，再 `gh issue close`）。
2. **票面手工清单**：刷新后会话恢复、alert / confirm、token 失效、暗色主题、退出登录清草稿未做人工点检，自动化门禁不覆盖。
3. **12 tab 冒烟**：由现有 `verify-admin-responsive.mjs` 的 12 tab 逐个点击 + 等待加载间接覆盖，未新增专用 Playwright 脚本（按用户选择「纯逻辑单测 + 现有门禁」）；刷新恢复与主要操作冒烟仍待人工。
4. **T7 #68 合流**：票面约定「T7 开始清理 App.vue 前先与 T8 合流，或把 T7 的清理放到 T8 之后」。本次 T8 已落地且未碰 `articles/*`、`editor/*`；T7 收尾时应注明依赖 T8，并删除 `App.vue` 内不再使用的编辑器遗留代码与 i18n key。

Standards 轴共 7 条发现（3 硬违规 / 2 判断题 / 2 抑制或排除），最严重为 `canEditCategory` 测试锁死镜像，已在 `a1dae0d` 修为真实消费；Spec 轴共 5 条发现（2 缺失或部分 / 1 范围外 / 2 可能不对），最严重为拆分前后 chunk 度量无留痕，已在 `a1dae0d` 补入 README 与本报告，#42 L3 关票证据仍 pending。
