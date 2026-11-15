/**
 * UsersPanel 的纯逻辑：把 `App.vue` 的 `saveUser` 请求构造抽成可在 node 环境
 * 单测的函数。不依赖 DOM / Vue / fetch。
 *
 * 编辑时只传 display_name，role 变化才追加 role，password 非空才追加 password；
 * 新建时校验 username / password，缺一返回 username_password_required。
 */
export interface UserForm {
  username: string;
  password: string;
  display_name: string;
  role: string;
}

export type UserRequest =
  | { method: string; path: string; body: any }
  | { error: "username_password_required" };

export function buildUserRequest(
  form: UserForm,
  editingId: number | null,
  originalRole: string
): UserRequest {
  if (editingId) {
    const body: any = { display_name: form.display_name };
    if (form.role !== originalRole) body.role = form.role;
    if (form.password) body.password = form.password;
    return { method: "PUT", path: `/users/${editingId}`, body };
  }
  if (!form.username || !form.password) {
    return { error: "username_password_required" };
  }
  return { method: "POST", path: "/users", body: form };
}
