import { afterEach, describe, expect, it } from "vitest";
import {
  createFocusTrap,
  FOCUSABLE_SELECTOR,
  nextFocusIndex,
} from "../src/utils/editor/focusTrap";

/**
 * issue #67（编辑器 T6）弹窗焦点陷阱行为基线。
 *
 * 焦点逻辑刻意做成「纯 DOM 模块」而非 Vue 组件内私有方法：Vue composable 只
 * 负责生命周期绑定，行为本身可在 jsdom 里直接钉住，不引入 @vue/test-utils。
 * 期望值全部手写字面量。
 */

function scene(): {
  trigger: HTMLButtonElement;
  dialog: HTMLDivElement;
  first: HTMLInputElement;
  second: HTMLButtonElement;
  last: HTMLAnchorElement;
} {
  document.body.innerHTML = `
    <button id="trigger" type="button">打开</button>
    <div id="dialog" role="dialog" aria-modal="true" tabindex="-1">
      <input id="first" type="text" />
      <button id="second" type="button">二</button>
      <button id="disabled" type="button" disabled>三</button>
      <a id="last" href="#x">末</a>
    </div>
  `;
  const trigger = document.querySelector("#trigger") as HTMLButtonElement;
  const dialog = document.querySelector("#dialog") as HTMLDivElement;
  return {
    trigger,
    dialog,
    first: document.querySelector("#first") as HTMLInputElement,
    second: document.querySelector("#second") as HTMLButtonElement,
    last: document.querySelector("#last") as HTMLAnchorElement,
  };
}

function tab(options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("nextFocusIndex：Tab / Shift+Tab 在容器内循环", () => {
  it("正向从末尾回到开头", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it("反向从开头回到末尾", () => {
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(1, 3, true)).toBe(0);
    expect(nextFocusIndex(2, 3, true)).toBe(1);
  });

  it("焦点不在容器内（-1）时，正向从头、反向从尾", () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it("单个可聚焦元素时停在自身；没有可聚焦元素返回 -1", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });
});

describe("createFocusTrap：焦点陷阱与焦点归还", () => {
  it("activate 记住触发按钮并把焦点移入弹窗第一个可聚焦元素", () => {
    const { trigger, dialog, first } = scene();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const trap = createFocusTrap(dialog);
    trap.activate();

    expect(document.activeElement).toBe(first);
    trap.deactivate();
  });

  it("deactivate 后焦点归还触发按钮", () => {
    const { trigger, dialog } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();
    trap.deactivate();

    expect(document.activeElement).toBe(trigger);
  });

  it("Tab 在容器内循环，disabled 与 tabindex=-1 不进入序列", () => {
    const { trigger, dialog, first, second, last } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();

    expect(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).toHaveLength(3);

    const forward = tab();
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);

    document.dispatchEvent(tab());
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(tab());
    expect(document.activeElement).toBe(first);

    const backward = tab({ shiftKey: true });
    document.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    trap.deactivate();
  });

  it("非 Tab 键不拦截、不改变焦点", () => {
    const { trigger, dialog, first } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);

    trap.deactivate();
  });

  it("deactivate 后不再拦截 Tab", () => {
    const { trigger, dialog } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();
    trap.deactivate();

    const event = tab();
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("触发按钮已从 DOM 移除时 deactivate 不抛错", () => {
    const { trigger, dialog } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();
    trigger.remove();

    expect(() => trap.deactivate()).not.toThrow();
  });

  it("容器内无可聚焦元素时 Tab 被吞掉并把焦点留在容器上", () => {
    const { trigger, dialog } = scene();
    dialog.innerHTML = "<p>纯文本</p>";
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();
    expect(document.activeElement).toBe(dialog);

    const event = tab();
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);

    trap.deactivate();
  });

  it("重复 activate / deactivate 幂等，不会叠加监听", () => {
    const { trigger, dialog, first, second } = scene();
    trigger.focus();
    const trap = createFocusTrap(dialog);
    trap.activate();
    trap.activate();

    document.dispatchEvent(tab());
    expect(document.activeElement).toBe(second);
    expect(first).not.toBe(document.activeElement);

    trap.deactivate();
    trap.deactivate();
    expect(document.activeElement).toBe(trigger);
  });
});
