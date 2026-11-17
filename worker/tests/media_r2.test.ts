import { describe, expect, it } from "vitest";
import { handleImport } from "../src/handlers/admin";
import { handleUploadMedia } from "../src/handlers/media";
import type { Env } from "../src/index";
import {
  activeMediaStorage,
  deleteMediaObject,
  putMediaObject,
  readMediaObject,
} from "../src/utils/media_storage";

/**
 * 媒体存储迁移 R2：新写入走 R2、读取 R2 优先 KV 兜底、删除按 storage_type。
 *
 * 接缝：media_storage 抽象 + 上传 / 导入 handler。
 * 存储边界以桩对象替代（R2Bucket / KVNamespace 的最小实现），断言调用与落库值，
 * 不触碰真实网络或 Cloudflare 绑定。
 */

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

interface FakeR2Options {
  entries?: Record<string, Uint8Array>;
}

function makeR2(options: FakeR2Options = {}): {
  bucket: R2Bucket;
  puts: Array<{
    key: string;
    body: ArrayBuffer;
    options?: R2PutOptions;
  }>;
  deletes: string[];
} {
  const puts: Array<{
    key: string;
    body: ArrayBuffer;
    options?: R2PutOptions;
  }> = [];
  const deletes: string[] = [];
  const bucket = {
    async get(key: string) {
      const bytes = options.entries?.[key];
      if (!bytes) return null;
      return {
        arrayBuffer: async () => bytes.slice().buffer,
        httpMetadata: { contentType: "image/png" },
        customMetadata: { original_name: "photo.png", mime_type: "image/png" },
      };
    },
    async put(
      key: string,
      body: ArrayBuffer,
      putOptions?: R2PutOptions
    ): Promise<void> {
      puts.push({ key, body, options: putOptions });
    },
    async delete(key: string): Promise<void> {
      deletes.push(key);
    },
  } as unknown as R2Bucket;
  return { bucket, puts, deletes };
}

function makeMedia(entries: Record<string, Uint8Array> = {}): {
  media: KVNamespace;
  gets: string[];
  deletes: string[];
} {
  const gets: string[] = [];
  const deletes: string[] = [];
  const media = {
    async get(key: string) {
      gets.push(key);
      const bytes = entries[key];
      return bytes ? bytes.slice().buffer : null;
    },
    async getWithMetadata(key: string) {
      gets.push(key);
      const bytes = entries[key];
      return {
        value: bytes ? bytes.slice().buffer : null,
        metadata: bytes ? { mime_type: "image/png" } : null,
      };
    },
    async put(): Promise<void> {
      return;
    },
    async delete(key: string): Promise<void> {
      deletes.push(key);
    },
  } as unknown as KVNamespace;
  return { media, gets, deletes };
}

/** 只记录 INSERT 绑定值的假 D1 */
function recordingDb(): {
  db: D1Database;
  inserts: Array<{ sql: string; binds: unknown[] }>;
} {
  const inserts: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = { sql, binds: [] as unknown[] };
      const api = {
        bind(...binds: unknown[]) {
          statement.binds = binds;
          return api;
        },
        async run() {
          if (/INSERT INTO media_assets/i.test(sql)) inserts.push(statement);
          return { success: true, meta: { last_row_id: 7 } };
        },
      };
      return api;
    },
  } as unknown as D1Database;
  return { db, inserts };
}

function uploadRequest(form: FormData): Request {
  return new Request("https://example.com/api/v1/media/upload", {
    method: "POST",
    body: form,
  });
}

function mediaUpload(name: string, bytes: Uint8Array): FormData {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "image/png" }));
  return form;
}

describe("activeMediaStorage", () => {
  it("绑定 MEDIA_BUCKET 时新写入走 R2；未绑定回退 KV", () => {
    expect(activeMediaStorage({} as Env)).toBe("kv");
    expect(
      activeMediaStorage({ MEDIA_BUCKET: makeR2().bucket } as unknown as Env)
    ).toBe("r2");
  });
});

describe("putMediaObject", () => {
  it("R2 写入携带 content-type 与原文件名元数据，并返回 r2", async () => {
    const r2 = makeR2();
    const media = makeMedia();
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    const storage = await putMediaObject(
      env,
      "media/2026/11/a.png",
      PNG_BYTES.slice().buffer,
      "image/png",
      "照片.png"
    );

    expect(storage).toBe("r2");
    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].key).toBe("media/2026/11/a.png");
    expect(r2.puts[0].options).toMatchObject({
      httpMetadata: { contentType: "image/png" },
      customMetadata: { original_name: "照片.png", mime_type: "image/png" },
    });
  });

  it("未绑定 R2 时保持旧 KV 写入路径，并返回 kv", async () => {
    const media = makeMedia();
    const env = { MEDIA: media.media } as unknown as Env;

    const storage = await putMediaObject(
      env,
      "media/2026/11/a.png",
      PNG_BYTES.slice().buffer,
      "image/png",
      "a.png"
    );

    expect(storage).toBe("kv");
  });
});

