/**
 * useFocusTrap：把 src/utils/editor/focusTrap.ts 的纯 DOM 陷阱接到 Vue 生命周期。
 *
 * 这里的弹窗互斥（EditorState.dialog 是单值），同一时刻只会有一个 trap 激活，
 * 因此不需要堆叠管理：可见时激活、不可见时停用并归还焦点、卸载时兜底停用。
 * flush: "post" + nextTick 保证 v-if 的弹窗 DOM 已经挂载。
 */
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";
import { createFocusTrap, type FocusTrap } from "../../utils/editor/focusTrap";

export function useFocusTrap(
  root: Ref<HTMLElement | null>,
  visible: Ref<boolean>
): void {
  let trap: FocusTrap | null = null;

  function stop(): void {
    trap?.deactivate();
    trap = null;
  }

  async function sync(isVisible: boolean): Promise<void> {
    stop();
    if (!isVisible) return;
    await nextTick();
    const element = root.value;
    if (!element) return;
    // sync 可能在 await 期间被后一次 watch 覆盖；再确认一次可见性。
    if (!visible.value) return;
    trap = createFocusTrap(element);
    trap.activate();
  }

  watch(
    visible,
    (isVisible) => {
      void sync(isVisible);
    },
    { immediate: true, flush: "post" }
  );

  onBeforeUnmount(stop);
}
