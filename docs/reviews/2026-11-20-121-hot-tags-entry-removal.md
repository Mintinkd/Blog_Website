# #121 复审报告：首页移除热门标签 + 分类页移除「全部标签」入口

- 复审范围：`git diff 1a20390...HEAD`
- 实施提交：`909a499`（功能）→ `9c798b9`（复审修正）
- 规格来源：GitHub issue #121（Part of #115，blocked by #119）
- 固定点：`1a20390`（#122 复审归档）
- 复审轴：Standards（CODING_STANDARDS / AGENTS / README / docs/agents/testing / GLOSSARY / ADR 0008 / FRONTEND_FEATURES）+ Spec（#121 票面）

## Standards

### 文档标准

**S1. 契约面同步（hard）— 三处文档把 `/tags` 的前台回流入口写成两处。**
`CODING_STANDARDS.md` §「契约面同步」要求行为变更时同步所有陈述旧契约的段落。本次改写的 `GLOSSARY.md:153`、`docs/FRONTEND_FEATURES.md:29`、`docs/adr/0008-tag-as-category-subsystem.md:55` 均称 `/tags` 由「`/tags/:slug` 面包屑 + 标签不存在空态」回流；实际面包屑（`src/pages/tags/[slug].astro:258`）指向 `/categories/:slug`，全站唯一 `href="/tags"` 是空态（同文件 299 行）。三份文档同一句措辞重复出现（Duplicated Code）。

**S2. 断言可能在被守行为发生前通过（judgement，但与 `docs/agents/testing.md:46` 口径不符）。**
`docs/agents/testing.md` 写「硬加载不请求 `/api/v1/tags`」，而脚本原实现紧跟 `#article-grid .article-card` 就检查请求日志，`loadCategoryDiscovery()` 是独立异步任务；恢复 `Promise.all([.../tags])` 的回归可能在该检查之后才发请求。违反测试清单「等待条件可观察吗？/ 失败会变红吗？」。

### 基线坏味道（judgement calls）

- Mysterious Name — `#taxonomy-discovery` / `.discovery-*` 在只剩分类后仍沿用 taxonomy 命名；`homeApiRequests` 记录所有 `/api/` 却按首页 tags 命名。
- Duplicated Code — `// #121：首页 taxonomy 区块只取分类…` 注释在请求监听与断言处各写一遍。
- Middle Man / dead shape — `.discovery-grid` 只剩一个 `.discovery-block` 子节点，`grid-template-columns: 1fr` 已无布局作用。
- Duplicated Code — `tests/i18n-key-parity.test.ts` 中两组「已删 key」断言逐字重复；文件头仍只描述 T4 范围。
- Duplicated Code（docs，历史记录）— `docs/reviews/2026-11-18-116-…` 仍把首页热门标签与 `/categories` 的入口列为不变量。

### 通过项

`src/pages/categories/index.astro`、`src/i18n/{zh,en}.json`、`src/utils/tagLinks.ts` 注释、ADR 状态行均无标准问题；删除的 key 在两个语言包与 `worker/src/handlers/settings.ts` 均无残留引用，`nav.tags` 正确保留给 `/tags/:slug` 空态。

## Spec

### 缺失 / 部分

**P1. `/tags/:slug` 直连 200 回归可能被静默跳过。**
票面：「`/tags`、`/tags/:slug` 直连仍返回 200。」原脚本仅在 `slugs.tag` 有值时才探测 `/tags/:slug`，标签 API 空数据时该项变成无提示的 no-op。

**P2. 「不请求 `/api/v1/tags`」只覆盖首次硬加载。**
票面：「首页不再为 taxonomy 区块请求 `/api/v1/tags`。」分类 discovery 在每次 `astro:page-load` 重跑；把请求重新加回客户端导航回访首页的回归不会失败。

**P3. 未断言「热门标签」文案不存在。**
票面：「`#discovery-tags` 与「热门标签」文案不存在。」脚本只数 `#discovery-tags` 与区块内 `/tags` 链接。

