/**
 * 弹窗焦点陷阱（issue #67 / 编辑器 T6），纯 DOM 模块。
 *
 * 刻意不依赖 Vue：src/admin/editor/useFocusTrap.ts 只做生命周期绑定，
 * 行为本身由 tests/editor-focus-trap.test.ts 在 jsdom 里直接钉住。
 * 契约：打开时记住触发按钮 → 焦点移入容器 → Tab / Shift+Tab 在容器内循环
 * → 关闭后焦点归还触发按钮（若它仍在文档中）。
 */

/** 可聚焦元素；disabled 与 tabindex="-1"（常见 dialog 容器自身）不入序列。 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** 返回 Tab 后应聚焦的索引；count 为 0 时返回 -1。current 为 -1 表示焦点在容器外。 */
export function nextFocusIndex(
  current: number,
  count: number,
  shift: boolean
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface FocusTrap {
  activate(): void;
  deactivate(): void;
}

export function createFocusTrap(root: HTMLElement): FocusTrap {
  let trigger: HTMLElement | null = null;
  let active = false;

  function onKeydown(event: KeyboardEvent): void {
    if (!active || event.key !== "Tab") return;
    const items = focusables(root);
    // 用捕获阶段监听，避免被弹窗自身的 Esc / 快捷键处理器 stopPropagation 挡掉；
    // 无可聚焦元素时也要吞掉 Tab，否则焦点会跑到弹窗背后的页面。
    event.preventDefault();
    if (items.length === 0) {
      root.focus();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextFocusIndex(current, items.length, event.shiftKey);
    items[next].focus();
  }

  return {
    activate(): void {
      if (active) return;
      active = true;
      trigger = document.activeElement as HTMLElement | null;
      document.addEventListener("keydown", onKeydown, true);
      const first = focusables(root)[0];
      (first ?? root).focus();
    },
    deactivate(): void {
      if (!active) return;
      active = false;
      document.removeEventListener("keydown", onKeydown, true);
      if (
        trigger &&
        trigger.isConnected &&
        typeof trigger.focus === "function"
      ) {
        trigger.focus();
      }
      trigger = null;
    },
  };
}
