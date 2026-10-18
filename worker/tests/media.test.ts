import { describe, expect, it } from 'vitest';
import { handleServeMedia } from '../src/handlers/media';
import type { Env } from '../src/index';

/**
 * issue #20：媒体 serve 存量资产回退 —— 白名单判定落空时按字节魔数嗅探
 * （与上传侧同一套 sniffMime 规则），识别成功按真实 MIME 返回；
 * 仍无法识别维持 octet-stream 强制下载。处置策略全程 attachment + nosniff。
 *
 * 接缝：handleServeMedia —— 工单 Key interfaces 点名的 serve MIME 判定链
 * （KV 元数据 → 扩展名回退 → 字节魔数嗅探 → octet-stream）。
 * KV 边界以桩对象替代（get / getWithMetadata），直接断言 HTTP 响应。
 */

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const UNRECOGNIZED = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];

/** 部分受支持格式的魔数首部（嗅探命中的最小样本） */
const MAGIC_SAMPLES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e] },
];

const SVG_BUFFER = bytesToBuffer(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'));

/** 把字节序列变成真实 ArrayBuffer（模拟 KV type=arrayBuffer 的返回形状） */
function bytesToBuffer(bytes: readonly number[] | Uint8Array): ArrayBuffer {
  const u8 = bytes instanceof Uint8Array ? bytes.slice() : Uint8Array.from(bytes);
  return u8.buffer;
}

type KvEntry = { value?: ArrayBuffer; metadata?: unknown };

function makeEnv(kv: Record<string, KvEntry>): Env {
  return {
    MEDIA: {
      get: (key: string) => Promise.resolve(kv[key]?.value ?? null),
      getWithMetadata: (key: string) =>
        Promise.resolve({ value: null, metadata: kv[key]?.metadata ?? null }),
    },
  } as unknown as Env;
}

/** 以指定 KV 内容发起 serve 请求（工单点名的 handler 接缝，无网络边界） */
function serve(kv: Record<string, KvEntry>, key: string): Promise<Response> {
  return handleServeMedia(new Request('https://example.com/api/v1/media/serve/x'), makeEnv(kv), { '0': key });
}

describe('handleServeMedia 存量资产回退（issue #20）', () => {
  it('元数据缺失、扩展名不在回退表，但内容为 PNG：按魔数识别为 image/png', async () => {
    const res = await serve({
      'media/2023/05/legacy.dat': { value: bytesToBuffer(PNG_BYTES) },
    }, 'media/2023/05/legacy.dat');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(true);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('历史非白名单元数据（image/bmp），内容为 PNG：嗅探结果覆盖声明类型', async () => {
    const res = await serve({
      'media/2022/01/old.png': { value: bytesToBuffer(PNG_BYTES), metadata: { mime_type: 'image/bmp' } },
    }, 'media/2022/01/old.png');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('历史通用元数据（application/octet-stream），内容为 SVG：按魔数识别，处置仍 attachment（不恢复内联直开）', async () => {
    const res = await serve({
      'media/2021/03/diagram.bin': { value: SVG_BUFFER, metadata: { mime_type: 'application/octet-stream' } },
    }, 'media/2021/03/diagram.bin');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(true);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('存量为其余受支持格式（jpeg/gif/webp/pdf）时同样按魔数识别，处置仍 attachment', async () => {
    for (const sample of MAGIC_SAMPLES) {
      const res = await serve({
        'media/2024/02/asset.bin': { value: bytesToBuffer(sample.bytes) },
      }, 'media/2024/02/asset.bin');

      expect(res.headers.get('Content-Type'), sample.mime).toBe(sample.mime);
      expect(res.headers.get('Content-Disposition')?.startsWith('attachment'), sample.mime).toBe(true);
    }
  });

  it('元数据缺失、内容无法识别：维持 application/octet-stream 强制下载', async () => {
    const res = await serve({
      'media/2023/05/blob.dat': { value: bytesToBuffer(UNRECOGNIZED) },
    }, 'media/2023/05/blob.dat');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(true);
  });

  it('历史非白名单元数据 + 内容无法识别：维持 octet-stream，不凭扩展名放行', async () => {
    const res = await serve({
      'media/2023/05/mystery.png': { value: bytesToBuffer(UNRECOGNIZED), metadata: { mime_type: 'image/bmp' } },
    }, 'media/2023/05/mystery.png');

    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('白名单命中（元数据 MIME 合法）时不嗅探：非法 PNG 字节仍按元数据类型返回', async () => {
    const res = await serve({
      'media/2024/01/fresh.png': { value: bytesToBuffer(UNRECOGNIZED), metadata: { mime_type: 'image/png' } },
    }, 'media/2024/01/fresh.png');

    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(true);
  });

  it('白名单命中（扩展名回退合法）时不嗅探：缺元数据的 .jpg 键仍按扩展名返回', async () => {
    const res = await serve({
      'media/2024/01/legacy.jpg': { value: bytesToBuffer(UNRECOGNIZED) },
    }, 'media/2024/01/legacy.jpg');

    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });
});
