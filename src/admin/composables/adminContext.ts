import { inject, provide, ref, type InjectionKey, type Ref } from "vue";
import { clearUserDrafts } from "../../utils/editor/draftStore";
import { initLocale } from "../../utils/i18n.ts";
import { createSession, type AdminSession } from "./useSession";
import { createAdminApi, type AdminApi } from "./useAdminApi";
import { createFeedback, type AdminFeedback } from "./useFeedback";
import { createAdminCatalog, type AdminCatalog } from "./useAdminCatalog";
import { createAdminEditor, type AdminEditor } from "./useAdminEditor";

/**
 * 后台依赖的单一注入点。
 *
 * App.vue 在 setup 里 `createAdminContext()` 一次并 provide，11 个面板统一
 * `useAdminContext()` 取用；这样 App.vue 不再承担任何领域请求或领域模板，
 * 而会话 / 请求 / 反馈三个接缝仍各自独立、可在 node 环境单测。
 */
export interface AdminContext {
  session: AdminSession;
  api: AdminApi;
  feedback: AdminFeedback;
  catalog: AdminCatalog;
  editor: AdminEditor;
  /** 响应式 locale：切语言时让依赖 t() 的 computed 重新求值，不重挂载面板 */
  locale: Ref<string>;
}

const ADMIN_CONTEXT: InjectionKey<AdminContext> = Symbol("admin-context");

export function createAdminContext(): AdminContext {
  const storage = window.localStorage;
  // 编辑器在 api 之后创建；会话钩子通过闭包延迟引用，10003 分支仍能先落盘草稿。
  let editorRef: AdminEditor | null = null;

  const session = createSession(storage, {
    clearDrafts: (userId) => clearUserDrafts(storage, userId),
    disposeEditor: () => editorRef?.dispose(),
    expireEditor: () => editorRef?.sessionExpired() ?? Promise.resolve(),
  });

  const api = createAdminApi({
    fetchImpl: (...args) => fetch(...args),
    getToken: () => session.token.value,
    onSessionExpired: () => session.expire(),
  });

  const feedback = createFeedback();
  const catalog = createAdminCatalog(api);
  const editor = createAdminEditor({ api, session, feedback, catalog });
  editorRef = editor;

  const locale = ref(initLocale());

  return { session, api, feedback, catalog, editor, locale };
}

export function provideAdminContext(ctx: AdminContext): void {
  provide(ADMIN_CONTEXT, ctx);
}

export function useAdminContext(): AdminContext {
  const ctx = inject(ADMIN_CONTEXT, null);
  if (!ctx) {
    throw new Error(
      "AdminContext missing: App.vue must call provideAdminContext() before mounting panels"
    );
  }
  return ctx;
}
