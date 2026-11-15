/**
 * 后台反馈通道：包装现有 alert / confirm，不引入新 toast UI。
 *
 * 拆分前 `App.vue` 直接调用全局 `alert` / `confirm`；这里只做一层薄封装，
 * 让面板与 composable 依赖可注入的接缝，同时保持观感与文案完全不变。
 */
export interface FeedbackDeps {
  alertImpl?: (message: string) => void;
  confirmImpl?: (message: string) => boolean;
}

export interface AdminFeedback {
  alert(message: string): void;
  confirm(message: string): boolean;
}

export function createFeedback(deps: FeedbackDeps = {}): AdminFeedback {
  return {
    alert(message: string): void {
      if (deps.alertImpl) deps.alertImpl(message);
      else globalThis.alert?.(message);
    },
    confirm(message: string): boolean {
      if (deps.confirmImpl) return deps.confirmImpl(message);
      return globalThis.confirm?.(message) ?? false;
    },
  };
}
