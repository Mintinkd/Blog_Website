# 代码审查报告 — P1 批次修复后复审（code-review 技能，`d1e0d2a...HEAD`）

- **日期**：2026-10-18
- **基点**：`d1e0d2a`（P0 批次最后一个提交；three-dot diff：`git diff d1e0d2a...HEAD`，排除 `dist/`）
- **变更提交**（8 个，覆盖 issues #7–#14）：
  - `d6acc6c` 口令存储升级为 PBKDF2-SHA256 加盐慢哈希，旧哈希登录时透明升级（#7）
  - `c8a5c6a` 首登强制改密 + 登录失败锁定（#8）
  - `bfcfa7e` CSP 补充 frame-src 白名单，恢复文章页 B 站/YouTube 嵌入（#9）
  - `116f5f2` CSP script-src 收紧——移除 `'unsafe-inline'`，改用构建期内联脚本 sha256（#10）
  - `4024eda` 设置值字段白名单 + buildCss 容错回落（#11）
  - `4142fb6` admin 导入重构——表/列白名单 + 密钥行跳过 + 内容净化 + FK 安全顺序（#12）
  - `22a82e6` 媒体 serve/上传加固——魔数嗅探 + 扩展名白名单 + Content-Disposition 附件化（#13）
  - `939ad8e` 图片/文本代理 SSRF 加固——重定向逐跳校验 + mapped IP 拦截 + 流式限额与总超时（#14）
- **Spec 来源**：GitHub issues #7–#14 原文（`Fixes #N`；收集件 `p1-specs.md`）
- **标准来源**：`README.md`（主契约文档；本仓库无 `CODING_STANDARDS.md` / `CONTRIBUTING.md`）、`AGENTS.md`、`docs/agents/*.md`；Fowler 坏味道基线
- **方法**：code-review 技能原流程 — 两轴并行子代理（Standards / Spec），本文件原样归并，**不做跨轴合并或重排序**

---

## Standards

### (a) 违反已文档化标准（硬性）

1. **README.md:178**：文档称 `/auth/change-password` 为"须改密状态下为唯一可用的写接口"。而 `worker/src/router.ts:39` 的豁免集合同时包含 POST `/auth/refresh`（`router.ts:186` 放行）——契约文字已失真。
2. **README.md:131**：仍将 `users` 表描述为"SHA-256 密码哈希"；#7 已改为 PBKDF2-SHA256（`worker/src/utils/password.ts:2-4`），本批未同步该行。
3. **README.md:25-123 结构清单**：本批新增 `scripts/patch-csp.mjs`、`docs/security/csp-evaluation.md` 未登记；文档清单（`README.md:119-122`）只列三份 docs。
4. **worker/schema.sql:186**：注释"default password is: changeme"与 `:188` 的种子哈希（SHA-256("password")）及 `auth_handler.ts:8` `DEFAULT_SEED_PASSWORD = 'password'` 相矛盾；新增迁移（`schema.sql:203-208`）正依赖该种子哈希。

### (b) 基线坏味道（判断性）

1. **Duplicated Code（双端同套规则）**：`src/utils/settings.ts:134-139` 与 `worker/src/handlers/settings.ts:160-163` 逐字复制同一组正则与字段遍历；代码注释自称"双端同一套"，但无任何机制保证同步。
2. **Repeated Switch**：`worker/src/handlers/img_proxy.ts:291-299` 与 `worker/src/handlers/text_proxy.ts:105-113` 的 `fetched.kind` 级联完全同形 → 可抽一个 union→响应 的共享映射。
3. **Data Clumps / Shotgun Surgery**：`worker/src/handlers/admin.ts:22-47` 五个并行的按表结构（`TABLE_COLUMNS` / `SKIP_CONFIG_KEYS` / `SANITIZE_COLUMNS` / `DELETE_ORDER` / `INSERT_ORDER`）；注释自认"schema 新增列需同步维护" → 收敛为每表描述符。
4. **Duplicated Code（魔法常量）**：`INITIAL_ADMIN_PASSWORD_HASH`（`auth_handler.ts:10`）与 `schema.sql:188/208` 字面量重复；`DEFAULT_SEED_PASSWORD`（`:8`）重复同一事实 → 单一来源导出。
5. **Duplicated Code（CSP 基线）**：`public/_headers:124`、`src/middleware.ts:20-23`、`scripts/patch-csp.mjs:24` 三处保存 CSP 实况；构建期断言有缓解，但三份拷贝仍在。
6. **轻**：`isPlainObject`（`admin.ts:63`）与 `isObj`（`settings.ts:139`）同一谓词两个名字；`src/utils/settings.ts:296` 对 `:304` 已净化的输入重复净化。

**做得好的部分**：本批未发现 Repeated Switches / Shotgun Surgery 级系统性问题；#11 的双端白名单虽重复但两侧语义完全一致，且写入侧拒绝 + 读取侧回落的组合是正确取舍。

