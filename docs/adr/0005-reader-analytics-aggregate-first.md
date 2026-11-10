# 阅读统计：聚合优先，不引入访客指纹

2026-11-04。立档时的 `incrementViewCount`（原在 `worker/src/services/article_service.ts`，#55 起由 `services/analytics_service.ts` 的 `recordArticleView` 取代）只按 `view_<id>` Cookie 去重并累加 `articles.view_count`：没有时间序列、没有机器人过滤，后台看不到读者构成；草稿预览（管理员/作者拉取未发布文章）也会计数。

曾考虑用「网络与位置 + 设备与系统 + 浏览器特征 + 综合指纹 + 行为 + 登录痕迹/社交授权」的多维画像提升识别准确率，并在后台逐条查看。决定改为**聚合优先的分层采集**：Tier 0 在 Worker 侧完成计数、去重与粗维度聚合（不新增终端标识、零持久访客 ID），Tier 1 在获得分类同意后只补充「桶计数」维度；不引入 canvas/WebGL/audio/字体枚举，不建立跨天访客 ID，后台只提供聚合视图。

理由是：同意层覆盖不到拒绝者，单独用它会让阅读数系统性偏低，且偏低幅度随人群变化（同意率偏差）；指纹在隐私浏览器下会被随机化，跨会话识别率实际只有 60–80%，收益小于偏差与合规成本；而「数不准」的主因是爬虫、预取、缓存与草稿预览，这些用服务端计数和过滤就能解决。立档是因为「要不要上指纹/画像」会被反复提出，且该决定同时约束数据模型、后台契约与隐私政策。

**Status:** accepted（2026-11-10；Tier 0 已随 #53–#59 落地，按 §9 第 7 步观察两周后再评估 Tier 1）

## Considered Options

- **同意门控的浏览器指纹画像**：否决。分类同意能解决合法性，但解决不了两件事：① 拒绝者不计入 → 总量偏差，且无法用同意层修正；② 为「阅读数」采集高熵特征属于目的与手段不成比例，仍违反最小必要。后台按人展示会让匿名读者变成可识别对象。
- **接入第三方分析（Plausible / Umami / Cloudflare Web Analytics）**：技术上可行，但会把访客 IP/UA 外发给第三方，且多一个外部依赖与计费面；本站已有 Worker + D1，自建同量级方案成本更低。保留为备选。
- **只修现有 Cookie 计数，不加任何维度**：能修掉草稿预览与爬虫误计，但回答不了「谁在读、从哪来、读完没有」，后台仍是单一累计数。作为 Tier 0 的子集保留，不单独实施。

## Consequences

- **口径**：`articles.view_count` 继续表示「累计去重阅读量」（`阅读量` 的 GLOSSARY 定义已随 #59 按 `Asia/Shanghai` 日界、`view_<id>` Cookie 快路径与 HMAC 令牌口径精确化），但时间序列改由日聚合表承载，后台趋势不再从累计数推算。
- **观测链路**：计数仍在 Worker，但请求由 Pages 的 SSR 层发起。SSR 只转发白名单请求头（UA / Accept / Referer / Accept-Language / `Sec-Fetch-*` / `Sec-Purpose` / `X-Purpose` / `Sec-CH-UA*` / `X-Real-IP` / `X-Visitor-Country`）；`CF-Connecting-IP` 在第二跳是 Pages 的出口地址，不能用作去重输入。这是 Tier 0 过滤与维度的前提，必须先于计数上线。
- **计数谓词**：只有带 `X-Real-IP` 的详情 200 产生 `PV`/`UV`；直连 API 只在通过机器人过滤后累加 `requests`，用于计算代理覆盖率。
- **去重**：Cookie 仍是快路径；Cookie 缺失时用 `HMAC(analytics_hmac_secret, X-Real-IP + UA + article_id + 日期)` 的 24h 令牌兜底。IP 不落库，令牌到期即删；密钥独立于 `jwt_secret`。
- **会话边界**：去重日按常量 `Asia/Shanghai` 切分，不按 UTC；改时区按数据迁移处理，不提供后台开关。
- **机器人**：过滤结果单独计数（`bot_filtered`）而不是静默丢弃——不展示过滤量就无法判断统计是否可信。免费版无 Bot Management，对应规则保留为永不触发的守卫分支。
- **Tier 1 默认关闭**：以站点配置开关控制；开启前必须先落地分类同意弹窗与同意凭证表，且拒绝后功能不降级。
- **后台**：新增 `/admin` 的「统计」标签页，只提供聚合与分布视图；不提供单访客明细、不提供个人数据导出。维度桶只写单篇行，全站视图查询时聚合。
- **清理与保留**：每日 cron 删除过期令牌与 400 天前的聚合，心跳写 `site_config.analytics_last_job_at`；新增 `scheduled` 入口。
- **隐私**：新建 `/privacy`（中英）并在页脚加入口，披露统计字段、目的与保留期；`view_` Cookie 加 `HttpOnly` 并声明为必要 Cookie。不引入同意弹窗。
- **迁移**：继续在 `schema.sql` 追加（全部 `IF NOT EXISTS`）；独立迁移工具 M12 另开工单，不阻塞本设计。
- **文档面**：`README.md` 的 API 路由表、`GLOSSARY.md` 的阅读词条在实施时同步更新；本次只落设计与决策。
