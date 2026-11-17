# push 前全量审查：53 个未推送提交（2026-11-17）

- **范围**：`origin/main...HEAD`，merge-base `69cbf30`，**53 commits / 167 files / +13484 −2137**
- **方法**：三切片（后端 `worker/src` / 测试与 CI / 前端与文档）× 双轴（Standards + Spec），6 个只读子代理并行；findings 由主代理逐条复核后才处置
- **结果**：4 个真缺陷（会丢数据 / 让安全修复失效）已修；5 处文档失真已改；15 条判断项/测试质量问题列入待办（不阻断 push）
- **门禁**：worker 50 files / 466 tests + tsc 0；根包 56 files / 617 tests；`check` 185 files 0 errors；lint 0 problem

## 一、推送前必修（已修）

| #   | 位置                                                                | 问题                                                                                                       | 后果                                                                                                                                                                            | 处置                                                                                                                                                               |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `src/utils/visitorIpSigning.ts`                                     | secret 只读 `import.meta.env`，Astro 构建期内联；CI 从未注入该变量                                         | 线上恒 `undefined` → 不写 `X-Real-IP-Sig` → Worker fail-closed 退回 `CF-Connecting-IP`（Pages 出口 IP），全站点赞去重 / 限流 / 评论溯源按 IP 口径失真，**#84 修的现象原样复现** | 改为运行时 `Astro.locals.runtime.env` 优先、构建期内联兜底；`[...path].ts` / `articleServer.ts` / `articles/[slug].astro` 三处调用点透传；新增 secret 来源顺序用例 |
| 2   | `worker/src/handlers/admin.ts` `IMPORTABLE_TABLES.articles.columns` | 缺 `reading_time`（#90 落库后没同步这张表）                                                                | 导出丢列 → 导入落 `DEFAULT 1`；batch 失败回滚重放快照同样清成 1，**备份不再是可还原快照**                                                                                       | 补列；`admin_import` / `admin_export` 各加一条手写字面量断言                                                                                                       |
| 3   | `worker/src/handlers/admin.ts` KV 孤儿清理                          | `media_assets` 为空数组时，DELETE 跳过旧行，但 `orphanedMediaKeys(snapshot, [])` 把快照里全部 key 判成孤儿 | 接口回 `success` 的同时**删掉仍被 DB 引用的媒体文件**（破图 + 不可恢复）                                                                                                        | 与 DELETE 同条件：只有真正替换过 `media_assets` 才清理；新增「空数组不清 KV」用例                                                                                  |
| 4   | `worker/src/handlers/admin.ts` `sanitizeColumns`                    | 对 `articles.content`（Markdown 源文）与 `comments.content`（纯文本）跑 HTML 白名单                        | 实测：`<https://…>` / `<T>` 被整段删除，围栏里的 `<div>` 被剥标签，`a < b` 变 `&lt;` —— **备份还原会静默损坏正文**（#92 的「合法正文不丢失」在 Markdown 列上不成立）            | 收窄为只净化 `content_html`；正文 XSS 交渲染链（`markdownServer` + 前台 DOMPurify），评论写入路径仍按 #92 净化；新增「Markdown 全形态逐字保留」用例                |

> 1 与 2/3/4 分别是 Spec 轴两个切片与 Standards 轴各自独立命中的，均已本地复现后才动手。

## 二、文档失真（已修）

| 位置                               | 原文                                                                                                         | 修正                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `README.md` 分类 / 标签 SSR 段     | 「取数失败 / 空数据时降级为客户端接管」                                                                      | 只有 `error` 降级（`data-ssr="0"`）；`ok` 与 `empty` 都是 `data-ssr="1"`，空数据由服务端渲染空态                               |
| `README.md` 接口表 `/admin/import` | 只写了「导入数据」                                                                                           | 补 `dry_run` / `confirm` / `would_delete` / `needs_confirm` / `backup_key` / `batches` / `kv_orphans_deleted` / `500 restored` |
| `README.md` 部署段                 | 称 token 的 `Transform Rules:Edit` 供 `remove-edge-cors.mjs`「自动清理」                                     | `deploy.yml` 无该步骤；改为「手动脚本 + CI 不执行 + zone 规则仍未闭环」                                                        |
| `README.md` 结构清单               | 缺 `cors-origins.ts` / `scripts/layout/` / `visitorIpSigning.ts` / `taxonomyServer.ts` / `taxonomyRender.ts` | 补齐                                                                                                                           |
| `README.md` 富文本段               | 未说明导入净化范围                                                                                           | 补「只净化 `content_html`，Markdown / 纯文本列原样还原」及理由                                                                 |
| `GLOSSARY.md` 正文白名单           | 称 Worker `sanitizer.ts` 为「生成物」                                                                        | 它是手写消费方；生成物是 `worker/src/generated/rich-text-policy.ts`                                                            |

## 三、待办（不阻断 push，建议开票）

