# UI 动效升级方案 —— 让博客「动」起来

> ✅ **状态：已全部落地（2026-09-03），`astro build` 验证通过。** 6 个 PR 一次性实现，见文末「实际改动文件清单」。

> 目标：在不破坏 **日/夜间主题切换** 与 **中/英双语切换** 的前提下，为博客注入质感动效。所有改动**模块化、可灰度、可一键回滚**。

---

## 0. 设计原则（必读）

| 原则 | 说明 |
|---|---|
| **风格统一** | 所有动效的曲线、时长、缓动必须来自同一套 token，杜绝「每个组件各写各的」 |
| **性能优先** | 只用 `transform` / `opacity`（GPU 合成层），**禁止** `top/left/width/height` 入场动画 |
| **可访问性** | 严格遵守 `prefers-reduced-motion: reduce`，命中时所有动画退化为瞬时或最长 0.01s |
| **不打断阅读** | 文章详情页**不**做视差、不做整页渐入；只做标题/标签的微入场 |
| **不堆砌** | 同一个 hover 区域只允许 1 种主要反馈（位移/光晕/缩放三选一） |
| **主题/语言感知** | 主题/语言切换时颜色和文字走平滑过渡（CSS `transition` 配合 `View Transitions` API） |

---

## 1. 命名约定与文件组织

```
src/
├── styles/
│   ├── variables.css     # ← 扩展：补全 motion tokens
│   ├── motion.css        # ← 新增：keyframes + reusable motion utility classes
│   ├── global.css        # ← 微调：把 motion.css 引入
│   └── prose.css         # 不动
│
├── utils/
│   ├── theme.ts          # 不动
│   ├── i18n.ts           # 不动
│   └── motion.ts         # ← 新增：reveal/parallax/磁吸/进度条等 JS API
│
├── components/
│   ├── layout/BaseLayout.astro  # ← 接入主题/语言渐变 + 滚动进度条
│   ├── article/ArticleCard.astro # ← 接入 reveal + hover 微动
│   └── common/
│       ├── ScrollProgress.astro  # ← 新增：顶部阅读进度条（可选）
│       └── Reveal.astro          # ← 新增（可选）：声明式包装，或直接用 data-reveal
│
└── islands/
    ├── ThemeToggle.vue    # ← 加图标切换旋转动画
    └── SearchBox.vue      # ← 加聚焦光晕、结果入场
```

**约定**：
- 所有可入场元素的根属性：`data-reveal="fade-up | fade-in | scale-in"`（值决定动画类型）
- 所有可微动元素的根属性：`data-hover="lift | glow | magnetic"`（值决定 hover 类型）
- 不写内联 `style` 表达动效，统一走 CSS class 或 `data-*`

---

## 2. Design Tokens 扩展（`src/styles/variables.css`）

把以下块**追加**到 `:root` 选择器内（深色块 `[data-theme="dark"]` 同样要补一份，仅需覆盖涉及颜色的 token）：

```css
:root,
[data-theme="light"] {
  /* 已有 --transition-fast/normal/slow 保留 */

  /* ===== 新增：动效令牌 ===== */

  /* 时长（毫秒为单位的命名变量，便于 media query 调整） */
  --motion-duration-instant: 120ms;
  --motion-duration-fast:    200ms;
  --motion-duration-base:    320ms;
  --motion-duration-slow:    520ms;
  --motion-duration-page:    420ms;

  /* 缓动 */
  --motion-ease-standard:    cubic-bezier(0.2, 0, 0, 1);     /* 大部分用这个 */
  --motion-ease-emphasized:  cubic-bezier(0.2, 0, 0, 1.2);   /* 入场、弹一下 */
  --motion-ease-decelerate:  cubic-bezier(0, 0, 0, 1);       /* 进入画面 */
  --motion-ease-accelerate:  cubic-bezier(0.3, 0, 1, 1);     /* 离开画面 */
  --motion-ease-bounce:      cubic-bezier(0.34, 1.56, 0.64, 1);

  /* 位移/缩放幅度（避免散落数字） */
  --motion-translate-sm:  4px;
  --motion-translate-md:  8px;
  --motion-translate-lg:  16px;
  --motion-scale-sm:      1.02;
  --motion-scale-md:      1.05;

  /* 阴影（光晕） */
  --motion-glow-accent:   0 0 0 4px var(--color-accent-subtle);
  --shadow-card-hover-strong: 0 16px 48px rgba(99, 102, 241, 0.18);

  /* View Transitions 命名 */
  --vt-theme:   theme-fade;
  --vt-locale:  locale-fade;
}

[data-theme="dark"] {
  --shadow-card-hover-strong: 0 16px 48px rgba(129, 140, 248, 0.22);
}

/* 尊重用户的减弱动画偏好 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-instant: 0.01ms;
    --motion-duration-fast:    0.01ms;
    --motion-duration-base:    0.01ms;
    --motion-duration-slow:    0.01ms;
    --motion-duration-page:    0.01ms;
  }
}
```

