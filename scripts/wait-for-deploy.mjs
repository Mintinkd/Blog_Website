#!/usr/bin/env node
/**
 * 部署就绪轮询（issue #106 / L8）。
 *
 * 背景：CI 原本在部署后用固定 `sleep 120` 等 Git 集成的自动部署，再手动覆盖一次
 * ——部署时长翻倍，且依赖隐式时序，等多久都只是猜测。现改为：部署完立刻轮询
 * 线上探针，就绪即返回、超时才失败，失败时打印每条路径的最后状态并非零退出。
 *
 * 探针（同域，覆盖两条链路）：
 * - `/`：Pages（静态 + SSR 产物）
 * - `/api/v1/health`：API Worker（经 Pages 的同源代理），要求 200 且 body.status=ok
 *
 * 配置（环境变量）：
 * - `DEPLOY_BASE_URL`（默认 `https://blog.zenfishlog.dpdns.org`）
 * - `DEPLOY_TIMEOUT_SEC`（默认 180）
 * - `DEPLOY_INTERVAL_SEC`（默认 5）
 */

import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://blog.zenfishlog.dpdns.org";
export const DEFAULT_PATHS = ["/", "/api/v1/health"];
export const DEFAULT_TIMEOUT_SEC = 180;
export const DEFAULT_INTERVAL_SEC = 5;

/** 单次探针的请求超时，避免一个挂死的连接吃掉整个预算 */
const PROBE_TIMEOUT_MS = 10_000;

function requirePositiveInt(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(value)}`
    );
  }
  return parsed;
}

/**
 * 解析并校验配置。非法 base URL / 超时一律抛错（fail-closed，不静默降级）。
 * @param {Record<string, string | undefined>} env
 */
export function parseDeployConfig(env = {}) {
  const rawBase = env.DEPLOY_BASE_URL ?? DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new Error(
      `DEPLOY_BASE_URL is not a valid URL: ${JSON.stringify(rawBase)}`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`DEPLOY_BASE_URL must be http(s), got ${parsed.protocol}`);
  }
  const timeoutMs =
    requirePositiveInt(
      env.DEPLOY_TIMEOUT_SEC,
      DEFAULT_TIMEOUT_SEC,
      "DEPLOY_TIMEOUT_SEC"
    ) * 1000;
  const intervalMs =
    requirePositiveInt(
      env.DEPLOY_INTERVAL_SEC,
      DEFAULT_INTERVAL_SEC,
      "DEPLOY_INTERVAL_SEC"
    ) * 1000;

  return {
    baseUrl: parsed.origin,
    paths: [...DEFAULT_PATHS],
    timeoutMs,
    intervalMs,
  };
}

function isHealthPath(path) {
  return path.endsWith("/health");
}

/**
 * 单条探针：200 即可；`/health` 额外要求 body 的 `status === "ok"` 且
 * `db` 不是 `error`（DB 挂掉时 health 仍返回 200，不能放行）。
 */
async function probe(fetchImpl, url, path) {
  try {
    const response = await fetchImpl(url, {
      signal:
        typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(PROBE_TIMEOUT_MS)
          : undefined,
      headers: { "cache-control": "no-cache" },
      redirect: "follow",
    });
    if (!response.ok)
      return { path, ok: false, detail: String(response.status) };
    if (!isHealthPath(path))
      return { path, ok: true, detail: String(response.status) };
    const body = await response.json().catch(() => null);
    const healthy = body?.status === "ok" && body?.db !== "error";
    return {
      path,
      ok: healthy,
      detail: `${response.status} ${body?.status ?? "unknown"}${
        body?.db ? `/${body.db}` : ""
      }`,
    };
  } catch (error) {
    return {
      path,
      ok: false,
      detail: `error:${error instanceof Error ? error.name || "Error" : "unknown"}`,
    };
  }
}

/**
 * 轮询直到全部探针就绪或超出时间预算。
 * @param {{
 *   baseUrl: string;
 *   paths: string[];
 *   timeoutMs: number;
 *   intervalMs: number;
 *   fetchImpl?: typeof fetch;
 *   now?: () => number;
 *   sleep?: (ms: number) => Promise<void>;
 *   log?: (line: string) => void;
 * }} options
 * @returns {Promise<{ attempts: number; elapsedMs: number }>}
 */
export async function waitForReady(options) {
  const {
    baseUrl,
    paths,
    timeoutMs,
    intervalMs,
    fetchImpl = fetch,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (line) => console.log(line),
  } = options;

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("waitForReady requires at least one probe path");
  }

  const start = now();
  let attempts = 0;
  /** @type {Array<{ path: string; ok: boolean; detail: string }>} */
  let lastResults = [];

  for (;;) {
    if (attempts > 0 && now() - start >= timeoutMs) break;
    attempts += 1;
    lastResults = await Promise.all(
      paths.map((path) =>
        probe(fetchImpl, new URL(path, baseUrl).toString(), path)
      )
    );
    log(
      `[deploy-wait] attempt ${attempts}: ` +
        lastResults.map((r) => `${r.path} -> ${r.detail}`).join(", ")
    );
    if (lastResults.every((r) => r.ok)) {
      return { attempts, elapsedMs: now() - start };
    }
    if (now() - start + intervalMs >= timeoutMs) {
      await sleep(Math.max(0, timeoutMs - (now() - start)));
      break;
    }
    await sleep(intervalMs);
  }

  const summary = lastResults.map((r) => `${r.path} -> ${r.detail}`).join(", ");
  throw new Error(
    `Deployment not ready after ${attempts} attempt(s) in ${Math.round(
      (now() - start) / 1000
    )}s. Last status: ${summary}`
  );
}

async function main(env = process.env) {
  const config = parseDeployConfig(env);
  console.log(
    `[deploy-wait] base=${config.baseUrl} paths=${config.paths.join(",")} ` +
      `timeout=${config.timeoutMs / 1000}s interval=${config.intervalMs / 1000}s`
  );
  const result = await waitForReady(config);
  console.log(
    `[deploy-wait] ready after ${result.attempts} attempt(s), ${Math.round(
      result.elapsedMs / 1000
    )}s`
  );
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      `[deploy-wait] FAILED: ${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  });
}
