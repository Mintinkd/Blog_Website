/**
 * 编辑器图片上传适配器（T4 #65 / T0 §5 第 2 条）。
 *
 * T0 实测：CrepeBuilder 默认 uploader 在不装配 image-block 时会写
 * `URL.createObjectURL(file)`（`blob:` 地址），既不能落库也违反正文契约。
 * 这里覆盖为现有 `POST /api/v1/media/upload`：用接口返回的相对地址作 src、
 * `original_name` 去扩展名作 alt，交给 schema 的普通 `image` 节点。
 * T5 #66 继续承接拖拽真实回归与草稿恢复，本文件只提供最小可用上传路径。
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadedImage {
  /** `POST /media/upload` 返回的相对地址，例如 /media/uploaded/xxx.png。 */
  url: string;
  /** original_name 去扩展名；供 Markdown 图片的 alt 使用。 */
  alt: string;
}

/** 文件名去扩展名（只去掉最后一段），空名回退为 "image"。 */
export function altFromName(name: string): string {
  const base = String(name ?? "")
    .replace(/\.[^./\\]+$/, "")
    .trim();
  return base || "image";
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "只能上传图片文件";
  if (file.size > MAX_UPLOAD_BYTES) return "图片不能超过 10MB";
  return null;
}

export async function uploadImageFile(
  file: File,
  getToken: () => string
): Promise<UploadedImage> {
  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/v1/media/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const payload = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { url?: string; original_name?: string } | null;
  };
  if (!response.ok || payload.code !== 0 || !payload.data?.url) {
    throw new Error(payload.message || "图片上传失败");
  }
  return {
    url: payload.data.url,
    alt: altFromName(payload.data.original_name ?? file.name),
  };
}