describe("readMediaObject", () => {
  const key = "media/2026/11/a.png";

  it("R2 命中时优先返回 R2，且不再读 KV", async () => {
    const r2 = makeR2({ entries: { [key]: PNG_BYTES } });
    const media = makeMedia({ [key]: PNG_BYTES });
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    const stored = await readMediaObject(env, key);

    expect(stored?.storage).toBe("r2");
    expect(stored?.mimeType).toBe("image/png");
    expect(stored?.originalName).toBe("photo.png");
    expect(media.gets).toEqual([]);
  });

  it("R2 未命中时回退 KV（存量对象无需迁移仍可访问）", async () => {
    const r2 = makeR2();
    const media = makeMedia({ [key]: PNG_BYTES });
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    const stored = await readMediaObject(env, key);

    expect(stored?.storage).toBe("kv");
    expect(stored?.mimeType).toBe("image/png");
  });

  it("两处都不存在时返回 null", async () => {
    const env = {
      MEDIA: makeMedia().media,
      MEDIA_BUCKET: makeR2().bucket,
    } as unknown as Env;

    await expect(readMediaObject(env, key)).resolves.toBeNull();
  });
});

describe("deleteMediaObject", () => {
  it("按 storage_type=r2 只删 R2", async () => {
    const r2 = makeR2();
    const media = makeMedia();
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    await deleteMediaObject(env, "media/2026/11/a.png", "r2");

    expect(r2.deletes).toEqual(["media/2026/11/a.png"]);
    expect(media.deletes).toEqual([]);
  });

  it("storage_type=kv 或历史空值走 KV 删除", async () => {
    const r2 = makeR2();
    const media = makeMedia();
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    await deleteMediaObject(env, "media/2026/11/kv.png", "kv");
    await deleteMediaObject(env, "media/2026/11/legacy.png", null);

    expect(media.deletes).toEqual([
      "media/2026/11/kv.png",
      "media/2026/11/legacy.png",
    ]);
    expect(r2.deletes).toEqual([]);
  });

  it("未知 storage_type（历史 remote 等）不触碰对象存储", async () => {
    const r2 = makeR2();
    const media = makeMedia();
    const env = {
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    await deleteMediaObject(env, "https://remote.example/a.png", "remote");

    expect(media.deletes).toEqual([]);
    expect(r2.deletes).toEqual([]);
  });

  it("storage_type=r2 但绑定缺失时 fail-closed", async () => {
    const env = { MEDIA: makeMedia().media } as unknown as Env;
    await expect(
      deleteMediaObject(env, "media/2026/11/a.png", "r2")
    ).rejects.toThrow(/MEDIA_BUCKET/);
  });
});

describe("handleUploadMedia", () => {
  it("绑定 R2 时对象写 R2，media_assets.storage_type 记为 r2", async () => {
    const r2 = makeR2();
    const media = makeMedia();
    const { db, inserts } = recordingDb();
    const env = {
      DB: db,
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    const res = await handleUploadMedia(
      uploadRequest(mediaUpload("photo.png", PNG_BYTES)),
      env,
      {} as ExecutionContext,
      {}
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: number; url: string; kv_key: string };
    };
    expect(body.data.id).toBe(7);
    expect(body.data.url).toBe(`/api/v1/media/serve/${body.data.kv_key}`);

    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0].key).toBe(body.data.kv_key);
    expect(r2.puts[0].key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].binds[4]).toBe(body.data.kv_key);
    expect(inserts[0].binds[5]).toBe("r2");
  });

  it("未绑定 R2 时保持 KV 上传路径，storage_type 记为 kv", async () => {
    const media = makeMedia();
    const { db, inserts } = recordingDb();
    const env = { DB: db, MEDIA: media.media } as unknown as Env;

    const res = await handleUploadMedia(
      uploadRequest(mediaUpload("photo.png", PNG_BYTES)),
      env,
      {} as ExecutionContext,
      {}
    );

    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].binds[5]).toBe("kv");
  });
});

describe("handleImport R2 孤儿清理", () => {
  it("按快照行的 storage_type 删除被替换的 R2 对象，复用的 key 保留", async () => {
    const snapshotRows = [
      { id: 1, kv_key: "old-r2", storage_type: "r2" },
      { id: 2, kv_key: "kept", storage_type: "r2" },
    ];
    const db = {
      prepare(sql: string) {
        const api = {
          bind() {
            return api;
          },
          async all() {
            if (/COUNT\(\*\)/i.test(sql)) return { results: [{ count: 100 }] };
            if (/FROM\s+media_assets/i.test(sql))
              return { results: snapshotRows };
            return { results: [] };
          },
          async run() {
            return { success: true };
          },
        };
        return api;
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;
    const r2 = makeR2();
    const media = makeMedia();
    const env = {
      DB: db,
      MEDIA: media.media,
      MEDIA_BUCKET: r2.bucket,
    } as unknown as Env;

    const request = new Request("https://example.com/api/v1/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        export_data: {
          media_assets: [
            {
              id: 2,
              filename: "g.png",
              original_name: "g.png",
              mime_type: "image/png",
              file_size: 2,
              kv_key: "kept",
              storage_type: "r2",
              alt_text: null,
              created_at: "2024-01-01",
              uploaded_by: null,
            },
          ],
        },
      }),
    });

    const res = await handleImport(request, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>;
    };
    expect(body.data).toMatchObject({
      kv_orphans_deleted: 0,
      kv_cleanup_failed: 0,
      r2_orphans_deleted: 1,
      r2_cleanup_failed: 0,
    });
    expect(r2.deletes).toEqual(["old-r2"]);
    expect(media.deletes).toEqual([]);
  });
});
