/**
 * motion.ts —— 通用动效原语
 *
 * 设计原则：
 * - 零第三方依赖；IntersectionObserver / passive listener / rAF 节流
 * - 只用 transform / opacity，不触发 layout
 * - 严格遵守 prefers-reduced-motion 与移动端降级
 */

const prefersReduce = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const isMobile = (): boolean =>
  window.matchMedia('(max-width: 768px)').matches;

/* ---------- 1. 滚动入场 ---------- */

let revealObserver: IntersectionObserver | null = null;

function ensureRevealObserver(): IntersectionObserver {
  if (revealObserver) return revealObserver;
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          revealObserver!.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  return revealObserver;
}

function injectStagger(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-reveal-stagger]').forEach((parent) => {
    Array.from(parent.children).forEach((child, i) => {
      const el = child as HTMLElement;
      if (el.matches('[data-reveal]')) {
        el.style.setProperty('--i', String(i));
      }
    });
  });
}

export function initReveal(root: ParentNode = document): void {
  const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');
  if (prefersReduce()) {
    // 减弱动画：直接显示，不做入场
    targets.forEach((el) => el.classList.add('is-revealed'));
    return;
  }
  injectStagger(root);
  const io = ensureRevealObserver();
  targets.forEach((el) => io.observe(el));
}

// 动态渲染（文章卡片 / 列表 / 归档 / 搜索结果）后通知重新扫描新节点
if (typeof window !== 'undefined') {
  window.addEventListener('motion:refresh', () => initReveal());
}

/* ---------- 2. 磁吸按钮 ---------- */

export function initMagnetic(): void {
  if (prefersReduce() || isMobile()) return;
  document.querySelectorAll<HTMLElement>('[data-hover="magnetic"]').forEach((el) => {
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      el.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
    };
    const onLeave = () => {
      el.style.transform = '';
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  });
}

/* ---------- 3. 阅读进度条 ---------- */

export function initScrollProgress(selector = '.scroll-progress'): void {
  if (prefersReduce()) return;
  const bar = document.querySelector<HTMLElement>(selector);
  if (!bar) return;

  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const scrolled = max > 0 ? h.scrollTop / max : 0;
      bar.style.width = `${Math.min(100, Math.max(0, scrolled * 100))}%`;
      bar.classList.toggle('is-visible', h.scrollTop > 80);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- 4. 视差（仅作用于装饰层 / 背景层） ---------- */

export function initParallax(selector = '[data-parallax]'): void {
  if (prefersReduce() || isMobile()) return;
  const els = document.querySelectorAll<HTMLElement>(selector);
  if (!els.length) return;

  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      els.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax || '0.1');
        const rect = el.getBoundingClientRect();
        // 元素越往上滚（rect.top 越小）反向位移，制造视差；speed 很小（≤0.12）不干扰阅读
        el.style.transform = `translate3d(0, ${(-rect.top * speed).toFixed(1)}px, 0)`;
      });
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
}

/* ---------- 5. View Transitions 包装（供主题/语言切换调用） ---------- */

export function withViewTransition(fn: () => void | Promise<void>): void | Promise<void> {
  if (prefersReduce() || !('startViewTransition' in document)) {
    return fn();
  }
  return (document as any).startViewTransition(fn);
}

/* ---------- 6. 一次性初始化入口 ---------- */

export function initMotion(): void {
  initReveal();
  initMagnetic();
  initScrollProgress();
  initParallax();
}
