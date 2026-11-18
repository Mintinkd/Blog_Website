# Blog_Website

个人博客站全仓：Astro 静态/SSR 前端（根包）+ Cloudflare Worker 后端（`worker/`，独立 npm 包）。单一上下文，本项目语言收录于此。

## Language

**单一事实源**：
某类规则或常量唯一允许手工编辑的出处；其余出现处一律是生成物或对它的 import。
_Avoid_: 单一来源、真相源、source of truth

**规则描述符**：
设置值校验规则的声明式手写单源：命名 pattern、数值范围、copy 长度上限与各分区字段清单；写侧拒绝与读侧回落全部由其生成物派生。

**生成物**：
由生成脚本从单一事实源渲染、提交进库的文件；禁止手工编辑，CI 以「重新生成 diff 必须为空」守护一致性。
_Avoid_: 产物（dist 构建输出另作「产物」，不与生成物混用）

**写侧**：
worker 的设置写入路径：对非法字段值直接拒绝（400）。

**读侧**：
前端的设置呈现路径：把非法/脏值按字段回落默认值。

**CSP 基线**：
声明态 CSP（script-src 含 `'unsafe-inline'`），由安全头模块单源持有；只存在于源码与 dev，绝不进入生产产物。
_Avoid_: dev CSP、开发态 CSP

**安全头模块**：
持有全部 5 个响应头（含 CSP 基线）声明式常量的手写 `.mjs` 单源（`scripts/security-headers.mjs`）：middleware 直接 import，`_headers` 由其渲染，收紧后的 CSP 由其构造。

**收紧**：
构建期把 CSP 基线的 script-src 从 `'unsafe-inline'` 替换为 dist 内联脚本的 sha256 hash 清单（patch-csp）。

## 内容抓取

**抓取（scrape）**：
从目标 URL 取回页面 HTML 的动作；不含正文识别与格式转换。
_Avoid_: 采集、爬取

**提取（extract）**：
从抓取到的 HTML 中识别正文内容的步骤。
_Avoid_: 解析（与通用 HTML 解析混用）

**转换（convert）**：
把提取出的正文 HTML 转成本站文章所用 Markdown 的步骤。
_Avoid_: 导入

**导入（import）**：
后台既有的整库 JSON 数据导入；与抓取、转换不是同一概念。
_Avoid_: 抓取（指代内容抓取功能时）

**抓取预览**：
抓取与提取完成后、生成草稿前的无状态结果；不写入文章表。
_Avoid_: 抓取结果、导入预览

**来源脚注**：
抓取草稿末尾自动附加的原文链接与抓取日期。
_Avoid_: 版权声明、转载声明

## 编辑

**文章编辑器**：
后台创建与修改文章的全屏壳层；由元信息、Markdown 工作区、链接弹窗、线上预览与未保存保护组成，与文章列表分离。
_Avoid_: 编辑页、编辑器页面

**所见即所得编辑**：
在渲染后的富文本形态中直接编辑文章的编辑形态；Markdown 仍是唯一存储格式，可用能力受正文白名单约束。
_Avoid_: 富文本模式、可视化编辑

**源码模式**：
直接编辑 Markdown 源文本的编辑形态；用于存量语法无法无损往返或作者需要精确控制时，未修改时保存保留原始字节。
_Avoid_: 文本模式、纯文本模式

**线上预览**：
按前台同一 `renderMarkdown` 管线渲染当前 Markdown 的只读预览；不是编辑器内的所见即所得视图。
_Avoid_: 预览模式（指代 WYSIWYG 时）、前台预览

**语义等价回写**：
所见即所得序列化出的 Markdown 经 `renderMarkdown` 渲染后，与编辑前的渲染结果一致（规范化空白与 void 标签后比较）；不要求字节相同。
_Avoid_: 无损回写、原样保存

**回写守卫**：
在加载、模式切换与保存前执行语义等价比较的检查；不通过时强制源码模式或阻止所见即所得保存，不静默改写存量内容。
_Avoid_: 兼容性检查、格式校验

**本地草稿**：
仅存于浏览器 `localStorage`、按用户与文章隔离的未提交编辑快照；打开时提示恢复，保存 / 放弃 / 退出登录时清理。
_Avoid_: 自动保存、服务端草稿

**编辑锁**：
同一文章同一时间仅允许一位作者进入编辑的租约；10 分钟心跳续期，保存前校验，显式关闭 / 保存 / 放弃时释放。
_Avoid_: 编辑占用、互斥锁

## 富文本消毒

**正文白名单**：
允许进入文章正文与评论的 HTML 标签 / 属性 / URL scheme 清单，单一事实源为仓库根 `rich-text-policy.json`；前端 `markdownPolicy.ts`（DOMPurify / sanitize-html 的调用方）与 Worker `sanitizer.ts`（同为手写消费方，真正的生成物是它导入的 `worker/src/generated/rich-text-policy.ts`）各自消费，交叉测试 + CI 漂移门禁守卫一致性。
_Avoid_: 消毒黑名单、双份白名单