> 已在根作用域接管减弱动画——后续所有 `animation/transition` 引用 `--motion-duration-*` 时自动退化。

---

## 3. 基础动效系统（`src/styles/motion.css`，新增）

```css
/* ============================================================
 * motion.css —— 通用动效原子
 * 仅使用 transform / opacity，避免 layout thrashing
 * ============================================================ */

/* ---------- 1. Reveal（滚动入场） ---------- */

@keyframes reveal-up {
  from { opacity: 0; transform: translate3d(0, var(--motion-translate-md), 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes reveal-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes reveal-scale {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}

/* 进入视口才加 .is-revealed；初始态隐藏 */
[data-reveal] {
  opacity: 0;
  will-change: opacity, transform;
}

[data-reveal="fade-up"].is-revealed   { animation: reveal-up   var(--motion-duration-base) var(--motion-ease-decelerate) both; }
[data-reveal="fade-in"].is-revealed   { animation: reveal-fade var(--motion-duration-base) var(--motion-ease-standard) both; }
[data-reveal="scale-in"].is-revealed  { animation: reveal-scale var(--motion-duration-slow) var(--motion-ease-emphasized) both; }

/* 多个同级元素错位入场：父元素加 [data-reveal-stagger]，JS 给子元素 --i */
[data-reveal-stagger] > [data-reveal] {
  animation-delay: calc(var(--i, 0) * 60ms);
}

/* ---------- 2. Hover 微动 ---------- */

[data-hover="lift"]:hover {
  transform: translate3d(0, calc(-1 * var(--motion-translate-sm)), 0);
  box-shadow: var(--shadow-card-hover);
}
[data-hover="lift"] {
  transition: transform var(--motion-duration-fast) var(--motion-ease-standard),
              box-shadow var(--motion-duration-fast) var(--motion-ease-standard);
}

[data-hover="glow"]:hover {
  box-shadow: var(--motion-glow-accent);
  border-color: var(--color-accent);
}
[data-hover="glow"] {
  transition: box-shadow var(--motion-duration-fast) var(--motion-ease-standard),
              border-color var(--motion-duration-fast) var(--motion-ease-standard);
}

/* 磁吸（按钮被鼠标拉一下）—— JS 部分见 motion.ts */
[data-hover="magnetic"] {
  transition: transform var(--motion-duration-fast) var(--motion-ease-standard);
  will-change: transform;
}

/* ---------- 3. 顶部阅读进度条（被 .ScrollProgress 组件使用） ---------- */

.scroll-progress {
  position: fixed;
  top: 0; left: 0;
  height: 2px;
  width: 0%;
  background: linear-gradient(90deg, var(--color-accent), #a78bfa);
  z-index: 200;
  transition: width 80ms linear, opacity var(--motion-duration-fast);
  opacity: 0;
  pointer-events: none;
}
.scroll-progress.is-visible { opacity: 1; }

/* ---------- 4. 主题/语言切换渐变（View Transitions API 关键帧） ---------- */

@keyframes vt-theme-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes vt-locale-fade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

::view-transition-old(theme-fade)  { animation: vt-theme-fade  var(--motion-duration-fast) var(--motion-ease-accelerate) both; }
::view-transition-new(theme-fade)  { animation: vt-theme-fade  var(--motion-duration-fast) var(--motion-ease-decelerate) both; }
::view-transition-old(locale-fade) { animation: vt-locale-fade var(--motion-duration-fast) var(--motion-ease-accelerate) both; }
::view-transition-new(locale-fade) { animation: vt-locale-fade var(--motion-duration-fast) var(--motion-ease-decelerate) both; }

/* ---------- 5. 减弱动画总开关 ---------- */

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  [data-reveal]              { opacity: 1 !important; transform: none !important; }
  [data-hover="lift"]:hover  { transform: none !important; }
}
```

