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

**收紧**：
构建期把 CSP 基线的 script-src 从 `'unsafe-inline'` 替换为 dist 内联脚本的 sha256 hash 清单（patch-csp）。
