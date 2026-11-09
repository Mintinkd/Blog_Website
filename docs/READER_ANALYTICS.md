# 阅读统计设计：口径、分层采集与后台视图

状态：设计稿，已定稿（对应 ADR `docs/adr/0005-reader-analytics-aggregate-first.md`，尚未实施）。

**实施范围：仅 Tier 0。** Tier 1（§8）不在这批工单内；先按 §9 第 7 步观察两周数据，再单独评估，不预建 Tier 1 工单。

**2026-11-04 评审已关闭 §11 的全部待定项。** 其中三条修正了原稿：计数观测点位于 SSR 代理链路（§1、§3、§4），时区为常量（§11），维度桶只写单篇行（§5、§11）。

目标：把「阅读量」从一个只增不减的累计数，变成**可解释、可校验、按天可回溯**的统计；同时明确哪些读者维度采、哪些不采，以及后台分别怎么展示。

非目标：识别具体读者、跨会话追踪、跨设备关联、把统计结果用于个性化推荐或广告。

---

## 1. 现状与问题

计数入口：`GET /api/v1/articles/:slug` → `handleGetArticle` → `incrementViewCount`。

| 现状                                                            | 问题                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| 只按 `view_<id>` Cookie 去重，`Max-Age=86400`                   | 清 Cookie、换浏览器、换设备都会重计；同一人一天内可计多次 |
| 直接 `UPDATE articles SET view_count = view_count + 1`          | 只有累计值，没有时间序列，无法看趋势、无法发现刷量        |
| 未区分请求来源                                                  | `curl`、爬虫、社交卡片抓取、浏览器预取全部计数            |
| 草稿预览也走同一路径（`article.ts:106` 在 status 判断之后执行） | 管理员/作者每次预览草稿都会 +1                            |
| 无任何维度                                                      | 回答不了「移动端占多少」「从哪来」「读完没有」            |

另一处原稿未覆盖的事实：详情页是 **SSR 请求时渲染**（`prerender = false`），计数请求由 Pages 的 SSR 层发起，当前只转发 `Cookie` 与 `X-Real-IP`。因此 `User-Agent`、`Accept`、`Referer`、`Sec-Fetch-*`、`CF-IPCountry` 在 Worker 侧都不可见，且 `CF-Connecting-IP` 是 Pages 的出口地址而非访客地址。Tier 0 的过滤、维度与去重键都依赖这一跳的转发契约（§3、§4）。

结论：准确性问题主要是**计数工程**问题，不是「认不出人」。

---

## 2. 统计口径

| 指标           | 定义                                                               | 计算位置          |
| -------------- | ------------------------------------------------------------------ | ----------------- |
| `PV`           | 对已发布文章返回 200 的详情请求次数；仅计 SSR 代理链路、过滤后     | Worker 请求路径   |
| `requests`     | 同上，但**含直连 API** 的 200；作为代理覆盖率的分母                | Worker 请求路径   |
| `UV`           | 当日去重访客数；同一去重键当日只计一次                             | Worker 请求路径   |
| `代理覆盖率`   | `PV / requests`；低于 90% 说明 SSR 转发链可能断开                  | 后台查询时计算    |
| `有效阅读`     | 页面可见时长 ≥ 15s **且** 最大滚动 ≥ 50%，每访客每文章每日最多一次 | Tier 1 beacon     |
| `有效阅读率`   | `有效阅读 / UV`                                                    | 后台查询时计算    |
| `bot_filtered` | 被规则判定为机器人/预取而丢弃的请求数                              | Worker 请求路径   |
| `同意率`       | `接受统计类 / 弹窗曝光数`                                          | Tier 1 同意凭证表 |

- 日界按站点时区（常量 `Asia/Shanghai`）切分，D1 存 `YYYY-MM-DD` 字符串。
- `PV` 与 `UV` 都只统计 `status = 'published'` 的文章；草稿预览一律不计数。
- 无 JS 的访客会计入 `PV`/`UV`，但不会产生「有效阅读」。后台需标注该偏差，不用它推算总量。
- `PV` 的计数点在 Worker 返回 200 时，不等待 SSR 渲染完成；SSR 随后的解析失败或 502 不会回滚已计的 PV。

---

## 3. 分层

### Tier 0｜无需同意的聚合基线（默认开启）

