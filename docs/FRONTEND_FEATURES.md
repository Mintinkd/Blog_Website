# 前台页面与展示

本文档收录前台页面清单、文章详情页 SSR、内嵌链接预览、站点配置动态化、多语言与主题。部署流程见根目录 [`README.md`](../README.md)。

## 前台页面

| 路径                 | 说明                                                                    | 渲染模式 |
| -------------------- | ----------------------------------------------------------------------- | -------- |
| `/`                  | 首页（Hero + 最新文章卡片网格 + 单行分类区块）                          | 静态     |
| `/articles`          | 文章列表（分页）                                                        | 静态     |
| `/articles/:slug`    | 文章详情（Markdown + 每篇 meta + Tier 0 计数与 `HttpOnly` 去重 Cookie） | SSR      |
| `/categories`        | 分类目录（全部分类，含标签数与标签预览）                                | SSR      |
| `/categories/:slug`  | 分类文章 + `?tag=<tag-slug>` 标签筛选（服务端直出筛选结果与 chip）      | SSR      |
| `/tags`              | 标签目录（按分类分组，「未分类」固定最后，taxonomy v2；兼容入口）       | SSR      |
| `/tags/:slug`        | 标签文章（含分类面包屑与同分类标签跳转；兼容入口）                      | SSR      |
| `/api/v1/*`          | API代理到Worker                                                         | SSR      |
| `/rss.xml`           | RSS订阅源                                                               | SSR      |
| `/speculation-rules` | 空预取规则集（Cloudflare 护栏）                                         | SSR      |
| `/archives`          | 时间线归档                                                              | 静态     |
| `/about`             | 关于页面                                                                | 静态     |
| `/privacy`           | 隐私与阅读统计披露（中英、页脚入口）                                    | 静态     |
| `/search`            | 搜索页（仅关键词搜索，不含 taxonomy 分组区块）                          | 静态     |
| `/admin`             | 后台管理                                                                | 静态     |

> **分类 / 标签页 SSR 首屏（issue #97 / M17）**：四个分类 / 标签页在服务端直连 Worker 取数并渲染首屏 HTML（`src/utils/taxonomyServer.ts` + 共用 `taxonomyRender.ts`），非 JS 抓取器可见真实分类 / 标签 / 文章标题；客户端脚本在中文首屏已渲染时跳过重复 fetch（非中文用户主动刷新套用英文文案），分页与语言切换仍刷新。**只有取数失败（`error`）才降级为客户端接管**（`data-ssr="0"`）；`ok` 与 `empty` 都算 SSR 成功（`data-ssr="1"`），空数据由服务端渲染空态文案，客户端不再补一次请求。代价：每次访问多一次服务端同步 fetch Worker（8s 超时），首屏 TTFB 取决于 Worker 响应。

> **分类页 `?tag=` SSR 筛选（issue #117）**：`/categories/:slug?tag=:tag` 由服务端用 `parseTagParam` 解析、先取本分类标签校验归属；合法时 SSR 直接输出筛选后的文章与分页，非法 / 越界值按「全部」渲染并由客户端 `replaceState` 清参（不发无效筛选请求）。筛选 chip 是服务端渲染的 `<a href="/categories/:slug?tag=:tag">`，选中态用 `aria-current="page"`，禁用 JS 时点击 chip 走整页导航完成标签切换（分页按钮仍为客户端交互）；有 JS 时客户端拦截点击做 `pushState` + 局部刷新，SSR 已按同一筛选渲染（`data-active-tag`）时不重复取数。不带 `?tag=` 时标签与文章并行取数；带筛选时才先标签后文章串行。

> **标签 chip 主路径（issue #116）**：全站标签 chip（文章卡片、文章详情、分类目录预览、标签页同分类标签、`/tags` 目录 chip）统一走单源 `src/utils/tagLinks.ts` 的 `tagChipHref`：有归属分类 → `/categories/:catSlug?tag=:tagSlug`（「标签是分类子类」的交互闭环），无归属分类（迁移期）→ 回退兼容入口 `/tags/:tagSlug`。`/tags`、`/tags/:slug` 均保留，不做删除 / 301；导航已移除「标签」（#118），#121 起首页热门标签区块与 `/categories` 的「全部标签」入口也一并移除，兼容入口仅由 `/tags/:slug` 的「标签不存在」空态回流（面包屑指向分类页）。搜索页只做关键词搜索，不再列 taxonomy 区块（#118）。

