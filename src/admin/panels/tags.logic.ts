/**
 * TagsPanel 的纯逻辑：从 App.vue `saveTag` 抽出的请求构造。
 * 不依赖 DOM / Vue 运行时 / fetch，可在 node 环境单测。
 *
 * taxonomy v2（#79 / #80）：标签带归属分类——创建可选携带 category_id
 * （缺省由服务端归「未分类」），移动归属走 PUT /tags/:id（只消费 category_id）。
 */
export interface TagForm {
  name: string;
  slug: string;
  category_id?: number;
}

export interface TagRequest {
  method: string;
  path: string;
  body: TagForm;
}

export function buildTagRequest(form: TagForm): TagRequest {
  return { method: "POST", path: "/tags", body: form };
}

/** 移动标签归属（PUT /tags/:id）：请求体只含 category_id，name / slug 不变。 */
export function buildMoveTagRequest(
  tagId: number,
  categoryId: number
): TagRequest {
  return {
    method: "PUT",
    path: `/tags/${tagId}`,
    body: { name: "", slug: "", category_id: categoryId },
  };
}
