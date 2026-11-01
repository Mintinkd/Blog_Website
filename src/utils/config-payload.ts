/**
 * 后台站点配置表单 → `PUT /api/v1/config` 请求体。
 *
 * Worker 的配置写入白名单只接受字符串；表单里 `posts_per_page` 由
 * `v-model.number` 绑定为 number，必须在这个边界统一转成字符串，
 * 否则整批请求 400（旧实现还会留下部分写入）。
 */
export interface SiteConfigForm {
  site_title: string;
  site_subtitle: string;
  site_description: string;
  posts_per_page: number;
}

export function toConfigPayload(form: SiteConfigForm): Record<string, string> {
  return {
    site_title: form.site_title,
    site_subtitle: form.site_subtitle,
    site_description: form.site_description,
    posts_per_page: String(form.posts_per_page),
  };
}
