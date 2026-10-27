import { Env } from "../index";
import { successResponse, error, ErrorCodes } from "../utils/response";
import { isPlainObject } from "../utils/object";
import { PATTERNS, SETTINGS_RULES } from "../generated/settings-rules";

/** 可覆盖文案键名模式：与 src/i18n/*.json 的键名同构（首段字母起头，点分段允许数字起头，如 month.01） */
const COPY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * 全站可视化配置中心 —— 后端逻辑
 *
 * 设计要点：
 * - 所有个性化设置（配色 / 布局 / 背景 / 功能开关 / 文案覆盖）统一存为
 *   site_config 表中一个 JSON blob（key = 'site_settings'），便于整体导出/导入/恢复默认。
 * - 读取时与 DEFAULT_SETTINGS 深度合并，缺失字段自动补默认，未知字段被过滤（防注入）。
 * - 渗透报告 004 修复：'/settings' 完整视图收为管理员鉴权；前台运行时改走
 *   '/settings/public' 白名单投影 —— 只放行「页面渲染本就需要展示」的字段。
 *   今后新增任何敏感配置项时默认不公开，必须显式加入 PUBLIC_KEYS 才会暴露。
 */

const SETTINGS_KEY = "site_settings";

/** 允许匿名公开的顶级字段白名单（均为纯展示性配置，不含密钥） */
const PUBLIC_KEYS = [
  "theme",
  "layout",
  "background",
  "features",
  "motion",
  "copy",
] as const;

/** 完整 settings -> 公开投影：未知/未来新增字段默认剔除 */
export function toPublicSettings(s: SiteSettings): Partial<SiteSettings> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    if (key in s) out[key] = s[key as keyof SiteSettings];
  }
  return out as Partial<SiteSettings>;
}

export interface ThemeColors {
  accent: string;
  accentHover: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderLight: string;
}

export interface SiteSettings {
  theme: { light: ThemeColors; dark: ThemeColors };
  layout: {
    contentMaxWidth: string;
    headerHeight: string;
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
  };
  background: {
    bgImage: string;
    bgOpacity: number;
    bgBlur: number;
    bgBrightness: number;
  };
  features: {
    comments: boolean;
    likes: boolean;
    friendLinks: boolean;
    search: boolean;
    rss: boolean;
    darkMode: boolean;
    i18n: boolean;
  };
  copy: {
    zh: Record<string, string>;
    en: Record<string, string>;
  };
  /** 动效强度与视差开关（后台可配） */
  motion: {
    intensity: "normal" | "reduced" | "off";
    parallax: boolean;
    parallaxSpeed: number;
  };
}

