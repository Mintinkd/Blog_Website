/**
 * 后台统一认证请求。
 *
 * 拆分前 `App.vue` 的 `api()` / `authHeaders()` 原样搬来：所有请求带 `/api/v1`
 * 前缀（worker 路由只匹配该前缀），`10003` 触发会话失效、`10004` 只告警。
 * fetch 与 token 由调用方注入，使请求接缝可以在 node 环境单测。
 */
export interface AdminApiDeps {
  fetchImpl: typeof fetch;
  getToken: () => string;
  onSessionExpired: () => void;
  apiBase?: string;
}

export interface AdminApi {
  (method: string, path: string, body?: unknown): Promise<any>;
  authHeaders(): Record<string, string>;
  apiBase: string;
}

export function createAdminApi(deps: AdminApiDeps): AdminApi {
  const apiBase = deps.apiBase ?? "/api/v1";

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deps.getToken()}`,
    };
  }

  async function request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const opts: RequestInit = { method, headers: authHeaders() };
    if (body) opts.body = JSON.stringify(body);
    const res = await deps.fetchImpl(`${apiBase}${path}`, opts);
    const data = await res.json();
    if (data.code === 10003) {
      // 会话失效：先同步落盘本地草稿 + 尽力释放锁，再退出到登录页；不清该用户草稿。
      deps.onSessionExpired();
    }
    if (data.code === 10004) {
      console.warn("Permission denied:", data.message);
    }
    return data;
  }

  return Object.assign(request, { authHeaders, apiBase });
}
