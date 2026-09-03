# 全站背景图实现说明

> 需求：为所有页面添加自定义背景图，铺满视口、覆盖全站、响应式适配（桌面/平板/手机 + 横竖屏）、不变形、前景文字清晰可读。
> 已落地，构建通过（`astro build` 验证）。与 `docs/UI_MOTION_UPGRADE.md` 是同一套体系。

---

## 1. 改动文件清单

| 文件 | 改动 |
|---|---|
| `public/bg-placeholder.svg` | 新增占位背景图（中性抽象渐变，矢量零体积，可直接替换） |
| `src/styles/variables.css` | 新增 `--bg-image` / `--bg-overlay` / `--bg-position`（light + dark 各一份） |
| `src/styles/global.css` | `html` 兜底底色、`body` 改透明、新增 `.site-bg` 固定铺底层 + 响应式 + 横竖屏适配 |
| `src/components/layout/BaseLayout.astro` | body 顶部注入 `<div class="site-bg">`；主题/语言切换包 `View Transitions` 实现平滑渐变；加 VT 关键帧 |

---

## 2. 实现原理

```
┌─ html  (兜底 background-color: var(--color-bg-primary)，图加载失败不白屏)
├─ body  (background: transparent，把背景交给固定层)
│   ├─ <div class="site-bg">        ← 固定铺满视口，z-index:-1
│   │     background-image: 遮罩(上) , 图片(下)   ← 多背景，遮罩保证可读性
│   │     background-size:   cover , cover         ← 铺满、不变形
│   │     background-position: var(--bg-position), center
│   ├─ <header>  (半透明毛玻璃，叠在背景上)
│   ├─ <main>    (卡片为不透明底，文字天然清晰)
│   └─ <footer>
```

**为什么用独立 fixed 层，而不是 `body { background-attachment: fixed }`**：
`background-attachment: fixed` 在 iOS Safari 上有已知渲染/性能问题（滚动时背景错位或不跟手）。独立 `position: fixed` 层在移动端稳定，且能做视差、能做主题交叉淡入。

---

## 3. 换成你自己的图（只改一处）

1. 把图片丢进 `public/`，例如 `public/my-bg.webp`（推荐 **WebP/AVIF**，体积最小；横图 2400×1600 左右，竖屏友好可另备一张）。
2. 打开 `src/styles/variables.css`，改 `--bg-image`：

```css
:root,
[data-theme="light"] {
  --bg-image: url('/my-bg.webp');          /* 改这里 */
  --bg-overlay: linear-gradient(180deg, rgba(250,250,250,0.80) 0%, rgba(250,250,250,0.86) 100%);
  --bg-position: center center;
}

[data-theme="dark"] {
  --bg-image: url('/my-bg-dark.webp');     /* 可选：日/夜用不同图 */
  --bg-overlay: linear-gradient(180deg, rgba(10,10,10,0.84) 0%, rgba(10,10,10,0.90) 100%);
  --bg-position: center center;
}
```

**想让图更明显** → 调低遮罩 opacity（如 `0.80`→`0.65`）。
**想让图更淡（纯纹理感）** → 调高遮罩 opacity（如 `0.86`→`0.94`）。
**竖屏想换主体位置** → 改 `--bg-position` 为 `center 20%` 之类。

---

## 4. 响应式 & 横竖屏适配

| 场景 | 处理 |
|---|---|
| 桌面 / 平板横屏 | `background-size: cover` 自动铺满，主体居中 |
| 手机竖屏 (`orientation: portrait`) | `.site-bg` 背景位置上移 `center 18%`，避免光斑被裁到边缘 |
| 超宽屏 (`≥21:9`) | 保持 `center center` 中心裁切，杜绝横向拉伸变形 |
| 任意尺寸 | `cover` 保证**不变形**（等比缩放铺满，多余部分裁切） |

> **cover vs contain 取舍**：`cover` = 铺满 + 不变形，但边缘可能裁切（行业默认，适合装饰背景）。
> 若你要求「100% 完整不裁切」，改 `background-size: contain, contain` 并在 `.site-bg` 加 `background-color: var(--color-bg-primary)` 补边——代价是图片四周留白。

---

## 5. 前景文字可读性保障

- **遮罩层**：`.site-bg` 上层叠半透明主题色渐变，把背景图压成「淡纹理」，正文区对比度天然达标。
- **卡片本身不透明**：`.article-card` / `.list-card` 用 `var(--color-bg-secondary)`（light `#fff` / dark `#1c1c1e`），文字在卡片上 100% 清晰，与背景图解耦。
- **Hero 标题**：直接浮在背景上，靠遮罩保证对比；如仍偏淡，可在 `index.astro` 给 `.hero-title` 加 `text-shadow: 0 1px 12px rgba(0,0,0,.25)`（浅色主题可减）。
- **主题联动**：日/夜切换时遮罩深浅自动跟随 `--bg-overlay`，无需额外处理。

---

## 6. 与主题 / 语言切换的衔接

- 主题切换、语言切换的 click 处理已包进 **`document.startViewTransition(...)`**（见 `BaseLayout.astro`）。
- 切换瞬间整页（含背景图）做 `site-vt-fade` 交叉淡入，背景图随之平滑过渡，**不闪**。
- 不支持 View Transitions 的旧浏览器走 `if/else` 退化路径，直接切换无动画。
- 与 `UI_MOTION_UPGRADE.md` 的 `ClientRouter` 方案共用同一 API，不冲突。

---

## 7. 性能 & 可访问性

| 项 | 措施 |
|---|---|
| 首屏 | 背景图为 `position: fixed` 层，不触发重排；SVG 占位零网络负担 |
| 移动端 | 不用 `background-attachment: fixed`；不挂 `will-change`（避免层爆炸） |
| 减弱动画 | `@media (prefers-reduced-motion: reduce)` 下背景 `transition: none`，静态显示 |
| 兜底 | `html` 保留 `background-color: var(--color-bg-primary)`，图失败/禁用也不白屏 |
| 无干扰 | `.site-bg { pointer-events: none; }` + `aria-hidden`，不参与交互/读屏 |

---

## 8. 验证清单

- [ ] 桌面（1920/1440）、平板（1024/768）、手机（390/375）均铺满、无横向滚动
- [ ] 手机横屏 / 竖屏切换，背景主体未被裁到不可见
- [ ] 日→夜、夜→日切换，背景平滑过渡不闪
- [ ] 中↔英切换，背景不受影响（语言无关）
- [ ] Hero 标题、页脚文字在两种主题下对比度达标（可用浏览器 DevTools 对比度检查）
- [ ] 文章卡片、列表卡片文字清晰（不透明底）
- [ ] 系统开启「减弱动态效果」后，背景静态显示无异常
- [ ] Lighthouse Performance 无明显回落

---

## 9. 与动效方案的衔接点

- 背景层 `.site-bg` 已预留 `data-parallax` 接入位（如后续想做极轻视差，在 `motion.ts` 的 `initParallax` 里选中它即可，`speed` 建议 ≤ 0.05 以免干扰阅读）。
- 主题/语言渐变已用 View Transitions，与动效方案的 `::view-transition-*` 体系一致，无需重复实现。
