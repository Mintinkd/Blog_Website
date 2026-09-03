# 全站可视化配置中心（外观与个性化）

让所有个性化设置（配色、布局、背景、功能开关、文案覆盖）都能在**管理员面板**里可视化修改，保存后实时生效，无需改动代码；并支持**导出 / 导入 / 一键恢复默认**。

> 本功能是既有 `site_config` 配置体系的扩展：原来的 `site_title/subtitle/...` 等仍走 `/config` 旧接口，新增的「外观与个性化」走 `/settings` 新接口，互不干扰。

---

## 架构总览

```
后台面板 (src/admin/App.vue 「外观与个性化」)
   │  PUT /settings · POST /settings/reset · GET /settings/export · POST /settings/import
   ▼
Worker (worker/src/handlers/settings.ts)
   │  读写 site_config 表中 key='site_settings' 的 JSON blob（深度合并默认值 + 过滤未知键）
   ▼
前台运行时 (src/utils/settings.ts)
   │  GET /settings → applySettings()
   │   · 注入 CSS 变量覆盖（配色/布局/背景，!important）
   │   · <html> 写 data-feature-*="off" 控制功能开关
   │   · <html> 写 data-motion-intensity / data-parallax，写 --parallax-speed（动效强度与视差开关，供 motion.ts / motion.css 读取）
   │   · 写入 i18n 文案覆盖层 + 刷新 [data-i18n]
   ▼
全站页面（随主题 / 语言切换照常生效，跨标签页实时同步）
```

## 数据模型（SiteSettings）

| 分组 | 字段 | 说明 |
|---|---|---|
| `theme.light` / `theme.dark` | accent, accentHover, bgPrimary, bgSecondary, bgTertiary, textPrimary, textSecondary, textTertiary, border, borderLight | 浅色/深色各 10 个配色，注入为 `--color-*` 变量 |
| `layout` | contentMaxWidth, headerHeight, radiusSm, radiusMd, radiusLg | 布局相关 CSS 变量 |
| `background` | bgImage(URL), bgOpacity(0~1) | 背景图路径 + 浓度（遮罩由主题背景色 + 浓度自动生成，保证文字对比度） |
| `features` | comments, likes, friendLinks, search, rss, darkMode, i18n | 功能开关，关掉则在对应 DOM 上隐藏 |
| `copy` | zh{}, en{} | 文案覆盖，键名复用 i18n key（如 `nav.home`），按当前语言生效 |
| `motion` | intensity(normal\|reduced\|off), parallax(bool), parallaxSpeed(0~0.1) | 动效强度与背景视差开关。intensity=off 时全站禁用入场/微动/进度条；reduced 时仅保留轻量入场与进度条、禁用磁吸/视差；parallax 关时背景层不位移。视差 speed 默认 0.04，位移=滚动进度(0~1)×视口高×speed（有界，不露边） |

默认值见 `worker/src/handlers/settings.ts` 与 `src/utils/settings.ts` 的 `getDefaultSettings()`（与 `src/styles/variables.css` 当前外观保持一致，故「恢复默认」= 还原当前外观）。

### 动效开关（motion）用法

后台「外观与个性化 → 动效」分组可实时配置：
- **动效强度**：`normal`（全部动效）/ `reduced`（仅轻量入场与进度条，禁用磁吸与视差）/ `off`（无动效，元素直接可见，等价于 `prefers-reduced-motion`）。
- **启用背景视差**：开关背景层（`.site-bg` 的 `data-parallax-fixed`）极轻微滚动位移，增强沉浸感且不干扰阅读；移动端自动禁用。
- **视差速度**：0~0.1，越大位移越明显，默认 0.04。

实现要点：`applySettings()` 把 motion 配置转成 `<html data-motion-intensity=...>`、`<html data-parallax=off>`（关时）与 CSS 变量 `--parallax-speed`；`motion.ts` 的 `motionLevel()` 综合系统偏好与配置强度分级，各动效（reveal/磁吸/进度条/视差）按级启用；`motion.css` 的 `[data-motion-intensity="off"]` 规则兜底禁用 hover/磁吸/reveal。两组开关在任意主题与语言下均生效。

## API 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/v1/settings` | 公开 | 拉取全量设置（已与默认合并，供前台运行时套用） |
| GET | `/api/v1/settings/all` | admin | 同上（管理端读取用） |
| PUT | `/api/v1/settings` | admin | 整体保存设置（深度合并校验，过滤未知键） |
| POST | `/api/v1/settings/reset` | admin | 恢复默认 |
| GET | `/api/v1/settings/export` | admin | 导出 JSON 文件 |
| POST | `/api/v1/settings/import` | admin | 导入 JSON（深度合并后保存） |

> 注：既有整站导出/导入（`/admin/export`、`/admin/import`）会连带 `site_config` 表（含 `site_settings`）一起备份，因此设置也会随整站备份走。

## 后台面板用法

1. 打开 `/admin` → 侧栏「外观与个性化」（仅管理员可见）。
2. 修改任意项，**面板本身即时预览**（与全站共用同一套 CSS 变量）。
3. 点击「保存」→ 写入 Worker 并广播，前台站（含其它已打开标签页）实时套用。
4. 「导出」下载 `site-settings.json`；「导入」上传该文件覆盖；「恢复默认」还原全部外观。

## 关键实现点（已守住硬约束）

- **日/夜主题不破**：配色按 `[data-theme="light"/"dark"]` 分写，`applySettings` 用属性选择器，主题切换自动重新套用。
- **中/英不破**：文案覆盖按 `currentLocale` 生效，`t()` 优先读覆盖层；语言切换后 `[data-i18n]` 用新文案刷新。
- **功能开关**：在 `<html>` 上写 `data-feature-<name>="off"`，配合各处的 `data-feature` 钩子（`BaseLayout` 的暗色/语言/搜索/RSS/友链按钮，以及 `CommentSection`、`LikeButton` 根元素）隐藏，不影响其它逻辑。
- **性能**：仅覆盖 CSS 变量（不触发重排），无第三方库；减动偏好不受影响（本功能不引入动画）。
- **安全**：后端 `deepMerge` 只保留已知字段、过滤未知键，防止任意字段注入；设置不含任何密钥，故 `/settings` 可公开读取。

## 部署注意

- **Worker（新接口）**：按现有约定随 `worker/` 源码 git push 自动部署（Cloudflare 读 `wrangler.jsonc` 自行 build）。
- **前端（dist）**：按现有约定需 `npx wrangler pages deploy dist --project-name blog-website-page`（或 git push `dist`）。
- 两者都更新后，配置中心才完整可用。

## 扩展新配置项

1. 在 `SiteSettings` 接口 + `getDefaultSettings()` 中**同时**更新 `worker/src/handlers/settings.ts` 和 `src/utils/settings.ts`（两处默认值必须一致）。
2. 前端：若属「配色/布局/背景」类，在 `settings.ts` 的 `buildCss()` 里加一行变量注入；若属「功能开关」，加 `data-feature` 钩子；若属「文案」，走 `copy` 覆盖即可。
3. 后台面板：在 `App.vue` 对应 section 增加表单字段（绑定到 `settings` 响应式对象，已自动实时预览）。