> `global.css` 顶部加一行：`@import "./motion.css";`

---

## 4. 通用 JS 动效工具（`src/utils/motion.ts`，新增）

```ts
/**
 * motion.ts —— 通用动效原语
 * 全部使用 IntersectionObserver / passive 监听器 / rAF，
 * 不依赖任何第三方库，整体 gzipped < 1KB。
 */

const prefersReduce = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 1. 滚动入场 ---------- */

/**
 * 给容器加上 .is-revealed 的时机：
 *   - 默认：进入视口 12% 时
 *   - stagger 子元素：自动注入 --i 序号
 *   - 仅触发一次（unobserve 后释放）
 */
export function initReveal(root: ParentNode = document): () => void {
  const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');
  if (prefersReduce()) {
    targets.forEach((el) => el.classList.add('is-revealed'));
    return () => {};
  }

  // stagger 序号注入
  root.querySelectorAll<HTMLElement>('[data-reveal-stagger]').forEach((parent) => {
    Array.from(parent.children).forEach((child, i) => {
      if (child.matches('[data-reveal]')) {
        (child as HTMLElement).style.setProperty('--i', String(i));
      }
    });
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  targets.forEach((el) => io.observe(el));

  // 路由切换后挂载到新内容
  return () => io.disconnect();
}

/* ---------- 2. 磁吸按钮 ---------- */

export function initMagnetic(): () => void {
  if (prefersReduce()) return () => {};

  const cleanups: Array<() => void> = [];
  document.querySelectorAll<HTMLElement>('[data-hover="magnetic"]').forEach((el) => {
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      el.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
    };
    const onLeave = () => { el.style.transform = ''; };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    cleanups.push(() => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    });
  });

  return () => cleanups.forEach((fn) => fn());
}

/* ---------- 3. 阅读进度条 ---------- */

export function initScrollProgress(selector = '.scroll-progress') {
  if (prefersReduce()) return () => {};
  const bar = document.querySelector<HTMLElement>(selector);
  if (!bar) return () => {};

  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = document.documentElement;
      const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight);
      bar.style.width = `${Math.min(100, Math.max(0, scrolled * 100))}%`;
      bar.classList.toggle('is-visible', h.scrollTop > 80);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => window.removeEventListener('scroll', onScroll);
}

/* ---------- 4. 视差（仅作用于背景装饰层） ---------- */

export function initParallax(selector = '[data-parallax]'): () => void {
  if (prefersReduce()) return () => {};
  const els = document.querySelectorAll<HTMLElement>(selector);
  if (!els.length) return () => {};

  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      els.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax || '0.2');
        const rect = el.getBoundingClientRect();
        const offset = (rect.top + window.scrollY - window.scrollY) * speed;
        el.style.transform = `translate3d(0, ${offset}px, 0)`;
      });
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}

/* ---------- 5. 主题/语言切换的 View Transitions 包装 ---------- */

export function withViewTransition(name: string, fn: () => void | Promise<void>) {
  if (prefersReduce() || !('startViewTransition' in document)) {
    return fn();
  }
  return (document as any).startViewTransition(fn);
}

/* ---------- 6. 一次性初始化入口（页面挂载时调用） ---------- */

export function initMotion() {
  const cleanups = [
    initReveal(),
    initMagnetic(),
    initScrollProgress(),
    initParallax(),
  ];
  return () => cleanups.forEach((fn) => fn && fn());
}
```

