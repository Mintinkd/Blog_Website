/**
 * CommentsPanel 的纯逻辑：从 App.vue `loadComments` 抽出的列表路径构造。
 * 不依赖 DOM / Vue 运行时 / fetch，可在 node 环境单测。
 */
export function commentsPath(filter: string): string {
  const status = filter ? `?status=${filter}` : "";
  return `/comments${status}`;
}
