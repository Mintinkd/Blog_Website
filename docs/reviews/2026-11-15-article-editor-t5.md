# 文章编辑器 T5 代码审查报告（issue #66）

2026-11-15。固定点 `bb9e232`，审查对象 `19e7ca4 feat(editor): add image upload and local draft recovery (#66)`；审查发现的修复提交为 `160f446 fix(editor): address T5 review findings (#66)`。

说明：**Standards** 轴由子代理完成并原文收录；**Spec** 轴的首轮与重试子代理均触发免费额度上限，改由主代理按同一模板直接审查，结论与证据同等对待，不因执行方式缩减范围。

## Standards

# Standards axis — `bb9e232...HEAD`

## Hard violations (documented contract now false)

**`README.md` — structure + behaviour contract not synced** (`CODING_STANDARDS.md` §契约面同步: 接口表 / 结构清单 / 行为行 must change with behaviour; `AGENTS.md` makes README the source of truth).

- `README.md:56` still reads `upload.ts # POST /media/upload 适配（src / alt）`; the adapter moved to `src/utils/editor/uploadImage.ts`, which is absent from the `src/utils/editor/` list (~L124–130).
- `src/admin/editor/` list (~L44–57) lacks `DraftRecoveryBar.vue` and `useLocalDraft.ts`.
- `README.md:424` still says 「浏览器回归…真实拖拽上传由 T5 / T7 收口」— T5 is this commit.
- No README line documents the new toolbar upload, precheck, recovery bar, or 1.5 s debounce; L402/L419 still describe only `10003` persistence and uploader override.

**`ArticleEditorOverlay.vue:44` comment contradicts shipped code**

```
/** Bearer token 由宿主注入；上传走同一个入口，不在组件里读 localStorage。 */
```

25 lines downstream, `MarkdownWorkspace.vue:259` does exactly that:

```ts
function resolveToken(): string {
  if (props.getToken) return props.getToken();
  try {
    return localStorage.getItem("admin_token") ?? "";
  } catch {
    return "";
  }
}
```

Adjacent-comment rule (same standard, bullet 1) — behaviour and its own comment disagree.

## Judgement calls

- **Duplicated Code** — `resolveToken` is a copy of `createEditor.ts:78 defaultToken` (identical body), giving a second token source. `getToken?` is optional only here; every call site passes it, so the fallback is unreachable in production.
- **Duplicated Code** — `save()` validates `typeof res.data?.id === "number" && Number.isFinite(...) && > 0`; `editorState.ts` `save-ok` re-runs the identical predicate.
- **Speculative Generality** — `draftStore.ts:223 loadDraft` kept 「兼容旧调用」, but grep shows **zero** production callers (tests only); `loadDraftWithStatus` suffices.
- **Middle Man** — `milkdown/upload.ts` is now a 10-symbol re-export; `createEditor` needs two, and `tests/editor-upload.test.ts` imports the real module, falsifying its header 「避免 createEditor 与测试各引一份实现」.
- **Speculative Generality** — `useArticleEditor()` composable (`useArticleEditor.ts:800`) has no callers; App.vue hand-rolls the same four-`shallowRef`+`subscribe` wiring, so the new `draft` channel is maintained twice.
- **Primitive Obsession / divergent state write** — `userId: number | (() => number)` union for init order (a getter like `getToken` would do); `open()` sets `draftPrompt = null` directly, bypassing `setDraftPrompt()`'s notify.
- **`docs/ADR 0006:26`** claims `verify-article-editor.mjs` is 「纳入 CI 部署门禁」; `deploy.yml` doesn't run it — testing.md admits T7 pending.
- **`docs/ARTICLE_EDITOR_UPGRADE.md:427`** ticks 「拖拽可用」 on synthetic `DragEvent` evidence, while the same file notes real drag was never reproduced.
- **`docs/agents/testing.md` checklist** — `scripts/verify-article-editor.mjs` shares one context/viewport across five scenarios (checklist wants per-scenario context), re-pins Bearer/multipart already locked by `editor-upload.test.ts` (「同一行为不要两边重复测」), and `fixtureFor()` silently returns an empty list for unknown paths.

## Spec

**Partial — `image-block` 的 `onUpload` 没有按字面接入**

> WYSIWYG `image-block` 的 `onUpload` + 粘贴 / 拖拽统一走适配器

实现刻意不装配 `image-block`（7.23.0 会把 `alt` 当宽高比，T0 已证 `image` / `mixed-document` 两条语料 lossy），改由 `uploadConfig.uploader` 承接粘贴 / 拖拽，工具栏另走 `uploadImageFile`。功能上确实统一到同一适配器，但票面点名的 `onUpload` 不存在；偏差已写入 `docs/ARTICLE_EDITOR_UPGRADE.md` §8.4 与 ADR 0006。→ 接受该偏差，补 README 行为行。

**Partial — 真实拖拽没有证据，文档却勾选「拖拽可用」**

> 上传 / 粘贴 / 拖拽可用，失败不破坏正文
> Playwright：…拖拽…（本票先加脚本骨架）

`scripts/verify-article-editor.mjs` 用合成 `DragEvent` 触发 Crepe uploader；同名文档 §8.4 明确写「拖拽真实用户操作仍未复现」，§12 验收却勾了「拖拽可用」。→ 取消勾选，改为「粘贴可用；真实拖拽待 T7」，与 §8.4 一致。

**Partial —「上传中禁用重复提交」只覆盖工具栏**

> 上传中禁用重复提交