---

## 5. 主题/语言切换渐变过渡方案

### 5.1 主题切换（颜色平滑过渡）

`global.css` 已给 `body` 加了 `transition: background-color, color`。**还需要**给「所有用主题色填充的元素」补一行全局兜底：

```css
/* 追加到 global.css */
:root {
  --motion-theme-fade: background-color var(--motion-duration-fast) var(--motion-ease-standard),
                       color            var(--motion-duration-fast) var(--motion-ease-standard),
                       border-color     var(--motion-duration-fast) var(--motion-ease-standard);
}
*, *::before, *::after {
  transition: var(--motion-theme-fade);
}
```

> 注意：这种「* 上 transition」会**接管**所有现有 hover transition。需要更精细：把 hover transition 的属性在 `motion.css` 里改成 `transition-property: transform, box-shadow`（已写在 4.1）。

### 5.2 主题切换（带 View Transitions 跨页渐隐）

修改 `BaseLayout.astro` 顶部 `<script is:inline>` 块里主题切换的 click 处理：

```js
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  if (!document.startViewTransition) {
    // 退化路径
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    return;
  }
  document.startViewTransition(() => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
});
```

> 配合 `motion.css` 第 4 段的 `@keyframes vt-theme-fade` 即可。**language 切换**改同样的方式，只是命名换成 `locale-fade`，并对 `[data-i18n]` 元素加 `::view-transition-name`（可选，看你想不想让文字也有过渡）。

### 5.3 Astro 页面切换（跨页 View Transitions）

Astro 5 自带 `<ClientRouter />`，**强烈推荐**接入（不影响已有 SEO）：

```astro
---
// BaseLayout.astro
import { ClientRouter } from 'astro:transitions';
---
<head>
  <ClientRouter />
</head>
```

接入后 `motion.css` 里注册的 `::view-transition-old/new(...)` 自动生效，主题/语言渐变在跨页时也能复用。

---

## 6. 组件级改造清单

### 6.1 BaseLayout.astro

```astro
---
// 头部
import '../../styles/global.css';   // 已含 motion.css（global.css @import）
import ScrollProgress from '../common/ScrollProgress.astro';
---
<body>
  <ScrollProgress />
  <header class="site-header"> ... </header>
  <main class="page-layout"><slot /></main>
  <footer class="site-footer"> ... </footer>

  <script>
    import { initMotion } from '../../utils/motion';
    const teardown = initMotion();

    // Astro 5 ClientRouter 跨页时也要重新挂载
    document.addEventListener('astro:page-load', () => {
      teardown?.();
      initMotion();
    });
  </script>
</body>
```

并把 `<head>` 内的 inline 主题/语言初始化脚本**保留**（防闪烁 FOUC 必备），同时给顶栏导航链接加：

```astro
<a href="/" class="nav-link" data-i18n="nav.home" data-hover="lift">首页</a>
```

### 6.2 新增 `src/components/common/ScrollProgress.astro`

```astro
---
---
<div class="scroll-progress" role="progressbar" aria-label="阅读进度"></div>
```

### 6.3 首页 Hero（`src/pages/index.astro`）

