/**
 * 文章发布日期展示（服务端首屏与客户端 locale 切换共用）。
 *
 * 服务端按中文默认输出，客户端初始化 / 切换语言后按当前 locale 重排；
 * 无法解析的日期返回空串，由调用方决定是否渲染。
 */
export function formatArticleDate(
  iso: string,
  locale: "zh" | "en" = "zh"
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
