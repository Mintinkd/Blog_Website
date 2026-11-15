import { ref, type Ref } from "vue";

/**
 * 会话状态与登录 / 登出 / 失效三条出口。
 *
 * 依赖全部由调用方注入，便于在不挂载组件、不访问真实 localStorage 的情况下单测。
 * 行为与拆分前 `App.vue` 的 handleLogin / handleLogout / 10003 分支逐条对齐：
 * - 主动登出释放编辑锁并清理该用户全部本地草稿；
 * - 10003 会话失效只尽力落盘草稿、不清草稿，也不重置 currentUserId。
 */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionHooks {
  /** 主动登出：清该用户全部本地草稿 */
  clearDrafts: (userId: number) => void;
  /** 主动登出：释放编辑锁、关闭编辑器 */
  disposeEditor: () => void;
  /** 会话失效：同步落盘草稿 + 尽力释放锁 */
  expireEditor: () => void | Promise<void>;
}

export interface LoginPayload {
  token: string;
  user?: { id?: number; role?: string } | null;
}

export interface AdminSession {
  token: Ref<string>;
  role: Ref<string>;
  userId: Ref<number>;
  isLoggedIn: Ref<boolean>;
  applyLogin(data: LoginPayload): { role: string; userId: number };
  logout(): void;
  expire(): void;
}

const TOKEN_KEY = "admin_token";
const ROLE_KEY = "admin_role";
const USER_ID_KEY = "admin_user_id";

export function createSession(
  storage: SessionStorageLike,
  hooks: SessionHooks
): AdminSession {
  const token = ref(storage.getItem(TOKEN_KEY) || "");
  const role = ref(storage.getItem(ROLE_KEY) || "editor");
  const userId = ref(Number(storage.getItem(USER_ID_KEY)) || 0);
  const isLoggedIn = ref(!!token.value);

  function clearStored(): void {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(ROLE_KEY);
    storage.removeItem(USER_ID_KEY);
  }

  function applyLogin(data: LoginPayload): { role: string; userId: number } {
    const nextRole = data.user?.role || "editor";
    const nextUserId = data.user?.id || 0;
    token.value = data.token;
    role.value = nextRole;
    userId.value = nextUserId;
    storage.setItem(TOKEN_KEY, data.token);
    storage.setItem(ROLE_KEY, nextRole);
    storage.setItem(USER_ID_KEY, String(nextUserId));
    isLoggedIn.value = true;
    return { role: nextRole, userId: nextUserId };
  }

  function logout(): void {
    hooks.disposeEditor();
    hooks.clearDrafts(userId.value);
    token.value = "";
    role.value = "editor";
    userId.value = 0;
    clearStored();
    isLoggedIn.value = false;
  }

  function expire(): void {
    void hooks.expireEditor();
    token.value = "";
    role.value = "editor";
    clearStored();
    isLoggedIn.value = false;
  }

  return { token, role, userId, isLoggedIn, applyLogin, logout, expire };
}