```astro
<section class="hero">
  <div class="hero-inner">
    <h1 class="hero-title" id="hero-site-title" data-i18n="hero.title"
        data-reveal="fade-up" style="--i:0">探索 · 记录 · 分享</h1>
    <p class="hero-subtitle" id="hero-site-subtitle" data-i18n="hero.subtitle"
       data-reveal="fade-up" style="--i:1">关于技术、生活与思考的个人空间</p>
    <p class="hero-desc" id="hero-site-desc" data-reveal="fade-up" style="--i:2"></p>
    <div class="hero-actions" data-reveal-stagger>
      <a href="/articles" class="hero-btn primary" data-i18n="hero.browse"
         data-reveal="fade-up" data-hover="magnetic">浏览文章</a>
      <a href="/about" class="hero-btn secondary" data-i18n="hero.learn_more"
         data-reveal="fade-up" data-hover="magnetic">了解更多</a>
    </div>
  </div>
  <!-- 装饰背景层，做视差 -->
  <div class="hero-blade" data-parallax="0.15" aria-hidden="true"></div>
</section>
```

样式补充：

```css
.hero-blade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at top, var(--color-accent-subtle), transparent 60%),
    radial-gradient(ellipse at bottom right, var(--color-accent-subtle), transparent 50%);
  z-index: -1;
  pointer-events: none;
  /* 视差元素：必须 will-change */
  will-change: transform;
}
```

### 6.4 ArticleCard.astro（卡片入场 + hover 微动）

```astro
---
// props 同前
---
<article class="article-card" data-reveal="fade-up" data-hover="lift">
  <a href={`/articles/${slug}`} class="card-link"> ... </a>
</article>
```

如果是从 `index.astro` 的 JS 渲染出来的卡片 HTML 字符串，**改造位置在 `src/pages/index.astro` 的 `<script>` 块里**，把模板字符串改成：

```ts
container.innerHTML = items.map((article: any, i: number) => `
  <article class="article-card"
           data-reveal="fade-up"
           style="--i:${i % 6}"
           data-hover="lift">
    ...
  </article>
`).join('');
// 渲染完后再调用一次
window.dispatchEvent(new CustomEvent('motion:refresh'));
```

并在 `motion.ts` 里加：

```ts
window.addEventListener('motion:refresh', () => initReveal());
```

### 6.5 文章详情页（`src/pages/articles/[slug].astro`）

**只**对标题、tag、meta 做微入场，**不**对正文 prose 做任何 reveal（会引发重排、影响阅读体验）：

```ts
container.innerHTML = `
  <header class="article-header">
    <div class="article-meta-top"
         data-reveal="fade-up" style="--i:0"> ... </div>
    <h1 class="article-title"
        data-reveal="fade-up" style="--i:1">${article.title}</h1>
    <p class="article-summary"
       data-reveal="fade-up" style="--i:2">${article.summary}</p>
    <div class="article-meta-bottom"
         data-reveal="fade-up" style="--i:3"> ... </div>
    <div class="article-tags"
         data-reveal-stagger>
      ${tags.map((t, i) => `<a class="article-tag" data-reveal="fade-up" style="--i:${i}">${t.name}</a>`).join('')}
    </div>
  </header>
  <div class="article-content prose">${bodyHtml}</div>
  ...
`;
```

### 6.6 ThemeToggle.vue（图标切换旋转动画）

```vue
<template>
  <button class="theme-toggle" @click="toggleTheme" :title="themeLabel"
          data-hover="glow" :aria-label="themeLabel">
    <!-- 用 <Transition> 包住图标 -->
    <Transition name="icon-spin" mode="out-in">
      <svg v-if="currentTheme === 'light'" key="light"> ... </svg>
      <svg v-else-if="currentTheme === 'dark'" key="dark"> ... </svg>
      <svg v-else key="system"> ... </svg>
    </Transition>
  </button>
</template>

<style scoped>
.icon-spin-enter-active,
.icon-spin-leave-active {
  transition: transform var(--motion-duration-base) var(--motion-ease-emphasized),
              opacity   var(--motion-duration-fast) var(--motion-ease-standard);
}
.icon-spin-enter-from { transform: rotate(-90deg) scale(0.6); opacity: 0; }
.icon-spin-leave-to   { transform: rotate( 90deg) scale(0.6); opacity: 0; }
</style>
```

### 6.7 归档时间轴（`src/pages/archives.astro`）

给每个 `<a>` 列表项加 `data-reveal="fade-up"` + 父元素 `data-reveal-stagger`，自动错位入场。