export function getDefaultSettings(): SiteSettings {
  return {
    theme: {
      light: {
        accent: "#49b1f5",
        accentHover: "#3a9de8",
        bgPrimary: "#fafafa",
        bgSecondary: "#ffffff",
        bgTertiary: "#f5f5f5",
        textPrimary: "#1d1d1f",
        textSecondary: "#5d5d64",
        textTertiary: "#76767e",
        border: "#e8e8ed",
        borderLight: "#f0f0f5",
      },
      dark: {
        accent: "#7cb8f0",
        accentHover: "#a6d4f8",
        bgPrimary: "#0a0a0a",
        bgSecondary: "#1c1c1e",
        bgTertiary: "#2c2c2e",
        textPrimary: "#f5f5f7",
        textSecondary: "#a1a1a6",
        textTertiary: "#6e6e73",
        border: "#38383a",
        borderLight: "#15151a",
      },
    },
    layout: {
      contentMaxWidth: "1200px",
      headerHeight: "64px",
      radiusSm: "6px",
      radiusMd: "10px",
      radiusLg: "16px",
    },
    background: {
      bgImage: "/bg-placeholder.svg",
      // 与前端 settings.ts 同步：bgOpacity 语义为「图片可见度」而非「遮罩浓度」
      bgOpacity: 0.55,
      bgBlur: 6,
      bgBrightness: 1,
    },
    features: {
      comments: true,
      likes: true,
      friendLinks: true,
      search: true,
      rss: true,
      darkMode: true,
      i18n: true,
    },
    copy: {
      zh: {
        "site.title": "博客",
        "site.description": "记录技术与生活的个人博客",
        "nav.home": "首页",
        "nav.articles": "文章",
        "nav.archives": "归档",
        "nav.about": "关于",
        "nav.tags": "标签",
        "nav.categories": "分类",
        "nav.search": "搜索",
        "nav.rss": "RSS",
        "hero.title": "探索 · 记录 · 分享",
        "hero.subtitle": "关于技术、生活与思考的个人空间",
        "hero.browse": "浏览文章",
        "hero.learn_more": "了解更多",
        "section.latest_articles": "最新文章",
        "section.view_all": "查看全部 →",
        "article.read": "阅读",
        "article.likes": "赞",
        "article.draft": "草稿",
        "article.published": "已发布",
        "article.no_articles": "暂无文章，敬请期待",
        "article.not_found": "文章未找到",
        "article.back_home": "返回首页",
        "article.load_error": "加载失败，请刷新重试",
        "article.server_error": "服务暂时不可用，请稍后重试。",
        "article.retry": "重试",
        "article.loading": "加载文章中...",
        "article.minutes_read": "分钟",
        "article.views": "次阅读",
        "page.articles": "所有文章",
        "page.articles_desc": "记录技术与生活的点滴",
        "page.archives": "归档",
        "page.archives_desc": "按时间线浏览所有文章",
        "page.about": "关于",
        "page.about_desc": "了解这个博客和它的作者",
        "page.tags": "标签",
        "page.tags_desc": "按标签浏览所有文章",
        "page.categories": "分类",
        "page.categories_desc": "按分类浏览所有文章",
        "page.no_categories": "暂无分类",
        "page.search": "搜索",
        "page.search_desc": "搜索你感兴趣的内容",
        "page.search_placeholder": "搜索文章...",
        "page.search_no_results": "未找到相关文章，试试其他关键词？",
        "page.search_found": "找到 {count} 篇相关文章",
        "page.search_loading": "搜索中...",
        "page.not_found": "页面未找到",
        "page.not_found_desc": "抱歉，您访问的页面不存在或已被移除",
        "page.prev": "← 上一页",
        "page.next": "下一页 →",
        "comment.submit": "提交评论",
        "comment.nickname": "你的昵称",
        "comment.content": "评论内容",
        "comment.submitting": "提交中...",
        "like.action": "赞",
        "like.liked": "已赞",
        "footer.copyright": "© {year} {title}",
        "admin.login": "登录",
        "admin.login_loading": "登录中...",
        "admin.login_error": "登录失败",
        "admin.logout": "退出登录",
        "admin.back_site": "← 返回前台",
        "admin.articles": "文章管理",
        "admin.categories": "分类管理",
        "admin.tags": "标签管理",
        "admin.about_page": "关于页面",
        "admin.site_config": "站点配置",
        "admin.users": "账户管理",
        "admin.new_article": "+ 新建文章",
        "admin.new_category": "+ 新建分类",
        "admin.new_tag": "+ 新建标签",
        "admin.new_user": "+ 新建账户",
        "admin.edit": "编辑",
        "admin.delete": "删除",
        "admin.save": "保存",
        "admin.save_loading": "保存中...",
        "admin.cancel": "取消",
        "admin.title": "标题",
        "admin.slug": "链接标识",
        "admin.summary": "摘要",
        "admin.cover": "封面图 URL",
        "admin.cover_placeholder": "https://... 留空则使用分类色渐变",
        "admin.content": "内容",
        "admin.category": "分类",
        "admin.status": "状态",
        "admin.no_category": "无分类",
        "admin.tags_label": "标签",
        "admin.add_tag_placeholder": "输入新标签，回车添加",
        "admin.username": "用户名",
        "admin.password": "密码",
        "admin.display_name": "用户昵称",
        "admin.role": "角色",
        "admin.role_admin": "管理员",
        "admin.role_editor": "编辑者",
        "admin.preview_page": "预览页面 →",
        "admin.about_hint":
          "使用 Markdown 语法编写关于页面的内容，保存后前台 /about 页面将自动更新",
        "admin.save_success": "保存成功",
        "admin.save_failed": "保存失败",
        "admin.delete_confirm": "确定删除？",
        "admin.cannot_delete_last": "无法删除最后一个账户",
        "admin.delete_failed": "删除失败",
        "admin.name": "名称",
        "admin.description": "描述",
        "admin.article_count": "文章数",
        "admin.actions": "操作",
        "admin.created_at": "创建时间",
        "admin.site_title": "站点标题",
        "admin.site_subtitle": "站点副标题",
        "admin.site_description": "站点描述",
        "admin.site_keywords": "站点关键词",
        "admin.posts_per_page": "每页文章数",
        "admin.password_hint": "（留空不修改）",
        "admin.username_password_required": "用户名和密码不能为空",
        "month.01": "1月",
        "month.02": "2月",
        "month.03": "3月",
        "month.04": "4月",
        "month.05": "5月",
        "month.06": "6月",
        "month.07": "7月",
        "month.08": "8月",
        "month.09": "9月",
        "month.10": "10月",
        "month.11": "11月",
        "month.12": "12月",
        "common.loading": "加载中...",
        "common.load_failed": "加载失败",
        "page.category": "分类: {name}",
        "page.tag": "标签: {name}",
        "page.all_articles": "← 所有文章",
        "page.no_articles_category": "该分类暂无文章",
        "page.no_articles_tag": "该标签暂无文章",
        "about.no_content": "博主尚未编写介绍",
        "article.check_link": "请检查链接是否正确",
        "admin.comments": "评论管理",
        "admin.media": "图片管理",
        "admin.all": "全部",
        "admin.pending": "待审核",
        "admin.approved": "已通过",
        "admin.rejected": "已拒绝",
        "admin.approve": "通过",
        "admin.reject": "拒绝",
        "admin.no_comments": "暂无评论",
        "admin.upload": "上传图片",
        "admin.upload_failed": "上传失败",
        "admin.copy_url": "复制链接",
        "admin.copied": "已复制",
        "admin.no_media": "暂无图片",
        "admin.edit_mode": "编辑",
        "admin.split_mode": "分屏",
        "admin.preview_mode": "预览",
        "admin.friend_links": "友情链接",
        "admin.new_friend_link": "+ 新建链接",
        "admin.sort_order": "排序",
        "admin.active": "启用",
        "admin.inactive": "停用",
        "admin.no_friend_links": "暂无友情链接",
        "admin.author": "作者",
        "admin.all_authors": "全部作者",
        "admin.nickname": "评论昵称",
        "admin.edit_locked": "文章正在编辑中",
        "admin.edit_locked_msg": "该文章正在被{name}编辑",
        "admin.lock_expires_at": "锁定过期时间",
        "admin.force_takeover": "强制接管",
        "admin.force_takeover_confirm":
          "将强制释放编辑锁，该编辑者未保存的内容可能丢失，确认继续？",
        "admin.scrape": "网页抓取",
        "admin.scrape_url_placeholder": "粘贴静态文章页 URL",
        "admin.scrape_button": "抓取",
        "admin.scrape_loading": "抓取中...",
        "admin.scrape_retry": "重试",
        "admin.scrape_again": "重新抓取",
        "admin.scrape_selector_placeholder":
          "CSS selector（可选，例如 article .post-content）",
        "admin.scrape_selector_button": "重新提取",
        "admin.scrape_selector_invalid":
          "CSS selector 语法无效，请检查后重试。",
        "admin.scrape_selector_no_match":
          "selector 未命中任何元素，预览保持不变。",
        "admin.scrape_selector_failed": "重新提取失败，预览保持不变。",
        "admin.scrape_generate_draft": "生成草稿并编辑",
        "admin.scrape_final_url": "最终地址",
        "admin.scrape_images": "图片：{count} 张",
        "admin.scrape_charset": "字符集",
        "admin.scrape_images_broken":
          "其中 {count} 张图片缺少可用地址，生成草稿后可能无法显示。",
        "admin.scrape_images_external":
          "外链图片可能因防盗链或源站限制无法显示，建议生成草稿后抽查。",
        "admin.scrape_preview": "预览",
        "admin.scrape_markdown": "Markdown",
        "admin.scrape_rendered": "渲染",
        "admin.scrape_word_count": "字数：{count}",
        "admin.scrape_tags": "标签",
        "admin.scrape_no_tags": "（无匹配标签）",
        "admin.scrape_category": "分类",
        "admin.scrape_status": "状态",
        "admin.scrape_default_category": "未分类",
        "admin.scrape_no_cover": "（无封面）",
        "admin.scrape_no_title": "（未识别标题）",
        "admin.scrape_url_required": "请输入要抓取的 URL",
        "admin.scrape_failed": "抓取失败，请重试",
        "admin.scrape_empty": "未提取到正文内容",
        "admin.scrape_replace_confirm": "当前预览将被替换，确认继续？",
        "admin.scrape_robots_unchecked":
          "robots.txt 无法确认（不存在、无法访问或超出大小限制），本次抓取未做 robots 检查。",
        "admin.scrape_warning_no_article":
          "未识别到文章正文，已回退为整页内容。",
        "admin.scrape_warning_readability_failed":
          "正文提取失败，已回退为整页内容。",
        "admin.scrape_warning_convert_failed":
          "Markdown 转换失败，请检查原文。",
        "admin.scrape_warning_charset_fallback":
          "页面声明的字符集不受支持，已按 UTF-8 解码，可能出现乱码。",
      },
      en: {
        "site.title": "Blog",
        "site.description": "A personal blog about technology and life",
        "nav.home": "Home",
        "nav.articles": "Articles",
        "nav.archives": "Archives",
        "nav.about": "About",
        "nav.tags": "Tags",
        "nav.categories": "Categories",
        "nav.search": "Search",
        "nav.rss": "RSS",
        "hero.title": "Explore · Record · Share",
        "hero.subtitle": "A personal space for technology, life and thoughts",
        "hero.browse": "Browse Articles",
        "hero.learn_more": "Learn More",
        "section.latest_articles": "Latest Articles",
        "section.view_all": "View All →",
        "article.read": "read",
        "article.likes": "likes",
        "article.draft": "Draft",
        "article.published": "Published",
        "article.no_articles": "No articles yet, stay tuned",
        "article.not_found": "Article Not Found",
        "article.back_home": "Back to Home",
        "article.load_error": "Failed to load, please refresh",
        "article.server_error":
          "The service is temporarily unavailable. Please try again later.",
        "article.retry": "Retry",
        "article.loading": "Loading article...",
        "article.minutes_read": "min read",
        "article.views": "views",
        "page.articles": "All Articles",
        "page.articles_desc": "Thoughts on technology and life",
        "page.archives": "Archives",
        "page.archives_desc": "Browse all articles by timeline",
        "page.about": "About",
        "page.about_desc": "Learn about this blog and its author",
        "page.tags": "Tags",
        "page.tags_desc": "Browse all articles by tag",
        "page.categories": "Categories",
        "page.categories_desc": "Browse all articles by category",
        "page.no_categories": "No categories yet",
        "page.search": "Search",
        "page.search_desc": "Search for content you're interested in",
        "page.search_placeholder": "Search articles...",
        "page.search_no_results": "No articles found. Try different keywords?",
        "page.search_found": "Found {count} related articles",
        "page.search_loading": "Searching...",
        "page.not_found": "Page Not Found",
        "page.not_found_desc":
          "Sorry, the page you're looking for doesn't exist or has been removed",
        "page.prev": "← Previous",
        "page.next": "Next →",
        "comment.submit": "Submit Comment",
        "comment.nickname": "Your Nickname",
        "comment.content": "Comment",
        "comment.submitting": "Submitting...",
        "like.action": "Like",
        "like.liked": "Liked",
        "footer.copyright": "© {year} {title}",
        "admin.login": "Login",
        "admin.login_loading": "Logging in...",
        "admin.login_error": "Login failed",
        "admin.logout": "Logout",
        "admin.back_site": "← Back to Site",
        "admin.articles": "Articles",
        "admin.categories": "Categories",
        "admin.tags": "Tags",
        "admin.about_page": "About Page",
        "admin.site_config": "Site Config",
        "admin.users": "Users",
        "admin.new_article": "+ New Article",
        "admin.new_category": "+ New Category",
        "admin.new_tag": "+ New Tag",
        "admin.new_user": "+ New User",
        "admin.edit": "Edit",
        "admin.delete": "Delete",
        "admin.save": "Save",
        "admin.save_loading": "Saving...",
        "admin.cancel": "Cancel",
        "admin.title": "Title",
        "admin.slug": "URL Slug",
        "admin.summary": "Summary",
        "admin.cover": "Cover Image URL",
        "admin.cover_placeholder":
          "https://... leave empty for category gradient",
        "admin.content": "Content",
        "admin.category": "Category",
        "admin.status": "Status",
        "admin.no_category": "No Category",
        "admin.tags_label": "Tags",
        "admin.add_tag_placeholder": "Type a new tag, press Enter",
        "admin.username": "Username",
        "admin.password": "Password",
        "admin.display_name": "Display Name",
        "admin.role": "Role",
        "admin.role_admin": "Admin",
        "admin.role_editor": "Editor",
        "admin.preview_page": "Preview Page →",
        "admin.about_hint":
          "Write the About page content in Markdown. Changes will be reflected on the /about page after saving.",
        "admin.save_success": "Saved successfully",
        "admin.save_failed": "Save failed",
        "admin.delete_confirm": "Are you sure?",
        "admin.cannot_delete_last": "Cannot delete the last user",
        "admin.delete_failed": "Delete failed",
        "admin.name": "Name",
        "admin.description": "Description",
        "admin.article_count": "Articles",
        "admin.actions": "Actions",
        "admin.created_at": "Created",
        "admin.site_title": "Site Title",
        "admin.site_subtitle": "Site Subtitle",
        "admin.site_description": "Site Description",
        "admin.site_keywords": "Site Keywords",
        "admin.posts_per_page": "Posts Per Page",
        "admin.password_hint": " (leave empty to keep)",
        "admin.username_password_required":
          "Username and password are required",
        "month.01": "Jan",
        "month.02": "Feb",
        "month.03": "Mar",
        "month.04": "Apr",
        "month.05": "May",
        "month.06": "Jun",
        "month.07": "Jul",
        "month.08": "Aug",
        "month.09": "Sep",
        "month.10": "Oct",
        "month.11": "Nov",
        "month.12": "Dec",
        "common.loading": "Loading...",
        "common.load_failed": "Failed to load",
        "page.category": "Category: {name}",
        "page.tag": "Tag: {name}",
        "page.all_articles": "← All Articles",
        "page.no_articles_category": "No articles in this category",
        "page.no_articles_tag": "No articles with this tag",
        "about.no_content": "The author hasn't written an introduction yet",
        "article.check_link": "Please check if the link is correct",
        "admin.comments": "Comments",
        "admin.media": "Media",
        "admin.all": "All",
        "admin.pending": "Pending",
        "admin.approved": "Approved",
        "admin.rejected": "Rejected",
        "admin.approve": "Approve",
        "admin.reject": "Reject",
        "admin.no_comments": "No comments",
        "admin.upload": "Upload",
        "admin.upload_failed": "Upload failed",
        "admin.copy_url": "Copy URL",
        "admin.copied": "Copied",
        "admin.no_media": "No media",
        "admin.edit_mode": "Edit",
        "admin.split_mode": "Split",
        "admin.preview_mode": "Preview",
        "admin.friend_links": "Friend Links",
        "admin.new_friend_link": "+ New Link",
        "admin.sort_order": "Sort Order",
        "admin.active": "Active",
        "admin.inactive": "Inactive",
        "admin.no_friend_links": "No friend links",
        "admin.author": "Author",
        "admin.all_authors": "All Authors",
        "admin.nickname": "Nickname",
        "admin.edit_locked": "Article is being edited",
        "admin.edit_locked_msg": "This article is being edited by {name}",
        "admin.lock_expires_at": "Lock expires at",
        "admin.force_takeover": "Force Takeover",
        "admin.force_takeover_confirm":
          "This will force release the edit lock. The editor's unsaved changes may be lost. Continue?",
        "admin.scrape": "Web Scrape",
        "admin.scrape_url_placeholder": "Paste a static article URL",
        "admin.scrape_button": "Scrape",
        "admin.scrape_loading": "Scraping...",
        "admin.scrape_retry": "Retry",
        "admin.scrape_again": "Scrape Again",
        "admin.scrape_selector_placeholder":
          "CSS selector (optional, e.g. article .post-content)",
        "admin.scrape_selector_button": "Re-extract",
        "admin.scrape_selector_invalid":
          "Invalid CSS selector syntax. Check it and try again.",
        "admin.scrape_selector_no_match":
          "The selector matched no elements; the preview was kept.",
        "admin.scrape_selector_failed":
          "Re-extraction failed; the preview was kept.",
        "admin.scrape_generate_draft": "Generate Draft & Edit",
        "admin.scrape_final_url": "Final URL",
        "admin.scrape_images": "Images: {count}",
        "admin.scrape_charset": "Charset",
        "admin.scrape_images_broken":
          "{count} image(s) have no usable URL and may not display in the draft.",
        "admin.scrape_images_external":
          "Remote images may fail to display because of hotlink protection or source-site limits; spot-check the draft.",
        "admin.scrape_preview": "Preview",
        "admin.scrape_markdown": "Markdown",
        "admin.scrape_rendered": "Rendered",
        "admin.scrape_word_count": "Words: {count}",
        "admin.scrape_tags": "Tags",
        "admin.scrape_no_tags": "(No matching tags)",
        "admin.scrape_category": "Category",
        "admin.scrape_status": "Status",
        "admin.scrape_default_category": "Uncategorized",
        "admin.scrape_no_cover": "(No cover image)",
        "admin.scrape_no_title": "(No title detected)",
        "admin.scrape_url_required": "Enter a URL to scrape",
        "admin.scrape_failed": "Scrape failed. Please retry.",
        "admin.scrape_empty": "No content was extracted",
        "admin.scrape_replace_confirm":
          "The current preview will be replaced. Continue?",
        "admin.scrape_robots_unchecked":
          "robots.txt could not be verified (missing, unreachable, or too large), so this scrape ran without a robots check.",
        "admin.scrape_warning_no_article":
          "No article was detected; fell back to the full page.",
        "admin.scrape_warning_readability_failed":
          "Article extraction failed; fell back to the full page.",
        "admin.scrape_warning_convert_failed":
          "Markdown conversion failed. Check the source page.",
        "admin.scrape_warning_charset_fallback":
          "The page declares an unsupported charset; it was decoded as UTF-8 and may contain garbled text.",
      },
    },
    motion: {
      intensity: "normal",
      parallax: true,
      parallaxSpeed: 0.04,
    },
  };
}

