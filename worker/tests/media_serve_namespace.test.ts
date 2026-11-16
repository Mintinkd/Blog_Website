import { describe, expect, it } from "vitest";
import { handleServeMedia } from "../src/handlers/media";
import { isServableMediaKey } from "../src/utils/media_key";
import type { Env } from "../src/index";

/**
 * issue #105 / L6：媒体 serve 的访问控制。
 *
 * 真实风险（复核 #105 时发现，比工单描述更严重）：MEDIA 这一个 KV 命名空间里
 * 不只放公开图片，还放 `imgproxy/*`、`textproxy/*` 缓存与 **`backup:*` 全库快照**
 * （#86 / H5 导入备份，含所有表数据）。`handleServeMedia` 此前对任意 key 直接取。
 * 即 `GET /api/v1/media/serve/backup:<ISO>.<rand>` 可在**无登录态**下下载整库快照。
 *
 * 处置：serve 只接受 `media/` 命名空间下的安全 key（无空段 / `.` / `..` / `:` / 控制字符），
 * 其余一律 404 且不触 KV（不给存在性 oracle）。媒体 key 本身是 `crypto.randomUUID()`，
 * 已不可枚举，因此保留公开文章图片的匿名访问，不做逐请求鉴权。
 */

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

interface FakeKv {
  get: (key: string) => Promise<ArrayBuffer | null>;
  getWithMetadata: (key: string) => Promise<{
    value: ArrayBuffer | null;
    metadata: Record<string, unknown> | null;
  }>;
}

function makeEnv(entries: Record<string, Uint8Array>): {
  env: Env;
  reads: string[];
} {
  const reads: string[] = [];
  const kv: FakeKv = {
    async get(key: string) {
      reads.push(key);
      const value = entries[key];
      return value ? (value.slice().buffer as ArrayBuffer) : null;
    },
    async getWithMetadata(key: string) {
      reads.push(key);
      const value = entries[key];
      return {
        value: value ? (value.slice().buffer as ArrayBuffer) : null,
        metadata: value ? { mime_type: "image/png" } : null,
      };
    },
  };
  return { env: { MEDIA: kv } as unknown as Env, reads };
}

describe("isServableMediaKey（#105）", () => {
  it.each([
    "media/2024/02/0f8fad5b-d9cb-469f-a165-70867728950e.png",
    "media/2023/05/legacy.dat",
    "media/2022/01/old.png",
  ])("接受 media/ 命名空间下的安全 key：%s", (key) => {
    expect(isServableMediaKey(key)).toBe(true);
  });

  it.each([
    ["backup:2026-11-16T00:00:00.000Z.abcd1234", "导入备份（整库快照）"],
    ["imgproxy/3f2a", "图片代理缓存"],
    ["textproxy/9c1b", "文本代理缓存"],
    ["media/../backup:x", "点段逃逸"],
    ["media/2024//x.png", "空段"],
    ["media/2024/02/", "尾空段"],
    ["media\\2024\\x.png", "反斜杠分隔"],
    ["media/2024/02/x.png\n", "尾随控制字符"],
    ["", "空 key"],
    ["random", "非 media 前缀"],
  ])("拒绝 %j（%s）", (key) => {
    expect(isServableMediaKey(key)).toBe(false);
  });
});

describe("handleServeMedia 命名空间隔离（#105）", () => {
  it("backup:* 全库快照不可匿名下载（404 且根本不读 KV）", async () => {
    const key = "backup:2026-11-16T00:00:00.000Z.abcd1234";
    const { env, reads } = makeEnv({ [key]: new TextEncoder().encode("{}") });
    const res = await handleServeMedia(
      new Request(`https://example.com/api/v1/media/serve/${key}`),
      env,
      { path: key }
    );

    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it.each(["imgproxy/3f2a", "textproxy/9c1b"])(
    "%s 缓存对象不可经 serve 读出（404 且不读 KV）",
    async (key) => {
      const { env, reads } = makeEnv({ [key]: PNG });
      const res = await handleServeMedia(
        new Request(`https://example.com/api/v1/media/serve/${key}`),
        env,
        { path: key }
      );
      expect(res.status).toBe(404);
      expect(reads).toEqual([]);
    }
  );

  it("公开文章图片（media/ 下）无登录态仍可正常取回", async () => {
    const key = "media/2024/02/0f8fad5b-d9cb-469f-a165-70867728950e.png";
    const { env, reads } = makeEnv({ [key]: PNG });
    const res = await handleServeMedia(
      new Request(`https://example.com/api/v1/media/serve/${key}`),
      env,
      { path: key }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(reads).toEqual([key, key]);
  });

  it("点段逃逸在 serve 层同样被拒（不依赖平台层 URL 归一化）", async () => {
    const { env, reads } = makeEnv({});
    const res = await handleServeMedia(
      new Request("https://example.com/api/v1/media/serve/media/../backup:x"),
      env,
      { path: "media/../backup:x" }
    );
    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it("不存在的 media/ key 仍是 404（与拒绝同形，不给存在性 oracle）", async () => {
    const { env } = makeEnv({});
    const res = await handleServeMedia(
      new Request(
        "https://example.com/api/v1/media/serve/media/2024/02/none.png"
      ),
      env,
      { path: "media/2024/02/none.png" }
    );
    expect(res.status).toBe(404);
  });
});