不新增任何设备端标识、不需要同意弹窗；IP 只作为 HMAC 输入，明文不落库。现有 `view_<id>` Cookie 沿用为去重快路径（§11 已定：保留，并加 `HttpOnly`）。

Tier 0 的所有维度都来自 SSR 转发的白名单请求头：`User-Agent`、`Accept`、`Referer`、`Accept-Language`、`Sec-Fetch-Mode`、`Sec-Fetch-Dest`、`Sec-Purpose`、`Purpose`、`Sec-CH-UA*`、`X-Real-IP`，以及由 `CF-IPCountry` 映射的 `X-Visitor-Country`。转发头按 advisory 数据处理，不另加共享密钥：直连 Worker 的请求本来就能伪造 UA/Referer，加密钥只能防自欺，却要引入 Pages↔Worker 的轮换面。

| 维度     | 数据来源                                            | 识别/处理逻辑                                       | 对准确性的作用                                   | 形态与保留                     |
| -------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| 访问计数 | Worker 请求路径（仅带 `X-Real-IP` 的 SSR 详情请求） | 每个 published 文章每次通过过滤的请求 +1            | 基准 PV                                          | `(article_id, day)` 聚合，长期 |
| 去重访客 | `X-Real-IP` + `User-Agent` + `article_id` + 日期    | `HMAC-SHA256(secret, ...)` 得令牌；24h 内重复即丢弃 | 消除刷新/多标签重复；Cookie 被清也能兜住         | 令牌表 24h，到期删除           |
| 来源     | `Referer`                                           | 只取域名，剥掉 path/query；同站记为 `internal`      | 区分站内跳转与外部引流，避免把站内点击算成新读者 | 每日桶计数，400 天             |
| 地区     | `X-Visitor-Country`（SSR 转发 `CF-IPCountry`）      | 国家两位码；不保留省级/地区                         | 读者构成；不参与去重                             | 每日桶计数，400 天             |
| 设备类别 | UA-CH `Sec-CH-UA-Mobile`，回退 UA 解析              | `desktop / mobile / tablet / unknown`               | 发现移动端预取、桌面端爬虫占比异常               | 每日桶计数，400 天             |
| 机器人   | UA、`Sec-Fetch-*`、`cf.botManagement`               | 见 §4                                               | 直接决定 PV 是否虚高                             | 单独计数                       |

### Tier 1｜同意后（默认关闭）

只在分类同意后采集，且**只落桶计数**。设备端不生成任何持久 ID。

| 维度              | 数据来源                                                   | 识别/处理逻辑                                         | 对准确性的作用                   | 形态与保留 |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- | ---------- |
| 浏览器族 + 大版本 | UA-CH `Sec-CH-UA`，回退 UA                                 | 归一到 `chrome/safari/firefox/edge/other` + 版本分档  | 兼容性分布；不能提升 UV 准确度   | 每日桶计数 |
| OS 族 + 大版本    | UA-CH `platform`                                           | `windows/macos/ios/android/linux/other`               | 同上                             | 每日桶计数 |
| 屏幕              | `screen.width`（CSS px）                                   | 分档：`≤360 / 361–768 / 769–1280 / 1281–1920 / >1920` | 辅助判断「有效阅读」阈值是否合理 | 每日桶计数 |
| 语言              | `Accept-Language` 首选项                                   | 归一到 `主语言-地区`                                  | 读者构成                         | 每日桶计数 |
| 停留时长          | `visibilitychange` + 累计可见毫秒                          | 分档：`<15s / 15–60s / 1–5min / >5min`                | 过滤秒退，支撑有效阅读           | 每日桶计数 |
| 最大滚动          | `scroll` 取最大 `scrollTop / (scrollHeight - innerHeight)` | 分档：`<25% / 25–50% / 50–75% / 75–100%`              | 同上                             | 每日桶计数 |
| 完整来源页        | `Referer`                                                  | 保留域名 + path，剥掉敏感 query                       | 比 Tier 0 的域名粒度更细         | 每日桶计数 |

上报方式：页面隐藏或卸载时 `navigator.sendBeacon('/api/v1/analytics/engagement', ...)`，失败静默，不重试、不排队。

### 明确不采集

