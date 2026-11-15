# 代码审查：#67 编辑器 T6（元信息面板、响应式与可访问性）

- 日期：2026-11-15
- 固定点：`8b0099c`（`git rev-parse` 确认可解析）
- 审查对象：`git diff 8b0099c...HEAD`（三点，对 merge-base）
- 提交：`git log 8b0099c..HEAD --oneline` → `349525a feat(editor): add metadata panel, responsive drawer and a11y (#67)`
- Spec 来源：GitHub issue #67（`[编辑器 T6] 元信息面板、响应式与可访问性`）
- Standards 来源：`CODING_STANDARDS.md`、`AGENTS.md`、`README.md`、`GLOSSARY.md`、`docs/agents/testing.md`、`docs/agents/windows-shell.md`，外加 Fowler《Refactoring》ch.3 smell baseline

两个轴由并行子代理独立产出，以下按 `/code-review` 约定分开呈现，不合并、不重排。

## Standards

**Standards 轴 · `349525a`（17 文件，只读）**

**硬性违规**（所引文档要求未标 judgement call）

- `scripts/verify-editor-responsive.mjs @@-0,0+1,458`、`verify-visual-friendliness.mjs @@-18/-124/-764`：违反 `docs/agents/testing.md`「同一行为不要两边重复测」「共享定义只有一份…放同一 fixture 模块」。两脚本各写一份 `VIEWPORTS`/`fixtureFor`/`ok`/入口选择器/溢出判定；`checkFocusTrap`·`checkCoverPreview`·`checkPublishGate` 复测了 `tests/editor-{focus-trap,meta-fields}.test.ts` 已钉住的纯函数。

**判断性意见**（`CODING_STANDARDS.md`「契约面同步」自标 judgement call）

- README `src/utils/editor/` 清单(125-132)漏 `focusTrap.ts`/`metaFields.ts`；README:427 与 `docs/agents/testing.md` 测试清单漏两新测；README:414「T4/T5」、398-405 行为段未记 T6 发布前校验/抽屉/aria-live/焦点陷阱。

**判断性意见**（baseline，皆 possible 启发式，永非硬性）

- possible **Duplicated Code**：`EditorMetaFields.vue @@-22/+40` 手写 `{slug:"",locked:false}` 取 `.locked`，与 `metaFields.ts` 的 `reset` 形状重复。
- possible **Primitive Obsession**：`metaFields.ts checkPublishReady` 用 `status!=="published"` 字符串判态。
- possible **Divergent Change**：`ArticleEditorOverlay.vue @@-1/+1` 因抽屉/保存校验/a11y 三类原因同改。
- possible **Mysterious Name**：`verify-editor-responsive.mjs` 的 `ok`/`emptyList` 看不出是 API 响应包装。

工具/格式/类型已强制项跳过。

## Spec

已按 `git diff 8b0099c...HEAD` 读完完整 diff（2695 行，单 commit `349525a`），并对照服务端/T1 既有实现复核。

**(a) 缺失 / 只做一半**

1. 「Slug 冲突由服务端返回错误，原样展示提示」：仅注释声明不改写（`metaFields.ts:73`、`EditorMetaFields.vue:10`），无冲突展示代码或用例；"原样展示"仍靠既有通用 `.editor-error`（`ArticleEditorOverlay.vue:344`）。
2. 「工具栏横向滚动或换行，不挤压正文」：新增 CSS 只把 `.toolbar-btn` 列入 44px 规则（`admin-shared.css:1928`），换行沿用既有 `flex-wrap`（`:717`），回归脚本未单测工具栏（`verify-editor-responsive.mjs` 的 `checkNoHorizontalScroll` 只测四个容器）。

**(b) scope creep**

3. 「弹窗 role="dialog" / aria-modal="true"」：全屏壳也加了 `role="dialog"`（`ArticleEditorOverlay.vue:182`）却无 `aria-modal`、不接焦点陷阱，与文件头"四个 .modal 弹窗才是模态"注释矛盾。
4. 「保存状态、上传状态、锁丢失使用 aria-live="polite"」：顺带把 load-error / editor-error 由 `role="alert"` 降为 `status`（`:216`、`:344`），spec 未要求改既有错误播报紧急度。
5. 「新文案随本票写入 zh.json / en.json」：`admin.meta_drawer`、`admin.meta_lock_lost_status`（`zh.json:359`、`367`）在 src 零引用，锁丢失仍用既有 `admin.lock_lost_message`。