/** 只保留 base 中存在的键，深度合并 override，过滤未知键（防止任意字段注入） */
export function deepMerge<T>(base: T, override: any): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: any = { ...base };
  for (const k of Object.keys(base as any)) {
    if (k in override)
      out[k] = deepMerge((base as any)[k], (override as any)[k]);
  }
  return out;
}

/** 校验提交体的文案分区（H11：校验对象从合并结果改为提交体，防止 deepMerge 丢弃非法值）。
 * 提交体未含 copy 分区时视为未提交文案，不产生报错（未提交键保持默认）。 */
export function validateCopyBody(body: any, cap: number): string[] {
  if (!isPlainObject(body)) return [];
  const copyObj = body.copy as Record<string, unknown> | undefined;
  if (copyObj === undefined) return [];
  const bad: string[] = [];
  if (!isPlainObject(copyObj)) {
    return ["copy"];
  }
  for (const locale of ["zh", "en"] as const) {
    const localeCopy = copyObj[locale];
    if (localeCopy === undefined) continue;
    if (!isPlainObject(localeCopy)) {
      bad.push(`copy.${locale}`);
      continue;
    }
    for (const [key, value] of Object.entries(localeCopy)) {
      if (!COPY_KEY_PATTERN.test(key)) {
        bad.push(`copy.${locale}.${key}`);
      } else if (typeof value !== "string") {
        bad.push(`copy.${locale}.${key}`);
      } else if (value.length > cap) {
        bad.push(`copy.${locale}.${key}`);
      }
    }
  }
  return bad;
}

