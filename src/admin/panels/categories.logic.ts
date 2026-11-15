/**
 * CategoriesPanel 的纯逻辑：从 App.vue `saveCategory` 抽出的请求构造。
 * 不依赖 DOM / Vue 运行时 / fetch，可在 node 环境单测。
 */
export interface CategoryForm {
  name: string;
  slug: string;
  description: string;
}

export interface CategoryRequest {
  method: string;
  path: string;
  body: CategoryForm;
}

export function buildCategoryRequest(
  form: CategoryForm,
  editingId: number | null
): CategoryRequest {
  if (editingId) {
    return { method: "PUT", path: `/categories/${editingId}`, body: form };
  }
  return { method: "POST", path: "/categories", body: form };
}
