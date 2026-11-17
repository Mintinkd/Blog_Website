import type { Env } from "../index";

/**
 * 媒体对象存储抽象（issue：媒体存储迁移 R2）。
 *
 * 设计要点：
 * - **新写入走 R2**：绑定 `MEDIA_BUCKET` 存在时，上传写入 R2 并把
 *   `media_assets.storage_type` 记为 `r2`；未绑定 R2 时保持旧行为写 KV（本地开发 /
 *   回滚兜底）。
 * - **读取双读**：先查 R2，未命中再回退 KV。存量 KV 对象无需一次性迁移即可继续
 *   访问；新对象只会在 R2。
 * - **删除按行内 storage_type**：只删对应存储，避免误删；`kv_key` 仍是同一个
 *   `media/<年>/<月>/<uuid>.<ext>` 命名空间，R2 / KV 可共存。
 * - KV 命名空间里还有 `imgproxy/*` / `textproxy/*` 缓存与 `backup:*` 备份，本模块
 *   只处理 `media/` 前缀的媒体对象（serve 侧另有 isServableMediaKey 护栏）。
 */
export type MediaStorageType = "kv" | "r2";

/** 当前新上传使用的存储类型：有 R2 绑定即 R2，否则回退 KV */
export function activeMediaStorage(env: Env): MediaStorageType {
  return env.MEDIA_BUCKET ? "r2" : "kv";
}

/** 写入媒体对象，返回实际使用的存储类型 */
export async function putMediaObject(
  env: Env,
  key: string,
  body: ArrayBuffer,
  mimeType: string,
  originalName: string
): Promise<MediaStorageType> {
  if (env.MEDIA_BUCKET) {
    await env.MEDIA_BUCKET.put(key, body, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        original_name: originalName,
        mime_type: mimeType,
      },
    });
    return "r2";
  }

  await env.MEDIA.put(key, body, {
    metadata: { original_name: originalName, mime_type: mimeType },
  });
  return "kv";
}

export interface ReadMediaObject {
  body: ArrayBuffer;
  mimeType?: string;
  originalName?: string;
  storage: MediaStorageType;
}

/**
 * 读取媒体对象：R2 优先、KV 兜底。
 * 返回 null 表示两处都不存在（调用方统一 404，不给存在性 oracle）。
 */
export async function readMediaObject(
  env: Env,
  key: string
): Promise<ReadMediaObject | null> {
  if (env.MEDIA_BUCKET) {
    const object = await env.MEDIA_BUCKET.get(key);
    if (object) {
      return {
        body: await object.arrayBuffer(),
        mimeType:
          object.httpMetadata?.contentType ||
          object.customMetadata?.mime_type ||
          undefined,
        originalName: object.customMetadata?.original_name || undefined,
        storage: "r2",
      };
    }
  }

  // 与迁移前保持一致：先取字节，再取元数据（KV 两个调用是既有接缝，测试桩按此实现）
  const value = await env.MEDIA.get(key, { type: "arrayBuffer" });
  if (!value) return null;
  const metadata = await env.MEDIA.getWithMetadata(key);
  const meta = metadata.metadata as {
    mime_type?: string;
    original_name?: string;
  } | null;
  return {
    body: value,
    mimeType: meta?.mime_type,
    originalName: meta?.original_name,
    storage: "kv",
  };
}

/**
 * 删除媒体对象：按数据库行的 storage_type 选择存储。
 * - `r2` 但 R2 绑定缺失：抛错（fail-closed，不静默留下孤儿对象）；
 * - 未知类型（历史 `remote` 等）：不触碰对象存储。
 */
export async function deleteMediaObject(
  env: Env,
  key: string,
  storageType: string | null | undefined
): Promise<void> {
  if (storageType === "r2") {
    if (!env.MEDIA_BUCKET) {
      throw new Error("MEDIA_BUCKET binding is required to delete R2 media");
    }
    await env.MEDIA_BUCKET.delete(key);
    return;
  }
  if (storageType === "kv" || !storageType) {
    await env.MEDIA.delete(key);
  }
}
