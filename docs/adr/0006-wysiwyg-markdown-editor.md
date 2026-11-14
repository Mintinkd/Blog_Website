# 0006 · 文章编辑器改为所见即所得，Markdown 仍是唯一正文源

2026-11-14。文章编辑器目前是 `src/admin/App.vue` 内的原生 `textarea`（单文件 5,001 行），只有编辑 / 分屏 / 预览三种模式；预览每次按键同步渲染、编辑锁在取消时不释放、`beforeunload` 无条件释放锁、打开已发布文章还要经公开 slug 接口重复取正文。产品方向已定为所见即所得。我们决定引入 Milkdown 7（ProseMirror + remark，MIT）作为编辑内核，通过 `@milkdown/crepe/builder` 的 `CrepeBuilder` 按需装配，编辑器按壳层 / 元信息 / 工作区 / composables 拆分；`articles.content` 继续是唯一正文源，保存永远写 Markdown，不启用 `content_html`。Markdown 序列化不保证字节一致，因此引入「语义等价回写」守卫：加载与保存前比较编辑前后 `renderMarkdown` 的规范化结果，无法无损表示时自动进入源码模式并提示，绝不静默改写存量内容。原因是作者体验与存量安全必须同时成立，而 ProseMirror 生态能提供成熟的富文本编辑与中文输入支持；纯 textarea 增强无法达到所见即所得，TipTap 的 Markdown 能力依赖较新的 `@tiptap/markdown`，Vditor 的 IR 模式与现有渲染管线的贴合度更低。代价是后台新增一个较大的懒加载依赖、需要维护 Markdown ↔ ProseMirror 的 embed 节点桥接，并接受源码模式作为逃生口。

**Status:** accepted（2026-11-14；T0 技术验证结论「通过（有条件）」，见 `docs/reviews/2026-11-14-milkdown-t0-validation.md` 与 issue #61）

## Considered Options

- **增强现有 textarea（工具栏 / 快捷键 / 预览防抖）**：改动最小、包体零增长，但达不到所见即所得，否决。
- **TipTap + `@tiptap/markdown`**：ProseMirror 生态同样成熟、Vue 3 支持好；但 Markdown 解析 / 序列化能力较新，表格、原始 HTML、`data-*` 保真需要更多自定义扩展。保留为 T0 否决 Milkdown 时的首选回退，届时只替换内核适配层，T4 范围不变。
- **Vditor**：开箱即用的 IR / WYSIWYG / 分屏，中文社区活跃；但其自有渲染与主题体系较难与现有 `renderMarkdown` 白名单和站点设计令牌对齐，包体与可定制性也更差。保留为第二回退。
- **写入时持久化预览 HTML（`content_html`）**：需要回填存量文章，并在 Worker / 前端维护第二套渲染配置，与 ADR 0004 的请求时 SSR 决策冲突，否决。

## Consequences

- **正文契约**：`articles.content` 仍是唯一正文源；`content_html` 保持遗留列，不读不写，无 D1 迁移。保存请求体只含 Markdown。
- **组件化边界**：T3 拆出文章列表与编辑器；T8 继续拆出余下后台面板与共享 composables，最终 `App.vue` 只保留登录、侧栏、标签页编排与跨面板状态。全量拆分不改变 Worker API、D1 与设置规则。
- **回写守卫**：`classifyMarkdown(original, normalized)` 为纯函数，语料覆盖 GFM 表格、围栏代码、引用、嵌套列表、图片、原始 HTML、`data-*` / `aria-*`、`<a data-embed="1">`、中文标点与硬换行；守卫失败强制源码模式，WYSIWYG 保存被阻止。
- **能力边界**：编辑器启用的节点 / 标记不得超过 `ARTICLE_BODY_TAGS` / `ARTICLE_BODY_ATTRS`；不启用 LaTeX、任务列表、下划线、文字颜色、代码高亮、iframe。原始 HTML 以不可编辑原子块保留。
- **内嵌链接**：`data-embed="1"` 通过专用节点 / NodeView 往返，序列化必须还原为原锚点，不得退化成普通链接。
- **取数接缝**：新增认证接口 `GET /api/v1/articles/:id/edit`，按 id 取正文，不经过公开 slug 接口、不写阅读统计、不下发 `view_<id>` Cookie。
- **编辑锁**：10 分钟心跳续期（同一用户重取即续期）；保存前校验持有权；显式关闭 / 保存 / 放弃时释放；`beforeunload` 只提示未保存，不再无条件释放。服务端仍不校验写入者是否持有锁，该残留风险由保存前校验 + 本地草稿缓解。
- **本地草稿**：仅 `localStorage`，按用户 + 文章隔离，1.5s 防抖写入，打开时提示恢复；不做服务端自动保存、版本历史或多人协作。
- **包体**：Milkdown / Crepe 只在编辑器打开时动态加载，不进入后台首屏 chunk；gzip 预算 ≤ 350KB。T0 实测首次打开增量 **226,078 B gzip**（预算 358,400 B），见「T0 实测修订」。超预算优先裁剪装饰能力，不牺牲回写守卫与图片上传。
- **CSP**：不使用 eval / CDN / 内联脚本；构建后跑 `patch-csp` 与浏览器回归。T0 实测严格 `script-src 'self'` 下 0 violation（bundle 内 lodash 的 `Function("return this")()` 是短路兜底，未执行；详见「T0 实测修订」）。
- **测试**：回写守卫、命令、草稿、状态机、slug、字数走 vitest；编辑器关键路径新增 `scripts/verify-article-editor.mjs`，纳入 CI 部署门禁。
- **回退路径**：T0 否决 Milkdown 时，按上述候选重选内核并更新本 ADR；组件拆分、回写守卫、API、锁与草稿契约不受影响。**T0 结论为通过，本条未触发。**

