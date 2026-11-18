# 分类页 `?tag=` SSR 筛选复审（#117，2026-11-18）

- **范围**：`9285a5a...HEAD`（`a706a89` 实现提交 + 本复审修复提交）
- **方法**：Standards 轴 + Spec 轴两个只读子代理并行；findings 由主代理逐条复核后处置
- **结果**：9 条有效发现，7 条已修；2 条经核对为规范明确允许的行为，记录为「保留」
- **门禁**：`npx vitest run` 680 passed / 2 failed（`tests/base-layout-modules.test.ts`，CRLF 检出导致的正则不匹配，改动前即存在）；`npm run check` 0 errors；`npm run lint` 0 problem；Playwright（msedge）12 项筛选 / 非法值 / 禁用 JS / 375px 断言全绿

## 一、已修

| #   | 位置                                                                      | 问题                                                                                                                  | 处置                                                                                                    |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `src/utils/taxonomyFilter.ts:1-7`、`tests/taxonomy-filter.test.ts:1-7`    | 文件头仍只描述 URL 契约，与新增的 chip / 空态 / query 渲染不符（契约面同步）                                          | 两处文件头改为列出三个共享面与共用理由                                                                  |
| 2   | `docs/FRONTEND_FEATURES.md` 新增段                                        | 「禁用 JS 也能完成筛选」过宽：分页仍是 `<button>`，无 JS 时第 2 页不可达                                              | 收窄为「无 JS 时点击 chip 走整页导航完成标签切换（分页按钮仍为客户端交互）」                            |
| 3   | `categories/[slug].astro` SSR 空态 vs 客户端空态                          | 同一段 HTML 写两份，SSR 硬编码中文、客户端走 `t()`，正是 chip 抽取要防的漂移                                          | 抽 `renderFilteredEmpty`（`taxonomyFilter.ts`），两处共用；补字面量单测                                 |
| 4   | `categories/[slug].astro:29/403/419`、`taxonomyFilter.ts` chip 渲染       | 「tag 是否属于本分类」判断复制 3 次，渲染器内部还有第 4 份                                                            | 抽 `resolveActiveTagSlug`，SSR / 首屏 URL 清洗 / `popstate` / 渲染器共用                                |
| 5   | `taxonomyServer.requestUrl` vs 客户端 `loadArticles`                      | `/articles` query 两处手工拼接（`page` / `category_slug` / `tag_slug`），加参数要改两处                               | 抽 `buildCategoryArticlesQuery`，服务端与客户端共用；补编码用例                                         |
| 6   | `taxonomyServer.ts:16`、`categories/[slug].astro` 客户端 `knownTags` 类型 | chip 形状声明三次（`FilterChipTag` / `TaxonomyItem` / 内联结构类型）                                                  | `TaxonomyItem extends FilterChipTag`；客户端改用 `FilterChipTag[]`                                      |
| 7   | `categories/[slug].astro` 客户端 `syncFilterUi`                           | 一行转发到 `renderFilterChipsUi`，两个名字一个动作                                                                    | 删除 `syncFilterUi`，直调 `renderFilterChipsUi`                                                         |
| 8   | `categories/[slug].astro` SSR 空态                                        | SSR 输出的「清除筛选」链接没有客户端监听：有 JS 时点击会整页刷新，与「保留局部刷新」不符                              | 抽 `bindClearFilter`（带 `data-bound` 防重复），SSR 空态与客户端重新渲染后都绑定                        |
| 9   | `taxonomyServer.ts` 文章内嵌 tag 的 `category`                            | `slug: String(tag.category.slug ?? "")` 会把「有 category 但无 slug」映射成 `""`，`articleCard` 仍判为跨分类          | 改为 `name` 与 `slug` 都是 string 才接受该 category，否则 `null`                                        |
| 10  | `scripts/verify-all-pages-nav.mjs` 禁用 JS 断言                           | 重复声明选择器且只断言 `active === 1`，「全部」chip 也能过——SSR 忽略 `?tag=` 时回归不会变红；375px 目标也未含筛选 URL | 复用 `contentCheck`，追加 `activeFilterTags[0] === slugs.tagOfCat`；`mobileTargets` 加入 `?tag=` 筛选页 |

## 二、保留（经核对不属于缺陷）

- **非法 `?tag=` 的清理只在客户端、且依赖 `/tags` 成功**：条目 #117 明确写「非法 / 不属于本分类 → 按「全部」渲染，客户端 `replaceState` 清参（与现有行为一致）」，故不引入服务端 3xx 重定向。无 JS 时 URL 保留脏参数，但页面内容与 API 请求均为「全部」，与规范一致。
- **文章内嵌 tag 的 `category` 映射暂未被卡片消费**：规范要求「补 `category` 映射，供 SSR 卡片生成分类筛选链接」，但「不改标签页 `/tags/:slug`（由子票 C 处理链接与归属）」是非目标；映射作为子票 C 的输入保留，卡片链接行为不变。
- **`verify-all-pages-nav.mjs` 选 tag 改为 `article_count > 0`**：原用例可能选中零文章标签，使「卡片已渲染」断言天然无法成立；改为可渲染标签后仍覆盖同一 URL 契约。

## 三、门禁记录

- `npx vitest run tests/taxonomy-server.test.ts tests/taxonomy-filter.test.ts tests/article-card.test.ts`：34 passed
- `npm run check`：194 files，0 errors / 0 warnings
- `npm run lint`：0 problem
- 本地 Astro dev + mock Worker（`ARTICLE_API_ORIGIN`）Playwright 验证：
  - SSR 首屏即筛选（`?tag=vue` 只含 Vue 文章）
  - chip 点击 `pushState` + 局部刷新，恰一个 `aria-current="page"`
  - 非法 `?tag=` 回「全部」、URL 清参、无 `tag_slug=` 无效请求
  - 筛选空态 SSR 文案 + 清除链接局部刷新
  - 禁用 JS：chip 整页导航后 SSR 输出筛选结果，恰一个 `aria-current`
  - 375px：横向溢出 0px（含 `?tag=` 页）
- 已知环境问题（与本改动无关）：`tests/base-layout-modules.test.ts` 2 项因 `core.autocrlf=true` 检出 CRLF、正则按 LF 匹配而失败；pre-commit 的 worker 测试因 Node 22.12.0 无 `node:sqlite` 失败。
