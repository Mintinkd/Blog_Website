/**
 * 全局悬浮一言组件：可拖动 + 位置记忆 + 跨页复原（issue #103 / L4）。
 *
 * 从 BaseLayout 内联脚本原样抽出。内容请求走 `window.fetchWithProxy(..., { forceProxy: true })`
 * —— api.furry.ist 在部分地区直连会触发证书 / SNI 干扰，强制走本站 text-proxy。
 * 刷新时追加时间戳参数绕过 text-proxy 的 KV 缓存（否则 24h 内永远命中同一句）；
 * 首载不带参数，命中缓存秒开。
 */
export function initHitokotoWidget(): void {
  const POS_KEY = "hitokoto-widget-pos";
  const API_URL = "https://api.furry.ist/hitokoto/";

  class HitokotoWidget extends HTMLElement {
    connectedCallback() {
      if ((this as any)._inited) return;
      (this as any)._inited = true;

      const root = this;
      const btn = root.querySelector(".hk-btn") as HTMLButtonElement;
      const card = root.querySelector(".hk-card") as HTMLElement;
      const textEl = root.querySelector(".hk-text") as HTMLElement;
      const fromEl = root.querySelector(".hk-from") as HTMLElement;
      const refreshBtn = root.querySelector(".hk-refresh") as HTMLButtonElement;
      if (!btn || !card) return;

      // ---- 位置：localStorage 记忆，默认右下 ----
      let pos: { x: number; y: number } | null = null;
      try {
        pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      } catch {}
      if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number")
        pos = { x: 88, y: 84 };
      const apply = (p: { x: number; y: number }) => {
        root.style.left = p.x + "%";
        root.style.top = p.y + "%";
      };
      apply(pos);
      const readPos = () => {
        const x = parseFloat(root.style.left) || 88;
        const y = parseFloat(root.style.top) || 84;
        return { x, y };
      };

      // ---- 边界约束：组件（含展开的卡片）必须完整落在视口内，越界弹回最近合法位置 ----
      const MARGIN = 8;
      const isCompactViewport = () =>
        window.matchMedia("(max-width: 767px)").matches;
      const ensureInView = () => {
        // 窄屏位置由 CSS 固定在右下角，不再读写百分比坐标
        if (isCompactViewport()) return false;
        const br = btn.getBoundingClientRect();
        const rects = [br];
        if (!card.hidden) rects.push(card.getBoundingClientRect());
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const left = Math.min(...rects.map((r) => r.left));
        const right = Math.max(...rects.map((r) => r.right));
        const vw = window.innerWidth,
          vh = window.innerHeight;
        // 顶部禁区 = 固定导航栏高度 + 留白：组件（含展开卡片）不得进入导航栏区域
        const headerEl = document.querySelector(".site-header");
        const topMin =
          (headerEl ? headerEl.getBoundingClientRect().height : 0) + MARGIN;
        let dx = 0,
          dy = 0;
        if (top < topMin) dy = topMin - top;
        else if (bottom > vh - MARGIN) dy = vh - MARGIN - bottom;
        if (left < MARGIN) dx = MARGIN - left;
        else if (right > vw - MARGIN) dx = vw - MARGIN - right;
        if (dx || dy) {
          const p = readPos();
          apply({
            x: Math.min(97, Math.max(3, p.x + (dx / vw) * 100)),
            y: Math.min(97, Math.max(3, p.y + (dy / vh) * 100)),
          });
          return true;
        }
        return false;
      };
      (this as any)._ensureInView = ensureInView;

      // 卡片默认在按钮上方展开；上方空间不足时翻转到按钮下方，保证卡片不进视口外
      const updateCardSide = () => {
        const headerEl = document.querySelector(".site-header");
        const topMin =
          (headerEl ? headerEl.getBoundingClientRect().height : 0) + MARGIN;
        const spaceAbove = btn.getBoundingClientRect().top - topMin;
        const cardH = card.offsetHeight || 130;
        root.classList.toggle("card-below", spaceAbove < cardH + 16);
      };

      // ---- 拖动：pointer 事件，位移 > 6px 视为拖动；拖动过程实时弹回视口内 ----
      let dragging = false;
      let moved = 0;
      let sx = 0,
        sy = 0,
        spx = 0,
        spy = 0;
      btn.addEventListener("pointerdown", (e) => {
        dragging = true;
        moved = 0;
        sx = e.clientX;
        sy = e.clientY;
        const p = readPos();
        spx = p.x;
        spy = p.y;
        btn.setPointerCapture(e.pointerId);
      });
      btn.addEventListener("pointermove", (e) => {
        if (!dragging || isCompactViewport()) return;
        const dx = e.clientX - sx,
          dy = e.clientY - sy;
        moved = Math.max(moved, Math.abs(dx), Math.abs(dy));
        const nx = Math.min(
          97,
          Math.max(3, spx + (dx / window.innerWidth) * 100)
        );
        const ny = Math.min(
          97,
          Math.max(3, spy + (dy / window.innerHeight) * 100)
        );
        root.style.left = nx + "%";
        root.style.top = ny + "%";
        ensureInView();
      });
      const endDrag = (_e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        if (moved <= 6) {
          toggleCard();
        } else {
          ensureInView();
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(readPos()));
          } catch {}
        }
      };
      btn.addEventListener("pointerup", endDrag);
      btn.addEventListener("pointercancel", endDrag);

      // ---- 一言内容 ----
      let loading = false;
      const load = async (force: boolean) => {
        if (loading) return;
        if (!force && textEl.textContent && textEl.textContent !== "加载中…")
          return;
        loading = true;
        textEl.textContent = "加载中…";
        fromEl.textContent = "";
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 8000);
        try {
          // api.furry.ist 在部分地区直连会触发证书/安全警告（被墙/SNI 干扰），强制走本站代理
          // 刷新时追加时间戳参数绕过 text-proxy 的 KV 缓存（否则 24h 内永远命中同一句，换一句失效）；首载不带参数命中缓存秒开
          const fetchUrl = force
            ? API_URL +
              (API_URL.indexOf("?") >= 0 ? "&" : "?") +
              "_=" +
              Date.now()
            : API_URL;
          const res = await window.fetchWithProxy(
            fetchUrl,
            { headers: { Accept: "application/json" }, signal: ctrl.signal },
            { forceProxy: true }
          );
          if (!res.ok) throw new Error("http " + res.status);
          const data = await res.json();
          const d =
            data &&
            typeof data === "object" &&
            data.data &&
            typeof data.data === "object"
              ? data.data
              : data;
          const t =
            d && typeof d.hitokoto === "string" && d.hitokoto.trim()
              ? d.hitokoto.trim()
              : "";
          if (!t) throw new Error("empty");
          textEl.textContent = t;
          const src =
            d && typeof d.from === "string" && d.from.trim()
              ? d.from.trim()
              : "";
          const who =
            d && typeof d.from_who === "string" && d.from_who.trim()
              ? d.from_who.trim()
              : "";
          fromEl.textContent = src ? (who ? `${src} —— ${who}` : src) : "";
        } catch {
          textEl.textContent = "一言获取失败，点刷新重试";
        } finally {
          window.clearTimeout(timer);
          loading = false;
        }
      };

      const toggleCard = () => {
        const show = card.hidden;
        if (show) {
          updateCardSide();
          card.hidden = false;
          ensureInView();
          load(false);
        } else {
          card.hidden = true;
        }
      };
      refreshBtn.addEventListener("click", () => load(true));
      ensureInView();
    }
  }

  if (!customElements.get("hitokoto-widget"))
    customElements.define("hitokoto-widget", HitokotoWidget);

  // 视口尺寸变化（旋转/缩放窗口）时，把当前页组件弹回视口内
  window.addEventListener("resize", () => {
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const w = document.querySelector("hitokoto-widget") as any;
    if (w && w._inited && typeof w._ensureInView === "function")
      w._ensureInView();
  });
}