## T0 实测修订（2026-11-14，issue #61）

原型实测（`@milkdown/*` 全部 7.23.0 共 23 包，Node 22 + Playwright 1.64.1 / Edge、`tightenCsp([])` 严格 CSP、真实 `renderMarkdown`）确认**内核可用**，同时推翻了本 ADR 与 `docs/ARTICLE_EDITOR_UPGRADE.md` 8.1 的两处实施假设。按 `docs/agents/domain.md` 显式标注冲突，不静默覆盖：

> _Contradicts 本 ADR 原文「通过 `CrepeBuilder` 按需装配」与方案文档 8.1 的「`image-block` 必选」：启用 Crepe `image-block` 会破坏正文契约，必须改为不装配。_

- **不装配 `image-block`**：`@milkdown/components@7.23.0` 的 `imageBlockSchema` 把 Markdown 图片的 `alt` 当宽高比（`Number(node.alt || 1)` → 序列化 `"1.00"`）、`title` 当 caption。默认装配下 15 条回写语料有 2 条 lossy（`image`、`mixed-document`）；去掉该 feature 后 **15/15 语义等价**。改为保留 Crepe 内置 `upload` 插件但覆盖 `uploadConfig.uploader`，用普通 `image` 节点写 `src`（`POST /media/upload` 返回的相对地址）与 `alt`（`original_name` 去扩展名）。原型已实测该路径可行：`![photo](/media/uploaded/t0-upload.png)`。
- **装配清单**：`toolbar` / `list-item` / `link-tooltip` / `table` / `block-edit` / `placeholder` / `cursor` 七项；`code-mirror` / `latex` / `ai` / `top-bar` 保持关闭。
- **CSP**：严格 `script-src 'self'` 下 0 `securitypolicyviolation`、0 `pageerror`，`npm run build` 的 `patch-csp` 通过。bundle 内 lodash 的 `Function("return this")()` 是 `freeSelf` 短路兜底，实测未执行；依赖升级需重测。
- **embed 节点仍是缺口**：默认装配下 `<a … data-embed="1">` 往返逐字保真（含 `class` / `id` / 中文文字），但 ProseMirror DOM 里没有真实 `<a>`，标签是 `contenteditable="false"` 的 `span[data-type="html"]`。上文「专用节点 / NodeView（可点击、可编辑文字）」仍须由 T4 实现，不能依赖默认行为。
- **i18n 配置非响应式**：Crepe feature 的 label 在装配时一次性构造；原地改配置对象不更新工具栏文案（正文保留、实例未重建），卸载重建才生效，与「语言切换不重建编辑器」冲突。T4 需自有响应式文案或局部重建工具栏。
- **拖拽上传待真实回归**：自动化模拟下粘贴可用、拖拽未触发 `onUpload`；T4 需用真实拖拽复核。
- **回写守卫不变**：0/15 语料字节相同是常态，加载 / 模式切换 / 保存前仍按 `renderMarkdown` 归一化结果比较，语料单源为 `tests/fixtures/editor/markdown-corpus.ts`。
- **T4 解除阻塞**：#65 接收上述 deferred obligations（已按 `docs/agents/issue-tracker.md` 写入其 body）；`docs/ARTICLE_EDITOR_UPGRADE.md` 8.1 的同步修订一并交由 #65。
