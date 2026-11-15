/**
 * FriendLinksPanel 的纯逻辑：`saveFriendLink` 请求构造 + `safeFriendLinks`
 * 的 safe_url 装饰（issue #43 XSS 兜底）。不依赖 DOM / Vue / fetch。
 */
export interface FriendLinkForm {
  name: string;
  url: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

export interface FriendLinkRequest {
  method: string;
  path: string;
  body: any;
}

export function buildFriendLinkRequest(
  form: FriendLinkForm,
  editingId: number | null
): FriendLinkRequest {
  if (editingId) {
    return { method: "PUT", path: `/friend-links/${editingId}`, body: form };
  }
  return { method: "POST", path: "/friend-links", body: form };
}

/** 对应拆分前 computed：每行挂 safe_url，非法协议由调用方的 safeUrl 降级为空串 */
export function decorateFriendLinks(
  list: any[],
  safeUrl: (raw: unknown) => string
): any[] {
  return list.map((fl) => ({
    ...fl,
    safe_url: safeUrl(fl.url),
  }));
}