/* ── P1-6 / issue #11 → issue #27：设置值字段白名单（写入侧拒绝非法值，400） ──
 * 规则不再手写：逐字段来自 src/generated/settings-rules.ts（仓库根 settings.rules.json
 * 规则描述符的生成物，与前端读侧共享同一单源；「双端同一套」由 CI 漂移断言守护）。
 * validateSettings 只做「逐条取值 → 按 kind 断言」的通用管线——
 * 不得在此手抄任何 pattern / 数值区间 / copy 上限（背景图仅站内相对路径或 https 外链、
 * 排除引号/尖括号/反斜杠/圆括号等注入面语义注记，随生成物的 PATTERNS 注释携带）。 */

/** 逐级取值：中间容器只要求「是对象即可」（与既有逐字段重构前完全同构——
 * 数组等异形容器在字符串键下取不到值，视同缺失） */
function ruleValue(s: SiteSettings, path: string): unknown {
  let cur: unknown = s;
  for (const key of path.split(".")) {
    cur =
      cur !== null && typeof cur === "object"
        ? (cur as Record<PropertyKey, unknown>)[key]
        : undefined;
  }
  return cur;
}

/** 返回非法字段路径列表；空数组 = 全部合法。规则逐条来自生成物，
 * 未通过即路径点名（含 copy 内首个违规键），顺序 = 描述符分区顺序 */