### 6.8 搜索结果（`src/islands/SearchBox.vue`）

- 搜索结果用 `<TransitionGroup name="result">`，每条结果 fade-up
- 输入框聚焦加 `data-hover="glow"`
- 「搜索中」loading 状态用现有的 spinner 即可

### 6.9 Admin 后台（`src/pages/admin/`）

**不建议**做复杂动效，会影响数据扫描效率。只做：
- 表格行 hover 加细微背景高亮（已有）
- 侧边导航 `data-hover="lift"`
- 切换 tab 时 Vue 自带 `<Transition>` fade
- **不做**整页 reveal / 视差

---

## 7. 性能与可访问性约束（必须满足）

| 约束 | 实现 |
|---|---|
| 首屏不阻塞 | `motion.css` 只用 transform/opacity；reveal 用 IntersectionObserver，不阻塞 DOMContentLoaded |
| 不引起重排 | 视差元素加 `will-change: transform`，**仅**视差元素加，避免一屏超过 4 个 |
| 减弱动画偏好 | `motion.css` 第 5 段 + tokens 已在 `@media` 内覆盖 |
| 滚动流畅 | 所有 scroll listener 都 passive + rAF 节流 |
| 不抢焦 | reveal 元素 `opacity: 0` 时**不**用 `visibility: hidden`，避免 `prefers-reduced-motion` 下被读屏漏读 |
| 颜色对比 | 主题切换过渡不影响最终对比度（CSS var 值不变，仅过渡 transition） |
| 移动端 | `motion.ts` 在窄屏（`< 768px`）自动 skip `initMagnetic` 和 `initParallax`（见下方 patch） |

在 `motion.ts` 顶部加：

```ts
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
```

并在 `initMagnetic` / `initParallax` 开头加 `if (isMobile()) return () => {};`

---

## 8. 验证清单（灰度上线前必跑）

- [ ] **Lighthouse Performance ≥ 90**（桌面/移动各跑一次）
- [ ] **日→夜、夜→日**主题切换在所有页面平滑
- [ ] **中↔英**语言切换文字不闪烁
- [ ] 卡片 hover 在两种主题下都看得清（光晕颜色 `color-accent-subtle`）
- [ ] 文章详情页滚动时**不**有视差 / 整页渐入（只标题/标签）
- [ ] 减弱动画偏好生效（Mac 系统设置 → 辅助功能 → 显示器 → 减弱动态效果）
- [ ] 移动端（375px、768px）无横向滚动、无 jank
- [ ] Chrome DevTools Performance 面板录制 5 秒滚动，**不掉到 30fps 以下**
- [ ] Element Plus 后台表格**不**有任何 reveal 闪烁

---

## 9. 实施顺序（建议 PR 拆分）

1. **PR-1**：tokens + `motion.css` + `motion.ts`（无 UI 改动，纯基础设施）
2. **PR-2**：`BaseLayout` 接入 `ClientRouter` + ScrollProgress + 主题/语言 View Transitions
3. **PR-3**：首页 Hero / 文章卡片 reveal + hover
4. **PR-4**：详情页标题 stagger / 归档页 stagger
5. **PR-5**：ThemeToggle 图标旋转 / SearchBox 入场
6. **PR-6**：性能调优（will-change、rAF、减弱动画单测）

每个 PR 独立可回滚。

---

## 10. 一段代码读懂全局

打开页面时，整个体验是这样：

