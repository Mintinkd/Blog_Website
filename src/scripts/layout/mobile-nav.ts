/**
 * 移动端导航：汉堡按钮 + 下拉面板（issue #103 / L4）。
 *
 * 事件全部委托到 document，ClientRouter 跨页替换 DOM 后无需重绑。
 */
export function initMobileNav(): void {
  const root = document.documentElement;
  const desktopMq = window.matchMedia("(min-width: 768px)");

  const setOpen = (open: boolean) => {
    root.classList.toggle("nav-open", open);
    document.querySelector(".site-header")?.classList.toggle("nav-open", open);
    document
      .getElementById("nav-toggle")
      ?.setAttribute("aria-expanded", String(open));
  };

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target || !target.closest) return;

    if (target.closest("#nav-toggle")) {
      const open = !root.classList.contains("nav-open");
      setOpen(open);
      // 打开后把焦点交给第一个菜单项，键盘用户少按一次 Tab
      if (open) {
        document
          .querySelector<HTMLElement>("#site-nav a")
          ?.focus({ preventScroll: true });
      }
      return;
    }

    if (target.closest("#site-nav a")) {
      setOpen(false);
      return;
    }

    // 点击菜单以外的页面区域收起
    if (
      root.classList.contains("nav-open") &&
      !target.closest(".site-header")
    ) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !root.classList.contains("nav-open")) return;
    setOpen(false);
    document.getElementById("nav-toggle")?.focus({ preventScroll: true });
  });

  const closeOnDesktop = () => {
    if (desktopMq.matches) setOpen(false);
  };
  desktopMq.addEventListener("change", closeOnDesktop);

  // ClientRouter 会保留 html 上的 class；导航后必须显式收起
  document.addEventListener("astro:after-swap", () => setOpen(false));
  document.addEventListener("astro:page-load", () => setOpen(false));
}