`/privacy` 为预渲染页面：已列入 `scripts/cloudflare-guards.mjs` 的 `HTML_ROUTE_PATTERNS`，由 `npm run gen:headers` 生成 `public/_headers` 中的 `no-transform` / `Speculation-Rules` 护栏块；正文与页脚入口文案走 `data-i18n` + `refreshDomTranslations()`（中英同步，无 JS 首屏为中文），`<title>` 与 meta description 沿用站点其它页面的静态中文约定，入口在页脚。

### 文章详情页 SSR

文章详情由 Astro 在请求时服务端渲染（issue #36 / [ADR 0004](adr/0004-article-ssr-request-time-rendering.md)）：

- **取数**：服务端直连 Worker origin 的 `GET /api/v1/articles/:slug`（不走同源代理），转发访客 `Cookie` 与 `cf-connecting-ip`（映射为 `X-Real-IP`），并把上游 `Set-Cookie`（阅读量 24 小时去重，带 `HttpOnly`）原样回传浏览器；站点标题另读 `/api/v1/config`，失败回退默认站名。
- **计数**：Worker 侧 `recordArticleView` 只计已发布文章 200；按 `READER_ANALYTICS.md` §4.1 过滤爬虫 / 预取 / 非导航请求，SSR 链路（带**验签通过**的 `X-Real-IP`）写日聚合 `pv` / `uv` / `requests` 与累计 `view_count`，直连 API 或伪造 / 未签名的 `X-Real-IP` 只累加 `requests`，被过滤的直连请求不写库；`view_<id>` Cookie 按 Cookie 快路径 + 24h HMAC 令牌去重，草稿预览不计数；新访客（去重命中）在同一 D1 `batch()` 内写 `device` / `country` / `referrer` 三个单篇维度桶（#56），全站分布由 `GET /admin/analytics/dimensions` 查询时 `GROUP BY` 聚合。IP 验签走 `worker/src/utils/client_ip.ts` 单点（`resolveSignedProxyIp`），访客上下文不再直读 `X-Real-IP`。
- **访客上下文**：同时转发白名单 `User-Agent` / `Accept` / `Referer` / `Accept-Language` / `Sec-Fetch-Mode` / `Sec-Fetch-Dest` / `Sec-Purpose` / `Purpose` / `X-Purpose` / `Sec-CH-UA*`；`CF-IPCountry` 映射为 `X-Visitor-Country`。缺失的头不合成默认 UA / Accept，Worker 侧提供 `readVisitorContext` 按缺失还原为访客上下文，供机器人过滤与维度使用；其中 `ip` 只取验签通过的 `X-Real-IP`（未签名 / 签名错误 / 缺 secret 一律 null）。
- **渲染**：`articles.content`（Markdown）是唯一正文源；marked（GFM）渲染后经与后台预览共享的服务端白名单消毒，直接写入首屏 HTML。`articles.content_html` 是历史遗留列：正常发布流程不写入，页面也不读取（仅整库导入可携带旧值），渲染始终以 `content` 为准。
- **错误口径**：文章不存在 / 未发布 → 404 + 未找到 UI；上游不可达 / 404 以外的非 2xx / 2xx 响应体非法 / 超时（8s）→ 502 + 重试入口；不保留客户端渲染兜底。
- **缓存**：响应 `Cache-Control: private, no-cache`（HTML 护栏再追加 `no-transform`），含访客 Cookie 的页面不会被共享缓存复用。
- **无 JS / 动效失败**：`<noscript>` 兜底保证禁用 JS 时标题 / 摘要 / 正文直接可见；motion chunk 动态 import 失败（或 3s 内未完成初始化）时写入 `<html data-motion-failed>`，`motion.css` 同样强制 `[data-reveal]` 可见，避免 JS 仍开启时首屏停在 `opacity:0`。
- **回归**：dev 下可用 `ARTICLE_API_ORIGIN` 把文章页取数指向本地 mock；生产始终使用 `WORKER_ORIGIN`。CI 在构建前用同一 mock 跑文章 SSR 浏览器回归；两条导航回归仍手动。脚本启动后会先确认 mock 收到 SSR 取数，防止误连真实 Worker；运行方式见 `agents/testing.md`。