`MarkdownWorkspace` 的上传按钮与 file input 在 `uploading` 时 disabled；WYSIWYG 粘贴 / 拖拽直接进 `@milkdown/plugin-upload`，该插件没有 in-flight 去重，连续粘贴 / 拖拽会并发 POST。→ 记为已知边界（单文件选择器防重复点击；粘贴 / 拖拽多文件是用户显式动作），T7 若需要再串行化。

**Evidence gap — 退出登录清理没有页面级回归**

> 保存 / 放弃 / 退出登录时清理
> 退出登录清理

`handleLogout` 调用 `clearUserDrafts`，`clearUserDrafts` 有单测；Playwright 骨架不覆盖退出登录。→ 实现与单测足够，页面级留 T7。

**Pass — 其余条款**

- 适配器预检 / Bearer + FormData / `{ url, original_name }` → `{ url, alt }`；10MB 边界、服务端白名单、失败保留正文；无 base64、无图片代理或转存。
- 源码模式复用 T1 `insertImage` 的 Markdown 转义并选中 alt；`uploadImageAtSelection` 失败时原样返回正文与选区。
- 草稿键 `v1/u{id}/a{id|new}`，白名单投影不含 token；1.5s 防抖 + `pagehide` 同步；恢复条不自动覆盖；保存 / 放弃 / 退出登录清理；>1MB 单次提示；7 天过期；恢复后重跑 T4 守卫、lossy 进源码；新建保存后清 `new` 键。
- i18n 中英键齐全；`tests/editor-upload.test.ts` 与 `editor-draft.test.ts` 扩展符合票面；Playwright 骨架覆盖上传 mock、粘贴、合成拖拽、刷新恢复、丢弃、保存清理。

## 处置

| 轴        | 发现                                                           | 处置                                                                                                                                                                                  | 提交      |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Standards | README 结构 / 行为契约未同步                                   | 已修：结构树改指 `uploadImage.ts`，补 `DraftRecoveryBar.vue` / `useLocalDraft.ts`，新增上传与草稿行为行，测试行去掉「T5 收口」                                                        | `160f446` |
| Standards | Overlay 注释与 `MarkdownWorkspace` 读 localStorage 矛盾        | 已修：`getToken` 改为必填，删除 localStorage 兜底，注释改为「所有上传入口只调用宿主注入的 token」                                                                                     | `160f446` |
| Standards | `resolveToken` / `defaultToken` 重复                           | 已修：删除 `resolveToken`；`createEditor` 的 `defaultToken` 仅保留给独立调用 / 测试，宿主路径必经注入                                                                                 | `160f446` |
| Standards | 保存 id 校验重复                                               | 已修：抽出 `normalizeArticleId`，`save()` 与 `save-ok` 共用                                                                                                                           | `160f446` |
| Standards | `milkdown/upload.ts` 转发层（Middle Man）                      | 已修：删除转发文件，`createEditor` 直接 import `utils/editor/uploadImage`                                                                                                             | `160f446` |
| Standards | `useArticleEditor()` 无调用、草稿通道维护两份                  | 已修：App.vue 改用 `useArticleEditor()`，删除手写四个 `shallowRef` + `subscribe` 与重复 attach / dispose                                                                              | `160f446` |
| Standards | `open()` 绕过 `setDraftPrompt()`                               | 已修：改走 `setDraftPrompt(null)`                                                                                                                                                     | `160f446` |
| Standards | `draftStore.loadDraft` 无生产调用                              | 保留：T1 公共读取助手，T3 / T5 测试均用它做断言；删除会迫使十餘处测试改写成 `loadDraftWithStatus`，收益低于 API 稳定性成本                                                            | —         |
| Standards | `userId: number \| (() => number)` 原始类型执念                | 保留：首屏未登录时必须是 getter，已登录调用可传值；与 `getToken` 同构，暂无第三种来源，拆类型属过度设计                                                                               | —         |
| Standards | ADR 0006 声称脚本已进 CI                                       | 已修：改为「脚本骨架已入库；CI 接线由 T7 #68 承接」                                                                                                                                   | `160f446` |
| Standards | 方案文档勾选「拖拽可用」但无真实拖拽证据                       | 已修：改为「粘贴可用；真实拖拽待 T7 复核」，与 §8.4 一致                                                                                                                              | `160f446` |
| Standards | 回归脚本共用 context / 重复锁 Bearer / `fixtureFor` 静默空列表 | 部分处置：补测试文档说明「当前为骨架、T7 按场景拆 context」；`fixtureFor` 是后台多接口 catch-all，保留并在注释说明；Bearer / multipart 属浏览器真实请求接线，与适配器单测不是同一接缝 | `160f446` |
| Spec      | `image-block` `onUpload` 与票面字面不符                        | 接受偏差：T0 / T4 已证 `image-block` 会改写存量正文；统一适配器目标由 `uploadConfig.uploader` 达成，文档已记录                                                                        | —         |
| Spec      | 真实拖拽证据缺失                                               | 文档已修正；合成拖拽保留在骨架，真实拖拽由 T7 复核                                                                                                                                    | `160f446` |
| Spec      | 上传中重复提交只覆盖工具栏                                     | 记为已知边界：按钮 / input 已禁用；粘贴 / 拖拽多文件是显式动作，T7 视需要串行化                                                                                                       | —         |
| Spec      | 退出登录清理无页面级回归                                       | 保留：`clearUserDrafts` 有单测，页面级回归并入 T7                                                                                                                                     | —         |