| 项                                           | 理由                                               |
| -------------------------------------------- | -------------------------------------------------- |
| canvas / WebGL / audio / 字体枚举 / 插件列表 | 唯一用途是跨会话关联；对「读了多少人」没有增量信息 |
| 精确经纬度、GPS                              | 与统计目的不成比例，且属敏感个人信息               |
| 跨天稳定的 `visitor_id`                      | 把匿名统计变成长期画像                             |
| 跨设备/跨浏览器关联                          | 同上                                               |
| 登录痕迹、社交授权信息                       | 属于账号画像，与阅读数无关；且需单独同意           |
| 单个访客的时间线/明细                        | 后台不提供，避免把聚合系统变成监控系统             |

---

## 4. 过滤与去重逻辑

### 4.1 机器人 / 非阅读请求

按顺序判定，命中即丢弃并计入 `bot_filtered`：

1. 方法不是 `GET`；
2. `Sec-Purpose: prefetch` / `Purpose: prefetch` / `X-Purpose: preview`（SSR 白名单同时转发 `X-Purpose`）；
3. `Sec-Fetch-Mode` 存在且不是 `navigate`；
4. UA 缺失，或命中爬虫/预览正则（`bot|crawler|spider|preview|headless|curl|wget|python-requests|Go-http-client|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|WhatsApp|Discordbot|Pinterest`）；
5. `cf.botManagement.verifiedBot = true`；
6. `cf.botManagement.score < 30`（无 Bot Management 时跳过此条）；
7. `Accept` 不含 `text/html`。

> 规则改动必须同时更新 `bot_filtered` 的解释文案；否则「过滤量突增」会被误读成流量异常。

本部署为免费版，`cf.botManagement` 不可用（Bot Management 为付费项），规则 5/6 保留为守卫分支、永不触发；`bot_filtered` 的解释文案需注明。

未携带 `X-Real-IP` 的请求（直连 API）不产生 `pv`/`uv`，只在通过上述规则后累加 `requests`；被规则丢弃的直接请求不计 `requests`、也不计 `bot_filtered`——它们不在观测链路上，不是「被判定的机器人」。

### 4.2 去重

```
1. 若请求带 view_<id> Cookie → 已计过，直接跳过（快路径，不写库）
2. 否则计算 token = HMAC-SHA256(secret, X-Real-IP + UA + article_id + day)
3. 查 analytics_view_token；存在 → 跳过
4. 不存在 → D1 batch：插入 token(expires_at = now + 24h) + 日聚合 pv/uv/requests +1 + 累计 view_count +1
5. 响应仍下发 view_<id> Cookie（保持现状，减少后续请求的 D1 写）
```

去重键必须用 SSR 转发的 `X-Real-IP`：SSR→Worker 这一跳的 `CF-Connecting-IP` 是 Pages 的出口地址，用它会把同一 POP 的所有访客合并成一个人。D1 没有交互式事务，第 4 步用 `batch()` 保证原子性。

已知取舍：

- 同一 NAT 出口 + 同一 UA 的多个用户会被合并成 1 个 UV（低估）；个人博客可接受，需在文档写明。
- 同一用户换 UA（浏览器升级）会多算 1 次；换日会重新计 1 次，符合「24 小时」口径。
- 令牌表需定时清理（每日 cron，见 §9），避免无限增长。

### 4.3 有效阅读

- 计数条件：`document.visibilityState === 'visible'` 的累计时长 ≥ 15s，且最大滚动比例 ≥ 50%。
- 服务端再校验一次 `dwell` / `scroll` 落在合法区间，非法直接丢弃。
- 同一 `(article_id, day, token)` 只记一次，超出即忽略。

---

## 5. 数据模型（D1）

