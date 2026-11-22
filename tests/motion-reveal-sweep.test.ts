import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 平板快速滑动「UI 丢失」回归（根因：IntersectionObserver 漏观测）。
 *
 * 现场：平板上反复上下滑动，文章卡片 / 某个区块整片空白，继续滑动又恢复。
 * 机制：fling 时元素可能在一帧内整段跨过视口，IO 前后两次观测都是「不相交」，
 * 收不到 isIntersecting，元素永远停在 opacity: 0；等它再次进入视口才被补上。
 *
 * 这里把 IO 打桩成「永不回调」（等价于漏观测），验证 scroll 兜底扫描能把
 * 已到达 / 已越过视口的元素补成 is-revealed，同时不提前播放视口下方的元素。
 */

type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false, // 非 reduce / 非 mobile / 非 coarse：motionLevel() === 2
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

class NeverFiringIntersectionObserver {
  static instances: NeverFiringIntersectionObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback) {
    NeverFiringIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** 建一个可控几何位置的 [data-reveal] 元素；改 rect 即模拟滚动后的位置。 */
function makeTarget(rect: Rect) {
  const el = document.createElement("div");
  el.setAttribute("data-reveal", "fade-up");
  el.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function loadMotion() {
  vi.resetModules();
  return import("../src/utils/motion");
}

beforeEach(() => {
  document.body.innerHTML = "";
  stubMatchMedia();
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
  vi.stubGlobal("IntersectionObserver", NeverFiringIntersectionObserver);
  NeverFiringIntersectionObserver.instances = [];
});

describe("快速滑动时 reveal 的 scroll 兜底", () => {
  it("IO 漏掉的元素：已被滚过视口后，scroll 兜底把它补成可见", async () => {
    const rect: Rect = {
      top: 900,
      bottom: 1000,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
    };
    const el = makeTarget(rect);
    const { initReveal } = await loadMotion();

    initReveal();
    expect(el.classList.contains("is-revealed")).toBe(false);

    // 模拟 fling：元素在一帧内从视口下方跳到视口上方，IO 从未看到它相交
    rect.top = -200;
    rect.bottom = -100;
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextFrame();

    expect(el.classList.contains("is-revealed")).toBe(true);
  });

  it("首屏恢复滚动位置：初始化时已越过视口的元素直接可见", async () => {
    makeTarget({
      top: -300,
      bottom: -200,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
    });
    const { initReveal } = await loadMotion();

    initReveal();

    expect(
      document.querySelector("[data-reveal]")!.classList.contains("is-revealed")
    ).toBe(true);
  });

  it("视口下方的元素不提前播放（滚动后仍保持隐藏）", async () => {
    makeTarget({
      top: 900,
      bottom: 1000,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
    });
    const { initReveal } = await loadMotion();

    initReveal();
    window.dispatchEvent(new Event("scroll"));
    await nextFrame();
    await nextFrame();

    expect(
      document.querySelector("[data-reveal]")!.classList.contains("is-revealed")
    ).toBe(false);
  });

  it("IO 正常命中时仍按原路径入场", async () => {
    makeTarget({
      top: 100,
      bottom: 200,
      left: 0,
      right: 300,
      width: 300,
      height: 100,
    });
    const { initReveal } = await loadMotion();

    initReveal();
    const observer = NeverFiringIntersectionObserver.instances[0];
    const el = document.querySelector("[data-reveal]") as Element;
    observer.callback(
      [
        {
          target: el,
          isIntersecting: true,
        } as unknown as IntersectionObserverEntry,
      ],
      observer as unknown as IntersectionObserver
    );

    expect(el.classList.contains("is-revealed")).toBe(true);
  });
});