**搜索高亮白名单**：
独立于正文白名单的兜底层，仅允许 `<mark>` 标签（`HIGHLIGHT_TAGS` 常量）；正文白名单不含 mark，两层不互相合并。用于渲染搜索结果的高亮片段，防后端高亮标记被未来改动放大成 XSS。
_Avoid_: 正文白名单的一部分、通用 HTML 消毒

**DOM clobbering 防护**：
服务端正文渲染器（`markdownServer.ts` → sanitize-html）用 `markdownPolicy.ts` 的 `ARTICLE_BODY_FORBIDDEN_IDS` 丢弃会遮蔽 DOM API 的 `id`（静态清单，无 DOM 可用时的保守防护）；浏览器侧 DOMPurify 走自身的动态 `value in document` 检查丢弃同类 id。Worker 入库消毒不复现该静态清单——正文交付前台必经服务端渲染器的 transformTags，防护在该层生效，属分层边界而非双份清单。
_Avoid_: Worker 侧重复维护同一份 id 表

## 阅读

**阅读量**：
文章详情页的累计去重阅读数；按站点时区 `Asia/Shanghai` 的日界计数，同一去重键当日只计一次（`view_<id>` Cookie 24 小时快路径 + 24 小时 HMAC 令牌兜底），跨日重新计数。
_Avoid_: 浏览量、PV、访问量

**去重访客**：
当日未命中 `view_<id>` Cookie、且未命中 24 小时去重令牌的访客；去重键为 `HMAC(analytics_hmac_secret, X-Real-IP + User-Agent + article_id + 日期)`，`X-Real-IP` 只作 HMAC 输入、不落库，同一去重键当日只计一次。Cookie / 令牌命中仍累加 `pv` / `requests`，只跳过本计数与累计 `view_count`。
_Avoid_: 独立访客、UV（报表列名另用「UV」）

**有效阅读**：
页面可见时长 ≥ 15 秒且最大滚动 ≥ 50% 的一次阅读；需访客同意统计类采集后才产生。
_Avoid_: 完读率、阅读完成

**聚合桶**：
维度值归并后的计数行（Tier 0 为 `device` / `country` / `referrer` 的离散桶，按「文章 × 日期 × 桶」单篇行保存）；桶内不含任何单条访客记录，全站视图由 `GROUP BY bucket` 聚合，不写全站行。
_Avoid_: 分组、标签

**代理覆盖率**：
`pv / requests`；详情请求中经由 SSR 代理链路计数的比例（直连 API 只累加 `requests` 作分母，不产生 PV），用于发现转发契约断开；低于 90% 视为异常。
_Avoid_: 转发率、代理率

**同意凭证**：
记录同意版本、授权范围与决定时间的合规证据行；不含 IP、UA 或访客标识。
_Avoid_: 同意记录、授权日志

## 分类与标签（taxonomy v2）

**分类**：
文章的唯一归属维度，权威在 `articles.category_id`；标签不是分类，也不反向决定文章分类。
_Avoid_: 类目、栏目

**标签**：
文章的内容标记；每个标签只归属一个分类（1:N），`tags.name` / `slug` 全局唯一，不按分类建立命名空间。
_Avoid_: 关键词、话题

**标签归属**：
标签与其所属分类之间的 1:N 关系（`tags.category_id`）；回填完成后由应用层保证必填，首批不做 DB 级 `NOT NULL`。
_Avoid_: 标签分类（易误读为「给标签分类」的动宾结构）

**未分类**：
`category_id` 为空的文章与无文章引用标签回填时的兜底归属（种子分类 `uncategorized`）；在前台分组渲染中固定排在最后。
_Avoid_: 无分类、默认分类（「默认分类 id 1」是抓取草稿的既有口径，不是本术语）

**标签目录**：
前台 `/tags` 页按分类分组的标签总览；分组按标签数降序、「未分类」组固定最后，替代旧的全平铺「标签云」形态。#116 起为兼容入口（导航已移除「标签」），靠 `/categories` 的「全部标签」链接与 `/tags/:slug` 的面包屑回流，不再是标签浏览主路径。
_Avoid_: 标签云

**标签筛选**：
分类页内按标签收窄文章列表的交互，唯一前台入口为 `/categories/:slug?tag=:tag`；服务端按标签归属校验后直出筛选结果，是全站标签 chip 的主路径（#116）。
_Avoid_: 标签页筛选、标签查询参数（易与主路径 / 关键词搜索混淆）

**严格校验**：
「文章标签必须属于文章分类」的可开关硬校验（`site_config` 行 `strict_tag_category_validation`，默认关）；开启时 create / update（含只改分类的情况）冲突文章 400 且提示具体标签。关闭时跨分类标签是允许的存量现实。
_Avoid_: 硬约束默认开、强一致校验