```sql
-- 每日文章聚合：趋势与后台主查询来源
CREATE TABLE IF NOT EXISTS analytics_article_daily (
  article_id  INTEGER NOT NULL,
  day         TEXT    NOT NULL,              -- YYYY-MM-DD，站点时区
  pv          INTEGER NOT NULL DEFAULT 0,
  uv          INTEGER NOT NULL DEFAULT 0,
  requests    INTEGER NOT NULL DEFAULT 0,    -- 含直连 API 的过滤后 200，用于代理覆盖率
  engaged     INTEGER NOT NULL DEFAULT 0,
  bot_filtered INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, day)
);

-- 24h 去重令牌：不含 IP 明文
CREATE TABLE IF NOT EXISTS analytics_view_token (
  token      TEXT PRIMARY KEY,               -- HMAC hex
  day        TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_view_token_expires
  ON analytics_view_token(expires_at);

-- 维度桶：只写单篇行；全站视图由查询时 GROUP BY 聚合
CREATE TABLE IF NOT EXISTS analytics_dim_daily (
  day        TEXT    NOT NULL,
  dim        TEXT    NOT NULL,               -- device|browser|os|country|language|screen|referrer|dwell|scroll
  bucket     TEXT    NOT NULL,
  article_id INTEGER NOT NULL,               -- 所属文章；不写全站行
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dim, bucket, article_id)
);

CREATE INDEX IF NOT EXISTS idx_dim_daily_lookup
  ON analytics_dim_daily(day, dim);

-- 同意凭证（仅 Tier 1）：合规证据，不参与分析查询
CREATE TABLE IF NOT EXISTS analytics_consent (
  id          TEXT PRIMARY KEY,              -- 随机 UUID，不含访客 ID
  version     TEXT NOT NULL,                 -- 政策/文案版本
  scope       TEXT NOT NULL,                 -- JSON: {"analytics":true}
  decided_at  TEXT NOT NULL,
  withdrawn_at TEXT
);
```

- 不建 `visitors` 表，不存 IP/UA 明文。
- `analytics_consent` 仅 Tier 1 使用，本批不建。
- `analytics_dim_daily` 只写单篇行；全站分布由 `GROUP BY bucket` 聚合，不再维护 `article_id = 0` 的双写。
- `site_config` 新增两键：`analytics_hmac_secret`（首次使用时懒生成，**不复用** `jwt_secret`）与 `analytics_last_job_at`（清理任务心跳，加入备份导出跳过名单）。
- 保留期：令牌 24h；维度桶与日聚合 400 天，由每日 cron 删除；同意凭证按合规要求单独保留。

---

## 6. 接口

| 方法   | 路径                                                      | 说明                                                           |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------- |
| `GET`  | `/api/v1/articles/:slug`                                  | 现有接口；内部接入 Tier 0 计数与过滤，响应契约不变             |
| `POST` | `/api/v1/analytics/engagement`                            | Tier 1 beacon；要求 `analytics_consent` 同意 Cookie；204，限流 |
| `GET`  | `/api/v1/admin/analytics/overview?range=7d`               | 概览卡                                                         |
| `GET`  | `/api/v1/admin/analytics/articles?range=7d&page=1`        | 文章明细表                                                     |
| `GET`  | `/api/v1/admin/analytics/dimensions?dim=device&range=30d` | 分布；省略 `article_id` 表示全站聚合                           |
| `GET`  | `/api/v1/admin/analytics/quality?range=7d`                | 数据质量面板                                                   |
| `GET`  | `/api/v1/admin/analytics/consent?range=30d`               | 同意率（Tier 1）                                               |

后台接口全部走现有 auth 中间件，且要求 `admin` 角色（统计是站级数据，不对 editor 开放）。`range` 只接受 `today|7d|30d|90d`，非法值 400。

---

## 7. 后台页面设计

位置：`src/admin/App.vue` 新增 `currentTab === 'analytics'` 面板 + 侧栏「统计」项；文案走 `t()`，中英文同步。

### 7.1 顶部筛选条

| 控件     | 取值                                               | 默认    |
| -------- | -------------------------------------------------- | ------- |
| 时间范围 | 今日 / 近 7 天 / 近 30 天 / 近 90 天               | 近 7 天 |
| 文章     | 全部 / 单篇（可搜索）                              | 全部    |
| 数据时间 | 只读文本：`更新于 HH:mm`（最近写入或清理任务心跳） | —       |

### 7.2 概览卡（全量 6 张；Tier 0 可见 3 张）

| 字段         | 口径                        | 空态          |
| ------------ | --------------------------- | ------------- |
| `PV`         | 过滤后渲染次数              | `—`（无数据） |
| `UV（估算）` | 当日去重访客合计            | `—`           |
| `有效阅读`   | 仅 Tier 1；未开启时整卡隐藏 | —             |
| `有效率`     | 仅 Tier 1；未开启时整卡隐藏 | —             |
| `过滤 bot`   | `bot_filtered` 合计         | `0`           |
| `同意覆盖率` | 仅 Tier 1；未开启时整卡隐藏 | —             |

### 7.3 趋势图