**(c) 疑似实现不对**

6. 「标题：必填、maxlength=200」：`required` 在无 `<form>` 的 input 上不生效（`EditorMetaFields.vue:139`）；`checkPublishReady` 仅 published 校验（`metaFields.ts:29`），草稿空标题即放行，而服务端 validate 恒要求 title minLength 1（`worker/src/handlers/article.ts:193`）必拒。
7. 「关闭后焦点归还触发按钮」：trap 只记打开瞬间 `document.activeElement`（`focusTrap.ts:63`），lock-conflict 由 phase 自动弹出（`ArticleEditorOverlay.vue:81`）并无触发按钮；回归脚本仅验证 LinkDialog 的归还。

（slug 生成、阅读时长、封面白名单经复核确实复用了 T1/服务端同口径，未列入。）

## 汇总

- **Standards**：1 项硬性违规 + 1 项文档同步判断 + 4 条 baseline smell（均为判断性）。最严重：两份 Playwright 脚本各自复制 fixture / 视口定义，违反 `docs/agents/testing.md`「共享定义只有一份」。
- **Spec**：7 条（缺失 2 / scope creep 3 / 疑似实现不对 2）。最严重：草稿态空标题被前端放行、但服务端 `validate` 恒要求 `title` 非空，作者会遇到一次无谓的保存失败。

## 处置

> 修复以 follow-up commit `db0f554` 落地，`349525a` 的哈希因此保持有效。按 finding 逐条记录。

### Standards

- **S1（硬性，两脚本各写一份 fixture / 选择器 / 视口）→ 已修**：新增 `scripts/editor-meta-fixture.mjs`，单源导出 `ok` / `emptyList` / `EDITOR_ENTRY_SELECTOR` / `EDITOR_VIEWPORTS` / `fixtureFor`；`verify-visual-friendliness.mjs` 删去本地 `ok` / `fixtureFor` / `EDITOR_VIEWPORTS`，`verify-editor-responsive.mjs` 删去本地四份定义并改为 import。`db0f554`。
  - 报告同时指出的「浏览器复测纯函数」判定为**接线断言而非重复测**：`checkFocusTrap` 验的是 Vue 组件是否真的挂了 trap、`checkCoverPreview` 验的是 `<img>` 的 `@error` 是否触发、`checkPublishGate` 验的是三个保存入口是否都汇到 `requestSave()`。按 `docs/agents/testing.md`「浏览器回归只锁只有在完整页面里才能确认的行为」保留；纯函数期望值仍只由 vitest 手写字面量钉住。
- **S2（README / testing.md 契约面未同步）→ 已修**：README 的 `src/utils/editor/` 清单补 `focusTrap.ts` / `metaFields.ts`，后台管理段补 T6 元信息 / 响应式 / 可访问性行为，`#### 文章编辑器` 标题补 T6，测试 bullet 补两份新测与两条脚本；`docs/agents/testing.md` 补 T6 段落并更新观感脚本 `TARGETS` 说明。`db0f554`。
- **S3（4 条 baseline smell，判断性）→ 保留，逐条理由**：
  - possible Duplicated Code（`{slug:"",locked:false}`）：组件只取 `.locked`，slug 值的事实源始终是 `form`；为一次调用再抽工厂反而是 Speculative Generality。
  - possible Primitive Obsession（`status!=="published"`）：状态字符串来自服务端 `ArticleEditDetail` 投影，本票不为两种取值引入枚举。
  - possible Divergent Change（`ArticleEditorOverlay.vue`）：票面把抽屉 / 保存校验 / a11y 三项都指定在同一壳层，拆分属跨票重构。
  - possible Mysterious Name（`ok` / `emptyList`）：`db0f554` 后由共享 fixture 模块导出并加注释，模块上下文已明确。

### Spec