### 测试质量（假绿风险）

1. `tests/reading-time-migration.test.ts` 跨包 import Worker 实现做互证（本次已把 `visitor-ip-signing` 改成同一份手写十六进制，这个文件同源问题仍在）。
2. `tests/base-layout-modules.test.ts:148-151`：`style ?? querySelector("style")` + `toContain("--")`，实现没建 `STYLE_ID` 节点也能过。
3. `tests/lint-config.test.ts:45` 断言 `no-undef: error`，但 TS / Vue 块实为 off（`eslint.config.mjs:113,136`），标题口径与事实不符。
4. `tests/api-proxy-guard.test.ts`：超时 / 路径逃逸只断言源码文本与 WHATWG URL 归一化，未证 `abort → 502` 的真实行为（#98 的「超时有用例」不成立）。
5. #103 验收要求「每个可测模块有单测」，实际 11 个模块里 7 个只有「被 import 且被调用」的结构断言。
6. #106 验收要求「workflow YAML 语法校验」，仓库无任何 YAML 解析门禁。
7. `wait-for-deploy.mjs` / `deploy.yml` / `tests/wait-for-deploy.test.ts` 三份 `DEPLOY_BASE_URL`，漂移无守卫。
8. `scripts/migrate-reading-time.mjs` 新增列不在 `verify-d1-migrations` 的核对范围（只查 3 表 5 索引）。

### 代码 / 口径

9. `worker/src/utils/visitor_context.ts:36` 仍直读 `x-real-ip`（无验签），与「只有 `client_ip.ts` 读 X-Real-IP」的说法不符（#84 的 grep 验收条款）。
10. `src/utils/api-proxy.ts:107` 整条 `headers.delete("vary")` 会连带丢掉上游 `Vary: Accept-Encoding`，超出「清上游 CORS 头」口径。
11. `src/pages/api/v1/[...path].ts:78`：非 OPTIONS 的 502 复用 `buildPreflightHeaders`，套上预检专用头且丢了 `Content-Type: application/json`。
12. `ssrLocaleIsZh()` 在四个页面逐字重复、`bindPagination` 两份，与 `theme-locale.ts` 的 `resolveLocale` 单源主张相悖。
13. `admin.ts` 导入的 COUNT/SELECT/DELETE/INSERT 拼接仍在 handler 内（#101 之后新增的分层债）。
14. `seed-credential.mjs` 的 `SEED_PBKDF2_ITERATIONS` 与 `password.ts` 重复且无守卫；`randomUUID().slice(0,16)` 约 60 bit 熵，需在文档写明取舍。
15. `img_proxy.ts` 的 `sameAddressSet` 要求两解析器答案集**完全相等**，大 RRset 截断或分地域解析会被判 rebinding（面比 ADR 0007 承认的 GeoDNS 更宽）。

## 五、push 后 CI 暴露的第五条（已修）

run `43987529351`：除最后一步外全绿（含干净环境下的 Playwright 5 脚本、Pages 与 Worker 两次部署），**`Wait for deployment readiness` 36 次全 403**。

- **不是部署失败**：`/` 与 `/api/v1/health` 从本机都是 200（`{"status":"ok","db":"connected","kv":"connected"}`）；403 是 zone 边缘安全规则把 GitHub Actions 的出网 IP 判成 bot。
- **#106 的设计盲点**：探针打自定义域，等于把「边缘 WAF 策略」耦合进部署门禁；策略一变，门禁永久假红。
- **修法**：探针改为打 Pages 生产别名 `https://blog-website-page.pages.dev`（同样覆盖两条链路：`/` 验 Pages 产物，`/api/v1/health` 经同源代理验 Worker + D1/KV）；`wait-for-deploy.mjs` 遇 403 / `cf-mitigated` 时在 detail 标「边缘拦截」，不再让人往「等更久」方向排查。
- **顺带记录**：`blog-website.pages.dev` **不是本站**（返回别人的 NewsFlash 页面，pages.dev 子域全局唯一），本站别名是 `blog-website-page.pages.dev`——与「Pages 项目名 ≠ pages.dev 子域」这条历史教训同一类坑。

## 六、残余

- 自定义域是否放行 CI 出口 IP 需人工在 Dashboard 处理（wrangler OAuth 无 zone 写权限），属 #106 / H4 同一类未闭环项。

## 七、本轮的处置边界

- 已修的 4 条（+CI 暴露的第 5 条）都有**行为断言**守护，不是只改注释。
- 待办 15 条全部是「判断项 / 测试强度 / 文档口径」，不涉及线上数据安全；其中 4、12、13 已在本仓历史报告里被标注过，属同一问题的延续。
- 浏览器回归本轮**未在本机重跑**（改动集中在服务端 secret 读取与 admin 导入），由 push 后的 CI 5 脚本门禁覆盖——该门禁在 run `43987529351` 已实跑通过。
