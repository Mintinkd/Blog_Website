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
