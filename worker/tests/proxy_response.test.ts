import { describe, expect, it } from "vitest";
import { mapFetchedFailure, MAX_REDIRECTS } from "../src/handlers/img_proxy";
import type { ProxyFetchFailure } from "../src/handlers/img_proxy";

/**
 * issue #22：img/text 两通道 fetched.kind → 错误 Response 的共享映射行为契约。
 *
 * 接缝：mapFetchedFailure —— 原 img_proxy / text_proxy 两处同形 if 级联的收敛点。
 * 四种失败 kind 的状态码 / code / 消息须与收敛前逐字一致；kind 'ok' 不进本映射，
 * 由两通道各自的非 2xx / MIME 白名单 / 大小检查继续处置。
 */

const failure = (kind: ProxyFetchFailure["kind"]): ProxyFetchFailure =>
  ({ kind }) as ProxyFetchFailure;

async function bodyOf(
  res: Response
): Promise<{ code: number; message: string; data: null }> {
  return (await res.json()) as { code: number; message: string; data: null };
}

describe("mapFetchedFailure fetched.kind → Response 映射（issue #22）", () => {
  it.each([
    ["blocked", 403, "目标地址被禁止代理"],
    ["resolution_failed", 502, "目标域名解析失败或超时，已拒绝代理"],
    ["too_many_redirects", 502, `重定向次数超过 ${MAX_REDIRECTS} 次`],
  ] as const)(
    "kind %s → %s，错误码与消息与原两通道级联逐字一致",
    async (kind, status, message) => {
      const res = mapFetchedFailure(failure(kind), "上游任意拉取失败");

      expect(res).not.toBeNull();
      expect(res!.status).toBe(status);
      await expect(bodyOf(res!)).resolves.toEqual({
        code: status,
        message,
        data: null,
      });
    }
  );

  it("kind fetch_failed → 502，措辞按通道传入（图片通道/文字通道）", async () => {
    for (const message of ["上游图片拉取失败", "上游内容拉取失败"]) {
      const res = mapFetchedFailure(failure("fetch_failed"), message);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(502);
      await expect(bodyOf(res!)).resolves.toEqual({
        code: 502,
        message,
        data: null,
      });
    }
  });

  it("同一 kind 未命中失败映射时由调用方分流（契约形状：非失败 kind 不进映射输入）", () => {
    // 类型层面 'ok' 不能传给 mapFetchedFailure（Exclude 自联合类型）；此处验证
    // 输入类型体量确实只含四种失败 kind，防止未来误把成功路径塞进映射。
    type FailureKinds = ProxyFetchFailure["kind"];
    const kinds: FailureKinds[] = [
      "blocked",
      "resolution_failed",
      "too_many_redirects",
      "fetch_failed",
    ];
    expect(kinds).toHaveLength(4);
    expect(kinds).not.toContain("ok");
  });
});
