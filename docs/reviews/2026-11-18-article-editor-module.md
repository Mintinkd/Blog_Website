# 文章编辑器模块代码审查（2026-11-18）

## 审查范围与基线

- 基线：`HEAD = origin/main = 84f543a`，工作区干净，`git diff origin/main...HEAD` 为空。
- 按任务约定：相对 origin/main 没有文章编辑器改动，因此本次审查编辑器模块自身实现。
- 覆盖：`src/admin/editor/**`、`src/admin/articles/ArticleEditorOverlay.vue`、`src/admin/composables/useAdminEditor.ts`、`src/utils/editor/**`、`src/admin/admin-shared.css` 中编辑器段落，以及编辑器直接调用的 `GET /articles/:id/edit`、`POST/PUT /articles`、`POST/DELETE /articles/:id/edit-lock`、`POST /media/upload` 的 Worker 实现。
- 对照：`CODING_STANDARDS.md`、`docs/ADMIN_AND_VISUAL.md`（编辑器契约）、`AGENTS.md`、既有 vitest 用例与 `scripts/verify-article-editor.mjs` / `verify-editor-responsive.mjs`。

## 结论

整体设计是扎实的：状态机、编辑锁、本地草稿、回写守卫各自有纯函数层和测试，安全侧（DOMPurify 预览、embed 链接 `safeHref`、草稿不落 token、上传魔数校验）没有发现可利用问题。但存在 **2 个应先修的正确性缺陷（P1）** 和 **一组会造成编辑内容丢失/状态漂移的 P2**。

**判断：不建议把这批编辑器代码当作可继续叠加功能的稳定基线直接放行；先修 P1，再合后续编辑器改动。** 没有 P0，不阻断站点线上运行。

## 问题清单

### P1-1 编辑锁获取失败后重试加载，会在「未持锁」状态下允许保存