- 双线：`PV` / `UV`，按日；范围跟随筛选条。
- 悬停显示当日数值与 `bot_filtered`。
- 少于 2 天数据时显示「数据积累中」，不画 0 值折线。
- 手写 SVG，不引入图表库。

### 7.4 文章表

| 列         | 字段                      | 说明                        |
| ---------- | ------------------------- | --------------------------- |
| 标题       | `articles.title`          | 点击跳文章页                |
| `PV`       | `SUM(pv)`                 | 默认降序                    |
| `UV`       | `SUM(uv)`                 |                             |
| 有效阅读率 | `SUM(engaged)/SUM(uv)`    | 仅 Tier 1；未开启时隐藏该列 |
| 平均停留档 | 由 `dwell` 桶加权求中位档 | 仅 Tier 1；未开启时隐藏该列 |
| 来源 Top1  | `referrer` 桶最大值       | 显示域名                    |
| 7 日趋势   | 内联 sparkline            | 数据点 < 2 隐藏             |

分页 20 条；空态「该时间段暂无阅读数据」。表头标注「自 `MIN(day)` 起」；`MIN(day)` 为空时不显示该标注。

### 7.5 分布区（Tier 0：2 图 + 1 表；Tier 1 增补 2 图）

| 图     | 维度       | 展示                                                  |
| ------ | ---------- | ----------------------------------------------------- |
| 设备   | `device`   | 桌面 / 移动 / 平板 / 未知，百分比 + 计数              |
| 浏览器 | `browser`  | 仅 Tier 1；未开启时隐藏                               |
| 系统   | `os`       | 仅 Tier 1；未开启时隐藏                               |
| 地区   | `country`  | 国家两位码 + 名称，Top 8                              |
| 来源   | `referrer` | 表格：来源域名 / 访问数 / 占比（有效阅读率仅 Tier 1） |

小样本保护：任一桶计数 < 5 时合并进「其他」；某维度总样本 < 20 时整块显示「数据不足」，不显示百分比。

### 7.6 数据质量面板

| 指标         | 含义                    | 告警阈值                      |
| ------------ | ----------------------- | ----------------------------- |
| 过滤 bot     | 被规则丢弃的请求数      | 占原始请求 > 40% 时标黄       |
| 代理覆盖率   | `pv / requests`         | < 90% 标黄（转发链可能断开）  |
| 清理任务心跳 | `analytics_last_job_at` | > 26 小时标红                 |
| 异常波动     | 当日 PV 与 7 日均值偏差 | > 3σ 标黄，附「可能被刷」提示 |
| 令牌表行数   | 清理任务是否正常        | > 10 万标黄                   |

### 7.7 同意面板（仅 Tier 1）

版本 / 曝光数 / 接受率 / 拒绝率 / 未决定率 / 撤回数 / 最后变更时间。只做合规观测，不参与分析查询。

### 7.8 明确不做的后台能力

- 访客列表、单条访问明细、按 IP/UA 搜索；
- 跨天/跨设备关联视图；
- 原始 IP、完整 UA、精确坐标的展示或导出；
- 个人级数据导出（只允许聚合 CSV）。

---

## 8. 同意弹窗（Tier 1，本批不做）

- 首屏两个同权重按钮：「全部接受」「全部拒绝」；「管理偏好」为次级入口。
- 分类：`必要`（登录态、CSRF）/ `统计分析`。必要项不可关闭且不预勾选统计项。
- 拒绝后：正文与功能不降级，不再弹窗（除非政策版本变化）。
- 记录同意凭证：`version`、`scope`、`decided_at`；不记录 IP/UA。
- 撤回入口：页脚「统计设置」，随时可改。

---

## 9. 实施顺序

