/**
 * Milkdown upload 适配入口（T4 #65 路径，T5 #66 起实现迁到 utils 以便单测）。
 *
 * 真正的预检 / 请求 / 响应映射在 `src/utils/editor/uploadImage.ts`；
 * 本文件只保留旧的 import 路径，避免 createEditor 与测试各引一份实现。
 */
export {
  altFromName,
  describeUploadError,
  ImageUploadError,
  MAX_UPLOAD_BYTES,
  uploadImageAtSelection,
  uploadImageFile,
  validateImageFile,
  type ImageUploadErrorCode,
  type ImageValidationError,
  type UploadedImage,
} from "../../../utils/editor/uploadImage";