- **P1（slug 冲突无用例）→ 已修**：`verify-editor-responsive.mjs` 新增 `checkSlugConflict`，POST 返回 `code:10005` + 业务 message，断言 `.editor-error` 原样展示该 message 且 `#meta-slug` 未被改写或追加后缀。`db0f554`。
- **P2（工具栏换行未单测）→ 已修**：`checkNoHorizontalScroll` 增加 `.editor-toolbar` 的 `flex-wrap` 与自身横向溢出断言。`db0f554`。
- **P3（全屏壳 role=dialog 与注释矛盾）→ 已修**：移除 `role="dialog"` / `aria-label`，注释明确「全屏壳是非模态工作区，四个 `.modal` 弹窗才是模态」。`db0f554`。
- **P4（既有错误播报紧急度被降级）→ 已修**：`load-error` / `editor-error` 恢复 `role="alert"`；「保存状态」的 polite 播报由 footer 新增 live region 承担，「锁丢失」按票面保留 `role="status" aria-live="polite"`。`db0f554`。
- **P5（两个零引用词条）→ 已修**：删除 `admin.meta_drawer`（zh/en 同步），`admin.meta_lock_lost_status` 接到锁丢失面板的 sr-only 播报；zh/en 各 365 key、双向对齐。`db0f554`。
- **P6（required 死属性 / 草稿空标题与服务端张力）→ 部分修 + 如实保留**：无 `<form>` 时 `required` 不生效，改为 `aria-required="true"`（`db0f554`）。「草稿空标题放行」按票面「发布前检查标题、正文」的措辞保留，`metaFields.ts` 注释已明确记录与 Worker `validate()` 恒要求 `title` / `content` minLength 1 的张力：草稿保存仍会被服务端拒绝，错误由既有 `save-failed` 链路原样展示。**统一这两处口径需要改票面语义，留作后续票候选，不在本票擅自收紧。**
- **P7（自动弹出的锁冲突无触发按钮 / 回归只测 LinkDialog）→ 如实保留为已知限制**：`focusTrap.deactivate()` 已有 `isConnected` 兜底，触发按钮离开文档不会抛错；锁冲突由 phase 自动弹出，没有真实触发按钮，焦点归还退化为无操作。为其指定归还目标需要宿主级 ref 与冲突场景 fixture，属跨票改造，记录为后续候选。

### 门禁结果（修复后复跑）

| 检查                                                    | 结果                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `npm run check`                                         | 0 errors / 0 warnings（144 files，8 hints 均为既有）   |
| `npx vitest run --exclude tests/analytics-view.test.ts` | 36 files / 440 tests PASS                              |
| worker `npm test`                                       | 27 files / 285 tests PASS                              |
| `npm run build`                                         | PASS（CSP 静态与 SSR 逐字符一致）                      |
| `verify-visual-friendliness.mjs`                        | 10 场景 × 812 条断言 PASS（280/375/1280 × light/dark） |
| `verify-editor-responsive.mjs`                          | 24 组断言 PASS（新增工具栏与 slug 冲突两项）           |
| `verify-admin-responsive.mjs`                           | PASS（280 / 375 / 1280）                               |
| 设置白名单 / 安全头生成物 drift                         | 无漂移                                                 |

**外部并发影响（非本票，且未纳入任何提交）**：21:50 起工作区存在另一路重构，把 `src/admin/App.vue` 从 3279 行重写为 148 行（面板拆到 `src/admin/panels/`，并改动 `tests/analytics-view.test.ts`）。由此 ① `tests/analytics-view.test.ts` 中「读 App.vue 找 `t("analytics.*")`」的一条断言变红（该模板已迁至 `panels/AnalyticsPanel.vue`）；② `scripts/verify-article-editor.mjs` 的「切源码模式」假设失效。两者在 21:35 的**原始 App.vue + 本票改动**下均 PASS（本票全量 417/417 + T5 回归 PASS）。这些路径（`App.vue`、`analytics-view.test.ts` 及所有未跟踪 WIP）未被本票 `git add` 过，也不在 `349525a` / `db0f554` 的 diff 中。

### 提交

- `349525a` — 主实现（17 files，+2160/−62）
- `db0f554` — 本报告的 follow-up 修复（10 files，+187/−135）
- 本报告归档提交 — 见 issue #67 关票留言