1. **数据层与清理骨架**：新增三张 Tier 0 表（`analytics_article_daily` / `analytics_view_token` / `analytics_dim_daily`），追加到 `schema.sql`（全部 `IF NOT EXISTS`）；`analytics_hmac_secret` 与 `analytics_last_job_at` 进 `site_config`；新增每日 `scheduled` 清理入口。存量 `view_count` 不回填、不伪造历史。
2. **转发契约**：SSR 取数层转发 §3 的白名单头，Worker 侧还原访客上下文。先于计数上线，否则过滤规则会把真实流量全部判为 bot。
3. **计数改造**：`incrementViewCount` → `recordArticleView`，接入过滤、令牌去重、日聚合（`pv/uv/requests`）、维度桶；草稿预览不再计数；概览接口可读。
4. **维度与查询**：维度桶映射与分布接口；文章明细与质量接口。
5. **后台只读页**：概览 + 文章表 + 分布 + 质量面板（Tier 0 数据），手写 SVG。
6. **隐私与文档**：新建 `/privacy`（中英）、页脚入口；README / GLOSSARY / ADR 同步。
7. **观察两周**：看 `bot_filtered` 占比、代理覆盖率与 PV/UV 比值是否符合预期，再决定是否做 Tier 1。
8. **Tier 1（可选，不预建工单）**：同意弹窗 + 同意凭证 + beacon + 分布补充。

工单切分与阻塞边见 tracker 的「阅读统计 Tier 0」父工单（#52）；本文件是口径与验收的单一来源。

回滚：后台读路径切回 `articles.view_count`；新表保留但不再写入；cron 可停。

---

## 10. 验收与测试

worker（vitest，`worker/tests/`）：

- 同 Cookie 连续两次请求：`view_count` 只 +1，`pv` +2、`uv` 只 +1；
- 无 Cookie 但同 IP+UA 同日：只 +1（令牌兜底）；
- 跨日同一 IP+UA：各 +1；
- 爬虫 UA / `Sec-Purpose: prefetch` / `Sec-Fetch-Mode: no-cors`：不计数，`bot_filtered` +1；
- 草稿预览（admin 拉取未发布文章）：不计数；
- 直连 API（无 `X-Real-IP`）：不产生 `pv`/`uv`，但 `requests` +1（过滤后）；
- 维度桶映射：表驱动覆盖 device/country/referrer 边界值；只写单篇行，全站查询按 `GROUP BY` 聚合；
- 清理任务：过期令牌被删、未过期保留、400 天边界、心跳写入；
- 后台接口：未登录 401、editor 403、`range=abc` 400、`dim=abc` 400。

SSR（`tests/` 与 `docs/agents/testing.md` 既有回归）：

- `loadArticleForPage` 转发白名单头；无访客请求时不伪造；
- Worker 侧 `readVisitorContext` 还原 UA / Accept / 国家 / IP / 客户端提示，缺失归 null；
- 文章 SSR 仍下发 `view_<id>` Cookie（现有门禁保持，逐字断言更新 `HttpOnly`）；
- 后台「统计」标签可打开、空态正确、无控制台报错；
- `/privacy` 页脚可达，中英文案切换正常。

---

## 11. 已定决策（2026-11-04）

| #   | 问题                | 决定                                                            | 影响                                             |
| --- | ------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `view_` Cookie 去留 | 保留，并加 `HttpOnly`；隐私政策声明为必要 Cookie                | GLOSSARY「去重访客」补去重键；逐字断言测试更新   |
| 2   | 站点时区            | 常量 `Asia/Shanghai`，导出 `dayKey()`；不进 `site_settings`     | 改时区按数据迁移处理，不在本期                   |
| 3   | 地区粒度            | 只到国家；`dim` 列表删除 `region`                               | §3、§5 同步                                      |
| 4   | 维度桶              | 只写单篇行；全站 `GROUP BY bucket` 聚合                         | 删除 `article_id = 0` 约定                       |
| 5   | 清理与保留          | 每日 cron；令牌 24h、聚合 400 天；写 `analytics_last_job_at`    | 新增 `scheduled` 与 `triggers.crons`             |
| 6   | 迁移路径            | 追加 `schema.sql`（全部 `IF NOT EXISTS`）；M12 迁移工具另开工单 | README 升级片段补三条 DDL                        |
| 7   | 计数谓词            | 仅带 `X-Real-IP` 的详情 200 计 PV；`requests` 记全部过滤后 200  | 直连 JSON 不计数；后台预览已发布文章不再污染数据 |
| 8   | 隐私披露            | 新建 `/privacy`（中英）+ 页脚入口；不引入同意弹窗               | 需同步 `HTML_ROUTE_PATTERNS` 护栏                |
| 9   | 图表实现            | 手写 SVG，不引入图表库                                          | 无新依赖                                         |
| 10  | 历史起点标注        | 查询 `MIN(day)`，为空不显示                                     | 无回填                                           |
