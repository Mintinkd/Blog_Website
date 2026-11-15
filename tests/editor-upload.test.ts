// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  altFromName,
  describeUploadError,
  ImageUploadError,
  MAX_UPLOAD_BYTES,
  uploadImageAtSelection,
  uploadImageFile,
  validateImageFile,
} from "../src/utils/editor/uploadImage";

/**
 * issue #66（编辑器 T5）图片上传适配器行为锁。
 *
 * 契约见 docs/ARTICLE_EDITOR_UPGRADE.md §5.7 / §8.4：
 * 类型 / 10MB 预检 → POST /api/v1/media/upload（Bearer + FormData `file`）
 * → `{ url, original_name }` 映射为 `{ url, alt }`；服务端错误按 message 映射；
 * 失败不得清空或破坏正文。
 *
 * fetch 用可编程 stub，期望值全部手写字面量；node 环境证明适配器不依赖 DOM。
 */
const TOKEN = "upload-token";

function imageFile(name = "photo.png", type = "image/png", size = 4): File {
  return new File([new Uint8Array(size)], name, { type });
}

function successResponse(
  data: { url?: string; original_name?: string } | null,
  status = 200
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

function errorResponse(
  message: string,
  options: { status?: number; code?: number } = {}
): Response {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      code: options.code ?? 10001,
      message,
      data: null,
    }),
  } as Response;
}

describe("预检与 alt 映射", () => {
  it("常量钉住 10MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("非图片类型直接拒绝", () => {
    expect(validateImageFile(imageFile("notes.txt", "text/plain"))).toBe(
      "invalid-type"
    );
    expect(validateImageFile(imageFile("photo.png", "image/png"))).toBeNull();
    expect(
      validateImageFile(imageFile("vector.svg", "image/svg+xml"))
    ).toBeNull();
  });

  it("恰好 10MB 放行，多 1 字节拒绝", () => {
    expect(
      validateImageFile(imageFile("exact.png", "image/png", MAX_UPLOAD_BYTES))
    ).toBeNull();
    expect(
      validateImageFile(imageFile("big.png", "image/png", MAX_UPLOAD_BYTES + 1))
    ).toBe("too-large");
  });

  it("alt 取 original_name 去最后一段扩展名，空名回退 image", () => {
    expect(altFromName("photo.png")).toBe("photo");
    expect(altFromName("archive.tar.gz")).toBe("archive.tar");
    expect(altFromName("我的 图片.webp")).toBe("我的 图片");
    expect(altFromName("no-extension")).toBe("no-extension");
    expect(altFromName("")).toBe("image");
    expect(altFromName("   ")).toBe("image");
  });
});

describe("上传请求与响应映射", () => {
  it("带 Bearer + FormData file，成功映射 url / original_name", async () => {
    const fetchImpl = vi.fn(async () =>
      successResponse({
        url: "/api/v1/media/serve/media/2026/11/a.png",
        original_name: "封面 图.png",
      })
    );
    const file = imageFile("local.png");

    await expect(
      uploadImageFile(file, () => TOKEN, fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      url: "/api/v1/media/serve/media/2026/11/a.png",
      alt: "封面 图",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/media/upload");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("local.png");
  });

  it("original_name 缺失时回退上传文件名", async () => {
    const fetchImpl = vi.fn(async () =>
      successResponse({ url: "/api/v1/media/serve/media/2026/11/a.png" })
    );

    await expect(
      uploadImageFile(
        imageFile("fallback.jpg", "image/jpeg"),
        () => TOKEN,
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toEqual({
      url: "/api/v1/media/serve/media/2026/11/a.png",
      alt: "fallback",
    });
  });

  it("服务端 code !== 0 按 message 映射为 server 错误", async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse("文件内容与声明类型不符", { status: 400 })
    );

    await expect(
      uploadImageFile(
        imageFile(),
        () => TOKEN,
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({
      name: "ImageUploadError",
      code: "server",
      serverMessage: "文件内容与声明类型不符",
    });
  });

  it("HTTP 失败且响应不是 JSON 时映射为 network 错误", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }));

    await expect(
      uploadImageFile(
        imageFile(),
        () => TOKEN,
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ code: "network" });
  });

  it("fetch 拒绝同样映射为 network 错误", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      uploadImageFile(
        imageFile(),
        () => TOKEN,
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ code: "network" });
  });
});

describe("错误文案与失败不清空正文", () => {
  const translate = (key: string): string =>
    ({
      "editor.upload_invalid_type": "只能上传图片文件",
      "editor.upload_too_large": "图片不能超过 10MB",
      "editor.upload_failed": "图片上传失败",
    })[key] ?? key;

  it("预检错误走 i18n 文案，服务端 message 优先", () => {
    expect(
      describeUploadError(new ImageUploadError("invalid-type"), translate)
    ).toBe("只能上传图片文件");
    expect(
      describeUploadError(new ImageUploadError("too-large"), translate)
    ).toBe("图片不能超过 10MB");
    expect(
      describeUploadError(
        new ImageUploadError("server", "服务端说不行"),
        translate
      )
    ).toBe("服务端说不行");
    expect(describeUploadError(new Error("boom"), translate)).toBe(
      "图片上传失败"
    );
  });

  it("上传失败返回原正文与选区，不插入任何图片片段", async () => {
    const fetchImpl = vi.fn(async () =>
      errorResponse("上传失败", { status: 500 })
    );
    const content = "现有正文\n\n第二段";
    const selection = { start: 4, end: 4 };

    const result = await uploadImageAtSelection(
      content,
      selection,
      imageFile("bad.png"),
      () => TOKEN,
      fetchImpl as unknown as typeof fetch
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe(content);
    expect(result.selection).toEqual(selection);
    expect(result.content).not.toContain("![");
  });

  it("上传成功在选区插入图片并选中 alt", async () => {
    const fetchImpl = vi.fn(async () =>
      successResponse({
        url: "/api/v1/media/serve/media/2026/11/a.png",
        original_name: "封面.png",
      })
    );

    const result = await uploadImageAtSelection(
      "现有正文",
      { start: 4, end: 4 },
      imageFile(),
      () => TOKEN,
      fetchImpl as unknown as typeof fetch
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe(
      "现有正文![封面](/api/v1/media/serve/media/2026/11/a.png)"
    );
    expect(result.selection).toEqual({ start: 6, end: 8 });
  });
});
