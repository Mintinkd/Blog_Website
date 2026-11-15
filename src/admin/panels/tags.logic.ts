/**
 * TagsPanel 的纯逻辑：从 App.vue `saveTag` 抽出的请求构造。
 * 不依赖 DOM / Vue 运行时 / fetch，可在 node 环境单测。
 */
export interface TagForm {
  name: string;
  slug: string;
}

export interface TagRequest {
  method: string;
  path: string;
  body: TagForm;
}

export function buildTagRequest(form: TagForm): TagRequest {
  return { method: "POST", path: "/tags", body: form };
}