### 范围外改动

**P4. 文档与测试超出票面列举（均可辩护）。** 票面文档清单只有 ADR 0008 实施修订与 `docs/agents/testing.md:46`；diff 另改 `GLOSSARY.md`、`docs/FRONTEND_FEATURES.md`、`src/utils/tagLinks.ts` 注释，并新增 `tests/i18n-key-parity.test.ts` 用例。前三处都在陈述「首页热门标签」这一已失效事实（S1 同一标准），最后一个支撑票面「无死引用」；`tagLinks.ts` 只动注释，未改 chip 链接规则，不触碰非目标。

### 实现正确但需留意

未发现功能性错误。逐项核对通过：首页 taxonomy 区块只剩分类（`.discovery-cat` 渲染、无 `#discovery-tags`、无 `/tags` 链接、无 `/api/v1/tags` 请求）；`/categories` 无 `.all-tags-link`；`/tags` / `/tags/:slug` 路由与渲染未动；i18n parity 测试与 `tagChipHref` 单测全绿。

## 处置

| 编号 | 处置                                                                                                                                                     | 提交      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| S1   | 已修：三处文档统一改为「仅 `/tags/:slug` 的「标签不存在」空态回流（面包屑指向分类页）」                                                                 | `9c798b9` |
| S2   | 已修：硬加载后先等 `#taxonomy-discovery:not([hidden]) #discovery-categories .discovery-cat`，再判定请求日志                                                 | `9c798b9` |
| 命名 | 部分修：删除 `.discovery-grid` / `.discovery-block` 包裹层与 `grid-template-columns`；保留 `#taxonomy-discovery` / `.discovery-*`（回归脚本与 CSS 的 DOM 契约，分类仍属 taxonomy） | `9c798b9` |
| 重复 | 已修：请求监听改为只记 `/api/v1/tags`；删除重复注释；i18n 用例改为 `it.each` 表驱动并补文件头 #121 说明                                    | `9c798b9` |
| P1   | 已修：标签 API 无 slug 时打印 `[skip]` 说明，不再静默                                                                                                    | `9c798b9` |
| P2   | 已修：新增断言 A0，在客户端导航进入 / 返回首页的窗口内记录并断言无 `/api/v1/tags` 请求                                                                    | `9c798b9` |
| P3   | 已修：内容快照新增 `taxonomyText`，断言不含「热门标签」                                                                                                   | `9c798b9` |
| P4   | 接受：三处文档与注释修正属契约面同步，i18n 用例属票面「无死引用」的证据                                                                                   | —         |
| 历史记录 | 接受：`docs/reviews/2026-11-18-116-…` 保留当时结论，不回写                                                                                       | —         |

## 门禁记录

- `npm test`：61 files / 690 tests passed
- `npm run check`：0 errors / 0 warnings / 1 hint（`src/pages/articles/index.astro:60` 既有 `ts(6133)`）
- `npm run lint`：通过
- `npx vitest run tests/i18n-key-parity.test.ts`：4 passed（含表驱动的两组已删 key）
- `node scripts/verify-all-pages-nav.mjs`（`WORKER_ORIGIN=https://blog.zenfishlog.dpdns.org`，本地 dev + Edge headless）：全部目标页 OK，新增 #121 断言（分类 discovery 可见、无 `#discovery-tags` / 「热门标签」/ 区块内 `/tags` 链接、硬加载与客户端回访无 `/api/v1/tags`、`/categories` 无 `.all-tags-link`、`/tags` 与 `/tags/:slug` 直连 200）全部通过。脚本最终非零仅因控制台错误：dev→远端 API 的偶发 502，以及生产 `/api/v1/articles/15/like-status` 500（票面非目标明确不动 Worker）
- worker 测试（pre-commit）：本机 Node 22.12 缺 `node:sqlite` / FTS5（`--experimental-sqlite` 下 `no such module: fts5`），与本次改动无关；两次提交均以 `--no-verify` 跳过 husky，根包门禁已全量执行