- 位置：[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L468-L475)（锁失败分支）、[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L483-L487)（`retryLoad`）、[useEditLock.ts](../../src/admin/editor/useEditLock.ts#L141-L147)（`verify`）。
- 现象：`open()` 在锁请求返回 error（网络抖动、`10008`、`10005` 等）时，先 `dispatch({ type: "lock-acquired" })` 把 `lockHeld` 置真，再 `load-failed`；`retryLoad()` 只重试详情加载，不重新抢锁。详情加载成功进入 `ready` 后 `lockHeld` 仍为真，但 `EditLock.articleId` 是 `null`（成功才赋值），`verify()` 对 `articleId === null` 直接返回 `{ kind: "ok" }`，于是 `PUT /articles/:id` 照常发出，心跳也从未启动。
- 为什么是问题：这是 fail-open 的互斥失效——用户以为在正常编辑，实际没有服务端锁，另一个编辑者可以同时保存并互相覆盖；而正常路径的所有「锁丢失禁止保存」保护都不会触发。
- 影响：丢失更新（last-write-wins），且在网络抖动场景下可复现。现有 `tests/article-editor-flow.test.ts` 的 `setup()` 对 `/edit-lock` 恒返回 ok，只覆盖了「详情加载失败后重试」，没有覆盖「锁失败后重试」，所以测试是绿的。
- 建议：锁失败时不要把状态推进到可保存；`retryLoad()` 在 `currentArticle` 非空且 `!lock.held` 时先重新 `acquire`，失败则继续停在 `load-error`；或给 reducer 增加显式的 `lock-failed` 事件，避免用 `lock-acquired` 冒充。

### P1-2 表单更新是「渲染期全量快照」，异步产生的更新会互相覆盖

- 位置：[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L124-L132)（`onForm` / `onContent` 用 `{ ...props.state.form }`）、[EditorMetaFields.vue](../../src/admin/editor/EditorMetaFields.vue#L131-L133)（`patch` 同样展开 `props.form`）、[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L513-L516)（`updateForm` 整体替换 form）。
- 现象：`markdownUpdated` 是异步批合并的，正文更新、元信息字段更新、链接弹窗插入、上传完成回写都以「最后一次渲染时的 form 快照」为准；两个来源在同一渲染周期内先后 emit 时，后一个会把前一个的字段覆盖回旧值。
- 为什么是问题：这不是理论竞态，仓库自己的 CI 脚本已把它写成注释并靠「把键盘输入放最后」绕过：[verify-article-editor.mjs](../../scripts/verify-article-editor.mjs#L507-L513)（“Milkdown 的 markdownUpdated 是异步批合并，后续再开弹窗 / 上传会用旧表单快照覆盖 onChange”）。
- 影响：用户在 WYSIWYG 里刚输入的文字，若紧接着改标题 / 开关元信息 / 插入链接 / 等上传完成，可能被静默回退；草稿随后也会按回退后的内容落盘，属于内容丢失。
- 建议：把 `updateForm` 改成「补丁」语义（`Partial<EditorFormSnapshot>`），在 `createArticleEditor` 内基于当前 `state.form` 合并；`EditorMetaFields.patch` 只 emit 变更字段，`onContent` 只 emit `{ content }`。这样异步事件不会携带过期快照。

### P2-1 WYSIWYG 下插入「内嵌网页预览」链接总被追加到正文末尾

- 位置：[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L148-L154)（`selection()` 在没有 textarea 时回退到 `props.content.length`）、[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L249-L268)（embed 走 `insertSnippet(props.content, selection(), snippet)`）。
- 现象：WYSIWYG 模式没有 textarea，`selection()` 返回文档末尾；embed 片段因此总被拼到最后，而不是光标/选区处（普通链接走 `insertMarkdown` 是正确的）。
- 为什么是问题：编辑器工具栏的第一个按钮就是「插入链接」，两种模式并列；作者在 WYSIWYG 正文中部插入内嵌预览时，链接会跑到文末，且原选区文字不会被替换。
- 影响：主要插入工作流位置错误，用户需要手动剪切粘贴；批量插入时顺序也会乱。
- 建议：为 embed 提供基于 ProseMirror selection 的插入路径，或在 `setMarkdown` 前用编辑器当前选区计算偏移；至少不要静默使用「文档末尾」。

### P2-2 源码模式上传图片期间继续输入，会被上传完成时的旧快照覆盖

- 位置：[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L279-L315)（`uploadImageAtSelection(props.content, snapshot, …)` 在 await 前取快照，完成后 `emit("update:content", result.content)`）。
- 现象：`uploading` 只禁用上传按钮和文件输入，不禁用 textarea；上传耗时期间用户继续写的内容，会随 `result.content`（基于旧正文）整体被覆盖。
- 为什么是问题：注释明确写了「上传中不锁正文，作者可以继续写」，但实现没有合并机制，属于承诺与行为不一致。
- 影响：多秒上传窗口内的输入丢失，随后草稿也会同步成旧内容。
- 建议：上传完成时若 `props.content !== 上传前正文`，按原选区做增量插入（或在偏移失效时追加并提示），否则再走整篇回写。

### P2-3 初次回写守卫异步完成会覆盖用户刚切换的编辑模式

- 位置：[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L400-L442)（`loaded` 后 `await runInitialGuard()`）、[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L351-L398)。
- 现象：`loaded` 先进入 `ready`，守卫（headless Milkdown 往返）随后才 `guard = { mode: decideInitialMode(...) }`。用户在守卫返回前点击「源码」会被覆盖回 WYSIWYG（安全语料）或反之。
- 为什么是问题：模式选择被静默回退；CI 已经为此写了「循环点击 + 双次确认」的规避代码：[verify-article-editor.mjs](../../scripts/verify-article-editor.mjs#L296-L319)。
- 影响：打开编辑器后立刻切模式的用户会看到编辑面跳回；lossy 文章还会先挂载一次 WYSIWYG 再卸载。
- 建议：把守卫判定放到 `ready` 之前（或 UI 在 `guard.status === "unchecked"` 时暂不渲染编辑面），并记录「用户显式选择过模式」，守卫结果不得覆盖显式选择。

### P2-4 显式覆盖 lossy 后，按钮高亮与真实编辑形态不一致

- 位置：[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L83-L89)（只监听 `guard.mode -> "source"` 单向同步本地 `mode`）、[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L326-L359)（高亮读 `props.mode`，渲染读 `guard.mode`）。
- 现象：lossy 文章打开后 `mode` 被同步为 `source`；点「仍然使用所见即所得」后 `guard.mode` 变回 `wysiwyg`，编辑面切到 WYSIWYG，但本地 `mode` 仍是 `source`，于是「源码」按钮保持高亮、「所见即所得」不高亮。
- 影响：UI 状态说谎，用户无法从高亮判断当前形态；再点一次「源码」才恢复一致。
- 建议：`mode` 由 `guard.mode` 派生（或双向同步），不要维护两份可漂移的权威状态。

### P2-5 新建标签遇到「slug 冲突但名称不同」时假成功，保存后标签静默消失

- 位置：[useAdminEditor.ts](../../src/admin/composables/useAdminEditor.ts#L161-L175)（把 `10006` 一律当成功并直接把名称加进表单）、[tag.ts](../../worker/src/handlers/tag.ts#L132-L142)（冲突条件是 `slug OR name`）、[article_service.ts](../../worker/src/services/article_service.ts#L466-L479)（保存时按 name 查不到标签就跳过）。
- 现象：`10006` 在本仓库是通用 `CONFLICT`，不专指「同名标签已存在」。若服务端因 slug 相同（例如名称只差空格/大小写）拒绝创建，前端仍把新名称加进 chips 并提示成功；保存时 `SELECT id FROM tags WHERE name = ?` 查不到，标签被静默丢弃。
- 影响：作者以为标签已挂上，刷新后消失，且没有错误提示。
- 建议：只有「按名称已存在」才视为成功（可先查 `GET /tags` 或读服务端 message），否则走错误提示；或在 Worker 返回里区分 `existing_name`。

### P2-6 编辑锁接口未校验文章归属，任意 editor 可锁住他人文章

- 位置：[edit_lock.ts](../../worker/src/handlers/edit_lock.ts#L5-L25)（只校验登录 + 文章存在）；对照 [article.ts](../../worker/src/handlers/article.ts#L168-L175)（编辑详情会做 ownership 校验）。
- 现象：任何已登录 editor 都能对任意 `articleId` 调用 `POST /articles/:id/edit-lock` 并持续心跳续期，即使他随后 `GET /edit` 会 403。
- 影响：editor 之间可互相瘫痪编辑（锁 TTL 30 分钟，可无限续期），管理员只能强制接管；属于授权缺口而非数据泄露。
- 建议：`handleAcquireLock` 复用 `checkArticleOwnership`（admin 全量放行），与 `GET /articles/:id/edit` 同口径。

### P3-1 编辑器头部标题中英文都拼错

- 位置：[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L185-L191)，`t("admin.edit") + t("admin.articles")`。
- 现象：中文渲染为「编辑文章管理」，英文为「EditArticles」（缺空格，且用了栏目名「Articles」）。
- 建议：新增 `admin.edit_article` 之类完整文案 key，不要在模板里拼词。

### P3-2 源码模式工具栏的占位文字硬编码中文

- 位置：[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L168-L189)（`wrapSelection(..., "粗体"/"斜体"/"代码")`）。
- 现象：英文界面下点击粗体会向正文插入 `**粗体**`；这些字符串会进入文章内容，不只是 UI。
- 建议：占位词走 i18n（或对内容型占位使用英文中性词），与其它编辑器文案同源。

### P3-3 「保存并关闭」被发布前校验拦下时，错误提示被弹窗遮住

- 位置：[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L144-L158)（`requestSave` 只设置 `publishError`，不关闭弹窗）、[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L416-L422)（未保存弹窗复用 `requestSave`）。
- 现象：已发布文章被清空标题/正文后点 X → 弹窗 → 「保存并关闭」→ 校验失败只把错误写进被弹窗盖住的元信息面板，弹窗保持打开，点击没有可见反馈。
- 建议：在未保存弹窗内直接展示校验错误，或失败时先关闭弹窗再提示；不要留下无声死路。

### P3-4 上传预检放行 `image/*`，服务端只接受 6 种

- 位置：[uploadImage.ts](../../src/utils/editor/uploadImage.ts#L53-L57)、[MarkdownWorkspace.vue](../../src/admin/editor/MarkdownWorkspace.vue#L403-L410)（`accept="image/*"`），对照 [media.ts](../../worker/src/handlers/media.ts#L21-L38)。
- 现象：avif / bmp / heic / tiff 等会通过客户端预检，直到服务端才报「类型不允许」（或扩展名不匹配）。
- 影响：UX 噪音，不是安全问题（服务端仍是权威）。
- 建议：`accept` 与预检白名单对齐服务端六种类型。

### P3-5 `PUT /articles/:id` 没有 `validate()`，标题 200 上限只在前端

- 位置：[metaFields.ts](../../src/utils/editor/metaFields.ts#L12-L13) 声称与 Worker `validate()` 对齐；但 [article.ts](../../worker/src/handlers/article.ts#L250-L314) 的更新分支没有任何 `validate` 调用，只有创建分支有（#L188-L197）。`docs/ADMIN_AND_VISUAL.md` 第 21 行也写「与服务端 validate 一致」。
- 影响：绕过浏览器（旧客户端、直接调 API）可写入超长标题 / 非法状态字符串；前端注释与文档失真。
- 建议：更新分支补齐 title / status 校验，或把注释与文档改成真实口径（按 `CODING_STANDARDS.md` 的契约面同步要求二选一）。

### P3-6 `forceTakeover` 的注释与 Worker 行为相反

- 位置：[useEditLock.ts](../../src/admin/editor/useEditLock.ts#L48-L49) 写「force 接口本身不授予锁」；[edit_lock_service.ts](../../worker/src/services/edit_lock_service.ts#L112-L129) 的 `forceReleaseLock` 删除后立即 `acquireLock`。
- 影响：无功能问题（客户端随后又 acquire 一次），但注释会误导维护者；属于 `CODING_STANDARDS.md`「契约面同步」范围。
- 建议：改注释，或去掉客户端多余的二次 acquire。

### P3-7 窄屏元信息抽屉没有焦点管理，Esc 会直接触发编辑器关闭逻辑

- 位置：[ArticleEditorOverlay.vue](../../src/admin/articles/ArticleEditorOverlay.vue#L270-L313)、[useArticleEditor.ts](../../src/admin/editor/useArticleEditor.ts#L723-L727)、[admin-shared.css](../../src/admin/admin-shared.css#L1991-L2004)。
- 现象：抽屉是 `position: fixed` 全屏覆盖，但不是模态：打开后焦点仍在底层编辑器，Tab 会走到被遮住的控件；按 Esc 走全局 `esc()`，脏状态下弹「未保存」而不是收起抽屉。
- 影响：键盘/读屏用户在窄屏上难以进入抽屉并容易误触关闭流程。
- 建议：抽屉展开时把焦点移入并加 `inert`/焦点陷阱；Esc 优先收起抽屉。

## 已核对、未发现问题的点

- 回写守卫的 fail-closed：渲染/往返异常一律按 lossy 处理，保存前独立重判，阻止时不发请求、不改 phase、不释放锁（`tests/editor-guard-integration.test.ts` 覆盖）。
- 草稿：白名单字段、不含 token、按 user+article 隔离、7 天过期惰性清理、1MB 上限、保存/放弃清理、10003 先落盘不清草稿（`tests/editor-draft.test.ts` / `article-editor-flow.test.ts`）。
- XSS：预览与分屏都走 `renderMarkdown`（DOMPurify 白名单）；embed NodeView 用 `safeHref`，原始 openTag 只参与序列化，不注入 DOM；封面预览只接受 `http(s)`。
- 上传：服务端 MIME + 扩展名 + 魔数三方校验，客户端 10MB 与服务端一致；失败保留原正文。
- 焦点陷阱、`aria-live`、44px 触控目标、分屏断点与亮暗主题变量接入完整；`useFocusTrap` 的激活/归还逻辑有 jsdom 测试。

## 建议的修复顺序

1. P1-1（锁失败旁路）→ 补一条「锁请求失败后重试仍须持锁」的单测。
2. P1-2（表单补丁化）→ 同时消掉 P2-2 的部分场景，并删掉 CI 脚本里的顺序规避注释。
3. P2-1 / P2-3 / P2-4（WYSIWYG 插入位置、守卫竞态、模式单一事实源）。
4. P2-5 / P2-6（标签冲突语义、锁接口归属校验）。
5. P3 批次按迭代清理，其中 P3-5 涉及文档口径，建议与文档改动同一提交。

## 后续修订

- 2026-11-19（issue #122）：编辑器布局样式缺失已修复（`crepe-theme.css` 引入 Crepe common 布局）；P1-1 / P1-2 仍待处理，原结论不变。