### 文章内嵌链接预览（统一内嵌容器）

文章正文中的媒体 / 网页链接在浏览器端渲染为统一的内嵌容器（`src/utils/mediaEmbed.ts`，样式 `src/styles/media-embed.css`），容器 = 标题栏（类型徽标 + 标题链接 + 域名）+ 渲染主体：

- **自动识别（历史文章零改动自动适配，识别规则与旧版一致）**：音频文件（.mp3/.wav/.ogg/.m4a/.flac/.aac）→ 内嵌容器 + 自定义音频播放器（播放/暂停、进度拖拽、倍速）；视频文件（.mp4/.webm/.mov/.m3u8）→ 封面点击加载原生 `<video>`；B 站视频页 / YouTube → 封面点击加载官方播放器 iframe。
- **手动内嵌网页预览**：后台编辑器「插入链接」支持两种预览方式——普通链接（Markdown `[文字](url)`）与内嵌网页预览（写入 `<a href="…" data-embed="1">文字</a>`，`data-*` 属性可安全通过正文白名单消毒），前台把任意 https 链接渲染为内嵌 iframe（带加载态遮罩、`referrerpolicy=no-referrer`、懒加载）。
- **降级与兜底**：非 https 链接与已知拒绝内嵌的头部站点（x/twitter/facebook/instagram/github）直接保留普通链接；iframe 加载失败或 12s 超时、媒体源 404/MIME 不符 → 容器内兜底面板（「在新窗口打开」/「转为普通链接」）。
- **CSP**：`frame-src https:`（详见 `security/csp-evaluation.md` 的 frame-src 放宽评估）；`media-src 'self' https:` 不变。
- **后台预览一致**：编辑器分屏/预览模式复用同一增强逻辑与全站 `renderMarkdown` 消毒管线；单测 `tests/media-embed.test.ts`（识别 / 容器 / 幂等 / 降级 / 兜底 / 管线保留 data-embed）。

## 站点配置动态化

前台页面在加载时会自动从 `/api/v1/config` 读取站点配置并动态应用：

| 配置项             | 前台应用位置                                              |
| ------------------ | --------------------------------------------------------- |
| `site_title`       | 导航栏Logo、页面标题（首页客户端 / 文章页 SSR）、页脚版权 |
| `site_subtitle`    | 首页Hero区域副标题                                        |
| `site_description` | 首页Hero描述、meta description、OG描述                    |
| `site_keywords`    | meta keywords                                             |
| `about_content`    | `/about` 页面 Markdown 正文                               |
| `profile_card`     | `/about` 页面顶部个人名片（JSON 字符串）                  |

- 页面级 description 优先级高于站点级（不会被覆盖）
- 首页 Hero 区域的默认文案在无配置时显示，有配置后自动替换

### 个人名片（`profile_card`）

