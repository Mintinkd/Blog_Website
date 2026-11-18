# #116 复审报告：标签链接统一指向分类筛选页 + /tags 保留入口 + 文档/回归收尾

- 复审范围：`git diff e0acae8...cb5a263`
- 实施提交：`cb5a263`
- 规格来源：GitHub issue #116（Part of #115，Blocked by #117 / #118，两者已关闭）
- 固定点：`e0acae8`（#118 复审收尾）
- 复审轴：Standards（CODING_STANDARDS / README）+ Spec（#116 票面）

## Standards

### 基线坏味道（judgement calls）

**S1. Duplicated Code / Shotgun Surgery — 两处构造同款 URL。** `src/utils/tagLinks.ts:22` 与 `src/utils/taxonomyFilter.ts:53` 都写有 `?tag=${encodeURIComponent(tagSlug)}`。前者以 tag 对象为输入做「有分类 / 无分类」决策，后者以 `basePath` + `tagSlug` 做纯字符串拼接；输入与职责不同，共享的只是查询串拼接的一小段。

**S2. Data Clumps — `TagLink.category` 迫使调用方包装 `{ slug }`。** 分类预览（`taxonomyGroups.ts`）与首页热门标签（`index.astro`）需把已有 `cat.slug` 包成 `{ slug: cat.slug }`。包装点仅 2 处，且其余调用方（`group.category` / `tag.category`）天然就是对象。

### 通过项

未发现违反 CODING_STANDARDS.md 的硬规则。单源 `tagChipHref` 的命名、职责边界清晰，新 i18n 键双语同步，`tests/tag-links.test.ts` 期望值均为手写字面量，符合仓库测试约定。

## Spec

### 缺失 / 部分

**P1. 面包屑未含显式 `/tags` 节点。** 工单 §2「`/tags/:slug` 保留，面包屑与「标签不存在」空态继续指向 `/tags`」；当前 SSR 面包屑为 `首页 › slug`、客户端为 `首页 › 分类 › 标签名`，均无 `/tags` 节点；空态有 `<a href="/tags">`。

**P2. `docs/agents/testing.md` 过度承诺脚本断言。** 文档写「浏览器脚本断言标签链接无 `/tags/` 残留」，但 `scripts/verify-all-pages-nav.mjs` 本票未改、无该断言；工单测试小节也只要求四个用例「保留并通过」，未要求新增链接形态断言。

### 通过项

六处标签 chip 改点全部覆盖且规则正确（有分类 → `/categories/:cat?tag=:tag`，无分类 → `/tags/:slug`）；`/tags`、`/tags/:slug` 保留无 301；`/categories` 新增「全部标签」入口；空态指向 `/tags`；四处文档（FRONTEND_FEATURES / testing / ADR 0008 / GLOSSARY）均同步；三个单测文件期望值改对，注入字符转义由 `tag-links.test.ts` 钉住。

### 范围外改动

无。`BaseLayout.astro` 的工作区状态为 CRLF→LF 行尾规范化（`git diff` 为空），未进提交，不属本票。

## 处置

| 编号 | 处置                                                                                                                                                                                                                                                       | 提交      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| S1   | 接受：两处输入 / 职责不同，统一需让 tagLinks 反向依赖 taxonomyFilter，增加耦合；`tagLinks.ts` 正是给「标签 chip 目标 URL」这一 string 一个命名单源                                                                                                         | —         |
| S2   | 接受：包装点仅 2 处，成本低于放宽接口类型（放宽会让所有调用方类型变宽）                                                                                                                                                                                    | —         |
| P1   | 接受不修：验收项原文为「面包屑正常」，本票未改面包屑、无回归；「继续指向」指保持 `/tags` 可达，已由 `/categories` 入口 + 空态链接 + 目录页保留三处保证；面包屑 `首页›分类›标签` 是 #81 既有设计，插入 `/tags` 节点会造成两个「标签」语义重复，属范围外改造 | —         |
| P2   | 已修：`docs/agents/testing.md` 措辞改为「四个用例保留」+「链接形态由三个单测钉住、浏览器脚本不重复断言」，与脚本实际能力一致                                                                                                                               | follow-up |

## 门禁记录

- `npm test`（全量）：61 文件 687/687（修复 CRLF 检出问题后；该问题为 `core.autocrlf=true` 下 HEAD 为 LF、工作区曾为 CRLF 的环境噪声，与改动无关）
- `npm run check`：0 errors / 0 warnings / 1 hint
- `npm run lint`：通过
- `node scripts/verify-article-ssr.mjs`（PW_CHANNEL=msedge）：PASS
- `scripts/verify-all-pages-nav.mjs`：本环境 `/api/v1/*` 持续 502（无 Worker 后端），按文档属手动回归环境前置条件，未能执行；工单要求的四个用例在脚本中保留未删
- 单测聚焦：`tag-links` 3 + `article-card` 8 + `taxonomy-groups` 8 = 19 passed
