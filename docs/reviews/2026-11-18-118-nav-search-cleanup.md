# #118 复审报告：导航移除「标签」+ 搜索页去掉 taxonomy 区块

- 复审范围：`git diff fdeaf32...f0bd3a9`
- 实施提交：`f91ceb9`（功能）→ `f0bd3a9`（复审修正）
- 规格来源：GitHub issue #118
- 固定点：`fdeaf32`（#117 复审收尾）
- 复审轴：Standards（CODING_STANDARDS / AGENTS / README / docs/agents/testing / GLOSSARY / ADR）+ Spec（#118 票面）

## Standards

### 文档标准

**S1. `docs/agents/testing.md:45` — 契约面同步（judgement call）。** 该行被本次 diff 改写，新措辞必须与脚本一致，但有两处不符：

- “`/search` 只保留关键词搜索（输入框 / 结果 / 空态）”：脚本只断言 `.search-container input`，没有结果 / 空态断言。
- “#118 起另断言**每页** `.nav-links a[href="/tags"]` 为 0”：断言只覆盖 `BASELINE` 的目标页，文章 / 标签 / 分类详情路由不在其中。

### 基线坏味道（judgement calls）

**S2. Divergent Change — `scripts/verify-all-pages-nav.mjs:136-138`。** 全局导航不变量被塞进逐页内容快照（随后用于两次快照一致性比较）；导航回归会被报成「内容变化」，污染断言 B，而不是走 A1 专用断言。

**S3. Middle Man — `src/pages/search.astro:12-14`。** `.search-container` 只剩一个子节点，唯一作用是 `max-width: 640px`；`SearchBox` 自身已有 `max-width: 600px` 且自居中。该包裹层原为 `scrollIntoView` 目标与 `#search-tags` 兄弟节点存在。

**S4. 语言切换钩子整体移除。** diff 删掉了 `locale-changed` 监听与 `localeTick`。`docs/FRONTEND_FEATURES.md:85` 承诺「切换后所有页面内容实时更新」；这不是本次引入的回归（模板里的 `t()` 本来就不是响应式的，旧 tick 只喂筛选条文案），但现在组件已无任何语言切换路径，值得记录。

### 通过项

`taxonomy-filter` 事件的生产 / 消费方均已清除，`taxonomy-item` / `active-filter` 无残留消费方，删除的 i18n 键在两个语言包中均无引用，`renderTagGroups` 去掉 `mode` 后所有调用方已更新，`nav.tags` 正确保留给 `/tags/:slug` 面包屑。

## Spec

### 缺失 / 部分

**P1. “`rg "taxonomy-filter"` 在 `src/` 内无残留” 仍命中。** `src/utils/taxonomyFilter.ts:12` 仍写有 `tests/taxonomy-filter.test.ts`。它指向存活中的测试文件而非已删除的自定义事件，按字面口径 grep 不通过。

**P2. 搜索页残留无样式钩子。** `/search` 仍渲染 `<section class="search-page">`，而 `search-page` 已无任何样式选择器（`git grep search-page` 只剩这一行）。

### 范围外改动

**P3. `tests/escape-unified.test.ts` 不在票面清单内。** 从 `PAGES` 移除 `src/pages/search.astro` 是保持绿灯的必要条件（该页不再消费 `escapeHtml`），但同时也移除了该页的 #95 守卫：若将来重新引入本地 `esc`，不会失败。可接受，记录在案。

**P4. `locale-changed` 链路删除超出票面列举。** 票面要求删除 `activeFilter` / `filterLabelText` / `filterByTaxonomy` / `clearFilter` / `handleTaxonomyFilter` 及 `taxonomy-filter` 监听；`onLocaleChanged` / `localeTick` / `locale-changed` 监听不在清单内。它们只服务于已删除的筛选条文案，属必要的死代码清理；无行为回归。

`src/pages/tags/index.astro`、`src/styles/responsive.css`、`docs/agents/testing.md` 的改动是签名 / DOM 删除的调用方与清理跟进，不属范围蔓延。

### 实现正确但需留意

未发现功能性错误。逐项核对通过：五项导航、`nav.tags` 保留且仍被 `/tags/:slug` 消费；`/search` 不再请求 `/api/v1/tags` / `/api/v1/categories`；两个死键在两个语言包中已删除，`taxonomy.clear_filter` 仍被分类页使用；回归脚本快照维度、等待条件与基线符合票面；`tests/taxonomy-groups.test.ts` + `tests/escape-unified.test.ts` 17 项通过。

## 处置

| 编号 | 处置                                                                                                              | 提交      |
| ---- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| S1   | 已修：`docs/agents/testing.md` 改为「等待输入框挂载，基线要求输入框存在且无加载占位」，并明确断言只覆盖基准目标页 | `f0bd3a9` |
| S2   | 已修：导航断言移出内容快照，改为每次进入目标页单独 `page.evaluate` 取数，A1 专用失败信息                          | `f0bd3a9` |
| S3   | 保留：票面明确要求回归脚本以 `.search-container input` 为等待条件；移除包裹层会改掉该契约，且当前无功能问题       | —         |
| S4   | 接受：旧 tick 只服务筛选条文案，删除后无行为回归；语言实时切换问题在 `t()` 层，属 #115 后续范围                   | —         |
| P1   | 接受：命中项是存活测试文件名，不是事件残留；改注释会丢失有价值的具体路径                                          | —         |
| P2   | 不修：`search-page` 类为存量死钩子，本次未引入；删除属额外范围                                                    | —         |
| P3   | 接受：移除守卫是「页面不再从 API 渲染 HTML」的必然结果                                                            | `f91ceb9` |
| P4   | 接受：无行为回归，见 S4                                                                                           | `f91ceb9` |

## 门禁记录

- `npm run check`：0 errors / 0 warnings
- `npm run lint`：通过
- `npx vitest run tests/taxonomy-groups.test.ts tests/escape-unified.test.ts`：17 passed
- `npm test`（全量）：682 passed；2 failed 为 `tests/base-layout-modules.test.ts` 的 CRLF 检出环境问题（`\n` 正则对 CRLF 工作区不匹配），已在未改动树（`git stash`）上复现，与本次改动无关
- `node scripts/verify-article-ssr.mjs`：PASS（服务端正文 / 无 JS / motion 兜底 / 404 / 502）
- 本地 mock Playwright 验收：导航 5 项且无 `/tags`；`/search` 仅请求关键词搜索，无 tags / categories；结果、空态、分类 badge 正常；375 / 768 / 1024px 无横向滚动；控制台无报错
- `scripts/verify-all-pages-nav.mjs`：本环境到远端 API 持续 502（首页文章网格超时），按文档属手动回归的环境前置条件，未能执行
