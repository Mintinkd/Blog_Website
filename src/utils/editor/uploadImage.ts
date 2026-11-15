/**
 * 编辑器图片上传适配器（T5 #66 / docs/ARTICLE_EDITOR_UPGRADE.md §5.7 / §8.4）。
 *
 * 契约：
 * - 客户端只做 10MB 与图片类型预检；服务端仍是类型 / 扩展名 / 魔数白名单的权威；
 * - 请求固定 `POST /api/v1/media/upload`（Bearer + FormData `file`）；
 * - 响应 `{ url, original_name }` 映射为 `{ url, alt }`，alt 取 original_name
 *   去最后一段扩展名；
 * - 源码模式插入 `![alt](url)`，alt 用 T1 的 Markdown 文本转义并落在光标选区；
 * - 失败只返回错误码 / 服务端 message，原正文与选区原样返回，绝不清空正文；
 * - 不写 base64，也不做图片代理或转存。
 *
 * 纯模块：fetch 可注入，不 import Vue / DOM，node 环境单测。
 */
import { insertImage, type TextSelection } from "./editorCommands";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ImageValidationError = "invalid-type" | "too-large";
export type ImageUploadErrorCode = ImageValidationError | "server" | "network";

export class ImageUploadError extends Error {
  readonly code: ImageUploadErrorCode;
  /** 服务端 `message`；仅 code === "server" 时可能有值。 */
  readonly serverMessage: string;

  constructor(code: ImageUploadErrorCode, serverMessage = "") {
    super(serverMessage || code);
    this.name = "ImageUploadError";
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

export interface UploadedImage {
  /** `POST /media/upload` 返回的相对地址，例如 /api/v1/media/serve/media/... */
  url: string;
  /** original_name 去扩展名；供 Markdown 图片的 alt 使用。 */
  alt: string;
}

type FetchLike = typeof fetch;

/** 文件名去扩展名（只去掉最后一段），空名回退为 "image"。 */
export function altFromName(name: string): string {
  const base = String(name ?? "")
    .replace(/\.[^./\\]+$/, "")
    .trim();
  return base || "image";
}

/** 客户端预检：服务端仍会再校验类型 / 扩展名 / 魔数。 */
export function validateImageFile(file: File): ImageValidationError | null {
  if (!file.type.startsWith("image/")) return "invalid-type";
  if (file.size > MAX_UPLOAD_BYTES) return "too-large";
  return null;
}

function normalizeError(error: unknown): ImageUploadError {
  if (error instanceof ImageUploadError) return error;
  return new ImageUploadError("network");
}

/** 调用现有媒体上传接口并把响应映射成 Markdown 图片所需的 { url, alt }。 */
export async function uploadImageFile(
  file: File,
  getToken: () => string,
  fetchImpl: FetchLike = fetch
): Promise<UploadedImage> {
  const invalid = validateImageFile(file);
  if (invalid) throw new ImageUploadError(invalid);

  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetchImpl("/api/v1/media/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: formData,
    });
  } catch {
    throw new ImageUploadError("network");
  }

  let payload: {
    code?: number;
    message?: string;
    data?: { url?: string; original_name?: string } | null;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new ImageUploadError("network");
  }

  if (!response.ok || payload.code !== 0 || !payload.data?.url) {
    throw new ImageUploadError(
      "server",
      typeof payload.message === "string" ? payload.message : ""
    );
  }

  return {
    url: payload.data.url,
    alt: altFromName(payload.data.original_name ?? file.name),
  };
}

/**
 * 把上传错误映射成可读文案：预检走 i18n，服务端 message 优先，其余回退通用失败。
 * `translate` 由 UI 注入（通常是 `t`），保持本模块不依赖 i18n 模块。
 */
export function describeUploadError(
  error: unknown,
  translate: (key: string) => string
): string {
  const uploadError = normalizeError(error);
  if (uploadError.code === "invalid-type") {
    return translate("editor.upload_invalid_type");
  }
  if (uploadError.code === "too-large") {
    return translate("editor.upload_too_large");
  }
  if (uploadError.code === "server" && uploadError.serverMessage) {
    return uploadError.serverMessage;
  }
  return translate("editor.upload_failed");
}

export type UploadInsertResult =
  | {
      ok: true;
      content: string;
      selection: TextSelection;
      image: UploadedImage;
    }
  | {
      ok: false;
      /** 失败时是调用方传入的原正文，保证「失败不清空正文」。 */
      content: string;
      /** 失败时是调用方传入的原选区。 */
      selection: TextSelection;
      error: ImageUploadError;
    };

/**
 * 源码模式的一站式插入：预检 → 上传 → 在选区插入 `![alt](url)` 并选中 alt。
 * 任一步失败都原样返回正文与选区，调用方只需把错误映射成提示。
 */
export async function uploadImageAtSelection(
  content: string,
  selection: TextSelection,
  file: File,
  getToken: () => string,
  fetchImpl: FetchLike = fetch
): Promise<UploadInsertResult> {
  try {
    const image = await uploadImageFile(file, getToken, fetchImpl);
    const inserted = insertImage(content, selection, image);
    return {
      ok: true,
      content: inserted.text,
      selection: inserted.selection,
      image,
    };
  } catch (error) {
    return {
      ok: false,
      content,
      selection: { ...selection },
      error: normalizeError(error),
    };
  }
}