export function validateSettings(s: SiteSettings): string[] {
  const bad: string[] = [];
  const req = (ok: boolean, path: string) => {
    if (!ok) bad.push(path);
  };
  for (const [path, rule] of Object.entries(SETTINGS_RULES)) {
    const v = ruleValue(s, path);
    switch (rule.kind) {
      case "string":
        req(
          typeof v === "string" &&
            rule.patterns.some((name) => PATTERNS[name].test(v)),
          path
        );
        break;
      case "number":
        req(
          typeof v === "number" &&
            Number.isFinite(v) &&
            v >= rule.min &&
            v <= rule.max,
          path
        );
        break;
      case "enum":
        req(typeof v === "string" && rule.values.includes(v), path);
        break;
      case "bool":
        req(typeof v === "boolean", path);
        break;
      case "copy":
        if (!isPlainObject(v)) {
          bad.push(path);
          break;
        }
        const badKey = Object.entries(v).find(
          ([, value]) =>
            typeof value !== "string" || (value as string).length > rule.cap
        );
        if (badKey) bad.push(`${path}.${badKey[0]}`);
        break;
    }
  }
  return bad;
}

async function loadStored(env: Env): Promise<SiteSettings> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = ?"
  )
    .bind(SETTINGS_KEY)
    .first();
  const raw = row && (row as any).value ? (row as any).value : null;
  if (raw) {
    try {
      return deepMerge(getDefaultSettings(), JSON.parse(raw));
    } catch {
      return getDefaultSettings();
    }
  }
  return getDefaultSettings();
}