- **存储与更新**：`site_config` 的单个键，value 为 JSON 字符串。后台「关于页面」面板可编辑各字段、增删社交链接、上传头像（复用 `POST /api/v1/media/upload`）并保存；前台 `/about` 每次加载都从 `GET /api/v1/config` 读取最新值，无需重新构建页面。
- **字段**：`name`（姓名，80 字）、`role`（职位 / 头衔，120 字）、`bio`（简介，500 字）、`avatar`（头像地址）、`links`（最多 6 条 `{ label, url }` 社交联系方式，可增删）。
- **安全**：写入时 Worker 过滤未知字段、限制长度，URL 仅放行 `http(s)://`、`mailto:` 与站内 `/` 路径（拒绝 `javascript:` / `data:` / `//host`）；前台所有文本转义后才进入 `innerHTML`，头像地址同样做协议校验。
- **降级**：键不存在 / 空串 / 坏 JSON / 接口失败时仍渲染卡片骨架 —— 空头像用姓名首字母色块，空姓名回退站点名（再回退「博主」），空职位与简介隐藏该行，无链接不渲染按钮区，完全未配置显示引导文案。
- **无需 D1 迁移**：`PUT /config` 使用 UPSERT，老库首次保存自动建行（`is_public=1`）；`schema.sql` 的种子行只用于全新环境。

## 多语言 (i18n)

支持中文/英文切换，基于自定义轻量 i18n 方案：

- **翻译文件** — `src/i18n/zh.json` / `src/i18n/en.json`
- **工具模块** — `src/utils/i18n.ts`（`initLocale`, `setLocale`, `getLocale`, `t` 函数）
- **语言检测** — 优先读取 `localStorage` 中的 `locale`，其次根据浏览器语言自动选择
- **切换方式** — 导航栏地球图标按钮，切换后所有页面内容实时更新
- **前台页面** — 使用 `data-i18n` 属性标记静态文本，JS 动态内容使用 `t()` 函数
- **后台管理** — Vue 组件中直接调用 `t()` 函数

## 主题

支持亮色/暗色主题切换，设计令牌定义在 `src/styles/variables.css` 中：

- **亮色** — 白色背景 + 安知鱼蓝 (#49b1f5) 强调色
- **暗色** — 深色背景 + 亮蓝 (#7cb8f0) 强调色
- **字体** — Inter (正文) + JetBrains Mono (代码)
- **风格** — Apple式毛玻璃导航栏 + 卡片化布局；文章卡片「有封面图 → 上图下文、无封面 → 分类专属色渐变横幅」，分类徽标按分类着色（参考 hexo-theme-anzhiyu 视觉风格融合）
- **可配置** — 上述配色（accent / 背景 / 文字 / 边框等）现已可在后台「外观与个性化 → 配色」中可视化调整，日 / 夜分别配置，保存后实时生效，详见「可视化配置中心」小节（`SITE_SETTINGS.md`）。

## 响应式布局

全站从 280px 极窄手机到 3440px 超宽屏使用同一套移动优先断点，详表与验证矩阵见 [`responsive-design.md`](responsive-design.md)。

- **全局层**：`src/styles/responsive.css` 在 `global.css` 之后单独引入，负责流式页边距
  （`clamp(0.75rem, 4vw, 2rem)`）、页面标题字号、触控目标、安全区与浮动组件定位。
- **布局**：首页 1 / 2 / 3 列（`768px`、`1280px`）；文章列表在 `< 768px` 用纵向卡片，
  `≥ 768px` 改为封面在左的横向卡片；文章详情最大 760px；超宽屏保持版心宽度不拉伸正文。
- **移动导航**：`< 768px` 显示汉堡按钮，复用同一份 `.nav-links` 作为下拉面板；
  支持 `aria-expanded`、焦点管理、`Escape` / 点击外部关闭、ClientRouter 导航后复位。
  #126 起导航栏仅保留「首页 / 关于」两项，分类入口只保留首页分类区块（`#taxonomy-discovery`）；该区块按文章数降序取前 20 个分类，固定单行不换行，超出部分在区块内横向滚动（最火在前），不撑破页面。
- **内容适配**：正文 16px 起、长标题 / 英文 / 链接可断行、宽表格与代码块在自身容器内
  横向滚动；后台 6 张数据表在 `< 768px` 卡片化（字段名 + 值 + 底部操作），
  不再把 7 列表格压进手机宽度；页头页脚与悬浮一言避让刘海和手势条。
- **验证**：12 个视口 × 13 条路由（含文章详情、动态分类 / 标签页与 `/admin`）
  检查无横向滚动、无溢出、无意外裁切；280 / 375 / 667×375 下移动菜单交互通过。
