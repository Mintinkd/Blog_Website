# 代码审查报告：M17 分类/标签页 SSR 首屏（issue #97）

**日期**：2026-11-16
**固定点**：`7d67939`（改动前 HEAD）
**审查范围**：`git diff 7d67939...HEAD`（提交 `e0e99f9` 实现 + follow-up 修复）
**双轴**：Standards + Spec，并行子代理独立审查。

---

## Standards

**HARD（2 项，均已修）**：

1. `README.md` 前台页面表被破坏——7 行路由（`rss.xml` 等）被卷入 `>` 引用块、丢失渲染模式列。→ 恢复表格行，引用块移到表后。
2. i18n 首屏永久中文：`data-ssr=1` 跳过首次 fetch，SSR 卡片 label/日期硬编码中文且无 `data-i18n`，`initLocale`（异步 dynamic import）不派发 `locale-changed` → 英文用户首屏永久中文。→ 四页面 page-load 逻辑改：同步读 `localStorage`/`navigator.language` 判断，非中文时 `initLocale()` + 主动刷新套用正确文案。

**JUDGEMENT（3 项）**：

| #   | finding                                                                            | 处置                                                                                    |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | empty 时 data-ssr 不一致（index=0 冗余 fetch，详情=1 且 error 也显示「暂无文章」） | **已修**：index empty 也设 1；详情 error 不写首屏内容（留空由客户端显示加载失败）       |
| 2   | `totalPages` 缺 `Number.isFinite`，NaN 产出「1 / NaN」                             | **已修**：加 finite 守卫 + Math.floor                                                   |
| 3   | `taxonomyRender.loadFailed` 未消费                                                 | **已修**：删字段与 4 处传参                                                             |
| 4   | 「非 JS 抓取器可见」仅人工 curl、无自动化断言                                      | **接受**：testing.md 如实说明，CI 的 `verify-all-pages-nav.mjs` 覆盖这些页面导航/加载态 |

**最严重（Standards）**：HARD-2 英文首屏永久中文（已修）。

---

## Spec

**(a) 验收缺失/部分**

- 「关闭评论记录方案选择、理由与代价」：README 已补代价（每次访问多一次服务端同步 fetch Worker、8s 超时影响 TTFB），关票评论完整记录。

**(b) scope creep**

- 无。worker handlers / BaseLayout / 文章详情 SSR 均未改；四页 `prerender=false` 保留。

**(c) 实现有误**

- **分页失效（最严重）**：SSR 首屏输出 `.pag-btn`，但 click 绑定只在 `loadArticles()` 成功分支内执行；`data-ssr=1` 跳过首次 fetch → 按钮无事件。→ **已修**：`bindPagination()` 独立成函数，用 `data-bound=1` 防重复绑定，page-load 首屏时也调用。
- i18n 文案回归 → 已修（见 Standards HARD-2）。
- README 表破损 → 已修。

**核对通过**：四页服务端真实产出（人工 curl + mock API：容器含真实数据、无 loading 残留）；客户端交互（分页绑定 / 语言切换刷新）修复后正常；`check` 0 errors、48 files/543 tests 全绿、build EXIT=0。

**最严重（Spec）**：分页按钮首屏失效（已修）。

---

## 门禁（修复后）

- 根包：48 files / 543 tests PASS；`npm run check` 0 errors / 0 warnings / 8 hints；build EXIT=0。
- SSR 首屏实测：`node .workbuddy/tmp/check-ssr.mjs` 四页面 marker=true / stillLoading=false。
