/**
 * 后台「关于页 / 个人名片」面板的纯逻辑。不依赖 DOM / Vue 运行时，可在 node 环境单测。
 * 拆分前是 `App.vue` 的 defaultProfileLinks / emptyProfileForm / parseProfileForm，
 * 以及 `saveProfile()` 里 profile_card 请求体的构造。
 */
export interface ProfileLinkForm {
  label: string;
  url: string;
}
export interface ProfileForm {
  name: string;
  role: string;
  bio: string;
  avatar: string;
  links: ProfileLinkForm[];
}

/** 三条空值示例：只预填名称，地址留空；保存时过滤掉未填完整的行 */
export function defaultProfileLinks(): ProfileLinkForm[] {
  return [
    { label: "GitHub", url: "" },
    { label: "Email", url: "" },
    { label: "RSS", url: "" },
  ];
}

export function emptyProfileForm(): ProfileForm {
  return {
    name: "",
    role: "",
    bio: "",
    avatar: "",
    links: defaultProfileLinks(),
  };
}

/** 后台表单容错解析：坏 JSON / 字段异常一律回退空表单，不让编辑页白屏 */
export function parseProfileForm(raw: unknown): ProfileForm {
  let src: any = raw;
  if (typeof src === "string") {
    if (!src.trim()) return emptyProfileForm();
    try {
      src = JSON.parse(src);
    } catch {
      return emptyProfileForm();
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return emptyProfileForm();
  }
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const links: ProfileLinkForm[] = Array.isArray(src.links)
    ? src.links.slice(0, 6).map((l: any) => ({
        label: text(l?.label),
        url: text(l?.url),
      }))
    : [];
  return {
    name: text(src.name),
    role: text(src.role),
    bio: text(src.bio),
    avatar: text(src.avatar),
    links: links.length ? links : defaultProfileLinks(),
  };
}

/** 半填 / 全空的示例行不提交，由后端白名单与协议校验兜住剩下的非法地址 */
export function buildProfilePayload(form: ProfileForm): {
  name: string;
  role: string;
  bio: string;
  avatar: string;
  links: ProfileLinkForm[];
} {
  const links = form.links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label && l.url);
  return {
    name: form.name,
    role: form.role,
    bio: form.bio,
    avatar: form.avatar,
    links,
  };
}