async function save(env: Env, settings: SiteSettings): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO site_config (key, value, is_public, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_public = 1, updated_at = excluded.updated_at`
  )
    .bind(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString())
    .run();
}

export async function handleGetSettings(
  _req: Request,
  env: Env
): Promise<Response> {
  const settings = await loadStored(env);
  return successResponse(settings);
}

/** 公开投影（匿名可访问）：仅白名单字段，未来新增敏感字段不会意外泄露 */
export async function handleGetPublicSettings(
  _req: Request,
  env: Env
): Promise<Response> {
  const settings = await loadStored(env);
  return successResponse(toPublicSettings(settings));
}

export async function handleUpdateSettings(
  req: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await req.json();
    const merged = deepMerge(getDefaultSettings(), body);
    const invalid = validateSettings(merged);
    if (invalid.length) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "非法设置值（已拒绝保存）：" + invalid.join("；")
      );
    }
    const copyCap =
      SETTINGS_RULES["copy.zh"].kind === "copy"
        ? SETTINGS_RULES["copy.zh"].cap
        : 2000;
    const copyInvalid = validateCopyBody(body, copyCap);
    if (copyInvalid.length) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "非法文案值（已拒绝保存）：" + copyInvalid.join("；")
      );
    }
    await save(env, merged);
    return successResponse(merged, "设置已保存");
  } catch (e) {
    return error(
      ErrorCodes.PARAM_ERROR,
      "保存失败：" + (e instanceof Error ? e.message : "格式错误")
    );
  }
}

export async function handleResetSettings(
  _req: Request,
  env: Env
): Promise<Response> {
  const def = getDefaultSettings();
  await save(env, def);
  return successResponse(def, "已恢复默认设置");
}

export async function handleExportSettings(
  _req: Request,
  env: Env
): Promise<Response> {
  const settings = await loadStored(env);
  return new Response(JSON.stringify(settings, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": "attachment; filename=site-settings.json",
    },
  });
}

export async function handleImportSettings(
  req: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await req.json();
    const merged = deepMerge(getDefaultSettings(), body);
    const invalid = validateSettings(merged);
    if (invalid.length) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "非法设置值（已拒绝导入）：" + invalid.join("；")
      );
    }
    const copyCap =
      SETTINGS_RULES["copy.zh"].kind === "copy"
        ? SETTINGS_RULES["copy.zh"].cap
        : 2000;
    const copyInvalid = validateCopyBody(body, copyCap);
    if (copyInvalid.length) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "非法文案值（已拒绝导入）：" + copyInvalid.join("；")
      );
    }
    await save(env, merged);
    return successResponse(merged, "配置导入成功");
  } catch (e) {
    return error(
      ErrorCodes.PARAM_ERROR,
      "导入失败：" + (e instanceof Error ? e.message : "格式错误")
    );
  }
}