---

## Spec

**已验证正确**：#7 PBKDF2 与透明升级（写入路径不再产出裸 SHA-256——`worker/src/utils/password.ts:73` 仅验证用于升级）、#9 frame-src、#10 构建期哈希、#11 正则白名单、#14 mapped IPv6 处理。

### (a) spec 要求了、diff 缺失或只做了一半

1. **#8 问题前提未修完（"实测：种子哈希为 SHA-256("password")，schema 注释误标 changeme"）**：`worker/schema.sql:186` 仍是 `-- If starting fresh, default password is: changeme`，就在 `SHA-256("password")` 种子（:188）上方。只有 README 被改写，误导性源码注释幸存。
2. **#12 AC5「worker 侧 typecheck 无新增错误」不可核验**：`worker/package.json` 无 `typecheck` 脚本，且 `npx tsc --noEmit` 仍有报错——`src/services/article_service.ts(202,3) TS2739`。该文件本批未动，AC 字面成立，但 CI 无法检查。
3. **#14「解析后 IP 复核（含 mapped 形式）」只做了字面量匹配**：`worker/src/handlers/img_proxy.ts:78-116` 不对解析后的 IP 复核，指向 127.0.0.1 的域名可通过（mapped 字面形式处理正确）。

### (b) diff 出现、spec 未要求的行为（增量改进，不冲突）

- `worker/src/handlers/media.ts:200` 新增 `X-Content-Type-Options: nosniff`（#13 只要求 Content-Disposition/魔数/扩展名）。
- `worker/src/middleware/auth.ts:71-96` 把 HMAC 验证移入 `try`（畸形签名 401 而非 500）——与 #7–#14 无关。
- `worker/src/router.ts:186` 对**所有**已认证角色拦截写操作，而 #8 说的是"管理端写操作被拒绝"。
- `auth_handler.ts:74` —— `providedPassword === DEFAULT_SEED_PASSWORD` 会把任何口令恰为 `password` 的账号标记须改密，宽于"初始/默认口令"。
- 另有：FK 安全 `DELETE_ORDER`/`INSERT_ORDER`（`admin.ts:46-47`）、3 条 `ALTER TABLE` + 1 条数据 `UPDATE`（`worker/schema.sql:203-208`）、README 文档修订。

### (c) 看似实现、与 spec 不符或明显有问题

1. **#7 AC5「错误口令仍统一返回 401，不泄露用户存在性」**：`auth_handler.ts:91-95` 仅当用户名存在且达到锁定阈值时返回 **429**"账号已锁定"；未知用户名恒为 401。形成用户名枚举 oracle，与 #8"向用户反馈剩余锁定时间"存在设计张力。
2. **#8 AC2 门禁 fail-open**：「未完成改密前，管理端写操作被拒绝」——`auth_handler.ts:113-119` 与 `auth.ts:88-96` 捕获**任意** D1 异常并降级为 `must_change_password = 0`；一次瞬时数据库错误会静默关闭门禁。
3. **#8「改密后全部功能恢复」**：`handleUpdateUser`（`auth_handler.ts:301-305`）更新 `password_hash` 但不清 `locked_until`/`failed_login_attempts`，管理员重置口令后账号仍被锁至窗口结束。
4. **#13 AC4/AC5「<img> 显示不受影响 / 既有合法媒体可继续访问」**：`media.ts:194` 把 6 项白名单之外的 MIME 一律降为 `application/octet-stream` + nosniff；KV 元数据缺失的存量对象回退 `guessMimeType`（`media.ts:207-215`，7 种扩展名），除此之外的存量资产会被强制下载。

---

## 两轴小结（技能要求的收官行）

- **标准轴**：10 项发现（硬性 4 / 坏味道 6）。最严重：**README 契约漂移**（4 项硬性违规全部集中在文档/注释与实现脱节：change-password 豁免范围、users 哈希算法、结构清单、种子口令注释）。
- **Spec 轴**：12 项发现（缺失/部分 3 / 范围外 5 / 实现存疑 4）。最严重：**#8 管理端写门禁 fail-open**（D1 查询异常即静默降级放行，与本批安全目标直接相悖）。

---

## 复核备注（非技能输出）

- 本报告为 P1 批次（#7–#14）修复后的复审；两轴发现按技能要求并列呈现、不做跨轴合并。
- 抽查核实：`router.ts:39` 豁免集合、`schema.sql:186` 注释未被本批改动（`git diff d1e0d2a...HEAD -- worker/schema.sql` 可证）、`auth_handler.ts` 锁定/降级代码行号——与子代理引用一致。
- 上述发现可作为后续 triage 候选（未即时开票）；M2 类既有决定（i18n copy → innerHTML）不在本次范围。