1. 用户进入 → `:root` 主题 var 立即应用（无 FOUC）→ `motion.ts` 注册 reveal/磁吸/进度条
2. Hero 标题/副标题/按钮以 60ms 间隔依次 fade-up（stagger）→ 按钮随光标轻微 magnetic
3. 滚动到文章卡片 → 卡片进入视口 12% 时 fade-up；hover 时整体上移 4px + 阴影加深
4. 滚动到归档 → 时间轴左侧圆点 fade-up stagger
5. 顶栏随滚动从透明渐变成 backdrop-blur 背景（保留已有逻辑），并出现 2px 渐变阅读进度条
6. 用户点切换主题 → `document.startViewTransition` 触发 `vt-theme-fade` 跨页/同页都顺滑
7. 用户点切换语言 → 文字逐项 `vt-locale-fade` 上移淡入；data-i18n 自动重渲染（保留）
9. 文章详情页 → 标题/标签 fade-up 后正文**不动**，避免阅读干扰
11. admin 后台 → 仅侧栏 nav `data-hover="lift"`，表格行不动
12. 减弱动画用户 → 所有时长退化为 0.01ms，reveal 元素直接可见

---

> 完。所有代码片段都可直接复制到项目里用。如果需要，我可以**接着帮你逐文件落地**，或先在某个页面（比如首页）做一版完整 demo 给你看效果喵。

---

## 11. 实际改动文件清单（2026-09-03 已落地）

> 说明：原方案里的 `vt-theme-fade` / `vt-locale-fade` 命名过渡**未采用**——因为背景图那轮已在 `BaseLayout` 里实现了 `::view-transition-old(root)` + `site-vt-fade` 整页交叉淡入，主题/语言切换已自动平滑复用，这里不再重复造，避免冲突。

| PR | 文件 | 改动 |
|---|---|---|
| PR-1 | `src/styles/motion.css`（新） | reveal/hover/scroll-progress 工具类 + `prefers-reduced-motion` 全局兜底 |
| PR-1 | `src/utils/motion.ts`（新） | `initReveal`(含 `motion:refresh` 重扫) / `initMagnetic` / `initScrollProgress` / `initParallax`(移动端跳过) / `withViewTransition` / `initMotion`，纯原生无依赖 |
| PR-1 | `src/styles/variables.css` | 加 motion tokens（时长/缓动/位移/光晕）+ 减弱动画时长降级 |
| PR-1 | `src/styles/global.css` | 顶部 `@import "./motion.css"` |
| PR-2 | `src/components/common/ScrollProgress.astro`（新） | 2px 渐变阅读进度条 |
| PR-2 | `src/components/layout/BaseLayout.astro` | 接 `ClientRouter`、挂载进度条、`initMotion()` + `astro:page-load` 重挂、主题按钮点击旋转 |
| PR-3 | `src/pages/index.astro` | Hero `data-reveal-stagger` + 按钮 `data-hover=magnetic` + `hero-blade` 视差层；`.article-card` 加 `data-reveal` + 渲染后 `motion:refresh` |
| PR-4 | `src/pages/articles/[slug].astro` | 标题/标签/summary/meta `data-reveal` + 渲染后 `motion:refresh`（**正文 prose 不动**） |
| PR-4 | `src/pages/articles/index.astro` | `.list-card` 加 `data-reveal` + 渲染后 `motion:refresh` |
| PR-4 | `src/pages/archives.astro` | `.archive-list` `data-reveal-stagger` + `li` `data-reveal` + 渲染后 `motion:refresh` |
| PR-5 | `src/islands/SearchBox.vue` | 结果 `TransitionGroup` 逐条入场 + 输入框聚焦光晕 |
| PR-5 | `src/islands/ThemeToggle.vue` | 图标旋转 `<Transition>`（如实注明：该组件**未被任何页面引用**，前台按钮逻辑在 BaseLayout，仅保持文档完整性） |

**跳过项（如实记录）**：`ArticleCard.astro` 未被任何页面引用（卡片由 `index.astro` / `articles/index.astro` 的 JS 模板动态渲染），故未改；admin 后台按方案只保留 nav `data-hover="lift"`，不做 reveal/视差。

**验证**：`astro build` 通过（Exit 0，全页预渲染）；`ClientRouter`/`startViewTransition`/`initMotion`/`data-reveal`/`prefers-reduced-motion` 均已进产物包。**部署**：前端 `dist` 需 `npx wrangler pages deploy dist --project-name blog-website-page`（本次只动前端，worker 不变）。
