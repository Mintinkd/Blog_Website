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

/** 动效强度等级：0=off, 1=reduced, 2=normal（综合系统偏好与配置中心强度） */
function motionLevel(): number {
  if (prefersReduce()) return 0;
  const attr = document.documentElement.getAttribute('data-motion-intensity');
  if (attr === 'off') return 0;
  if (attr === 'reduced') return 1;
  return 2;
}

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
  if (motionLevel() === 0) {
    // 动效全关 / 减弱偏好：直接显示，不做入场
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
  if (motionLevel() < 2 || isMobile()) return;
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
  if (motionLevel() === 0) return;
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

let parallaxBound = false;

export function initParallax(selector = '[data-parallax]'): void {
  if (motionLevel() < 2 || isMobile()) return; // off/reduced/移动端 不启用视差
  if (parallaxBound) return;                   // 防止 ClientRouter 跨页重复绑定 scroll 监听
  parallaxBound = true;
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector + ', [data-parallax-fixed]'));
  if (!els.length) return;

  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const root = document.documentElement;
      // 配置中心视差开关关闭：清除任何残留位移
      if (root.getAttribute('data-parallax') === 'off') {
        els.forEach((el) => (el.style.transform = ''));
        return;
      }
      const scrollY = window.scrollY || (window as any).pageYOffset || 0;
      const speedVar = getComputedStyle(root).getPropertyValue('--parallax-speed').trim();
      const baseSpeed = parseFloat(speedVar) || 0.04;
      els.forEach((el) => {
        let offset: number;
        if (el.hasAttribute('data-parallax-fixed')) {
          // 固定背景层：位移 = 滚动进度(0~1) × 视口高 × speed，上限受 .site-bg 的 inset 余量约束，绝不露边
          const sp = parseFloat(el.dataset.parallaxFixed || '') || baseSpeed;
          const docMax = document.documentElement.scrollHeight - document.documentElement.clientHeight;
          const prog = docMax > 0 ? Math.min(1, scrollY / docMax) : 0;
          offset = prog * window.innerHeight * sp;
        } else {
          // 文档流装饰层：随滚动位置反向位移
          const sp = parseFloat(el.dataset.parallax || '') || 0.1;
          const rect = el.getBoundingClientRect();
          offset = -rect.top * sp;
        }
        el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
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
