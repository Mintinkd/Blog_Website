/**
 * 后台「站点配置」面板的纯逻辑。不依赖 DOM / Vue 运行时，可在 node 环境单测。
 * 拆分前是 `App.vue` 的 `loadConfig()` 里 configForm 的字段容错。
 */
export interface ConfigFormData {
  site_title: string;
  site_subtitle: string;
  site_description: string;
  posts_per_page: number;
}

/** 逐字对应 loadConfig 的 `configForm.value = { ... }`：缺字段回退空串，每页条数走 parseInt || 10 */
export function normalizeConfigForm(raw: any): ConfigFormData {
  const d = raw || {};
  return {
    site_title: d.site_title || "",
    site_subtitle: d.site_subtitle || "",
    site_description: d.site_description || "",
    posts_per_page: parseInt(d.posts_per_page) || 10,
  };
}
