#!/usr/bin/env node
/**
 * Worker 部署配置渲染（硬编码配置迁移）。
 *
 * `worker/wrangler.jsonc` 是仓库默认配置（本地开发 / 手写脚本消费）。CI 部署前
 * 本脚本按环境变量生成 `worker/wrangler.deploy.jsonc`，把资源标识与站点配置从
 * 代码里挪到 GitHub Actions 的 vars / secrets：
 *
 * - `R2_BUCKET_NAME`       → r2_buckets[].bucket_name
 * - `D1_DATABASE_NAME`     → d1_databases[].database_name（可选）
 * - `D1_DATABASE_ID`       → d1_databases[].database_id（可选）
 * - `KV_MEDIA_ID`          → MEDIA 绑定 id（可选）
 * - `KV_EDIT_LOCK_ID`      → EDIT_LOCK 绑定 id（可选）
 * - `KV_RATE_LIMIT_ID`     → RATE_LIMIT 绑定 id（可选）
 * - `SITE_URL`             → vars.SITE_URL
 * - `WORKER_NAME`          → Worker 名称（可选）
 *
 * 未提供的变量保留 wrangler.jsonc 中的默认值；非法值 fail-closed（不生成配置），
 * 避免部署到错误资源。生成物在 .gitignore 中，不提交。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sourcePath = path.join(repoRoot, "worker", "wrangler.jsonc");
const targetPath = path.join(repoRoot, "worker", "wrangler.deploy.jsonc");

function envValue(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function fail(message) {
  console.error(`[render-worker-config] ${message}`);
  process.exit(1);
}

/** Cloudflare R2 桶名：3–63 位小写字母 / 数字 / 连字符，首尾为字母或数字 */
function validateBucketName(value) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    fail(
      `R2_BUCKET_NAME 非法：${JSON.stringify(value)}（需 3–63 位小写字母/数字/连字符）`
    );
  }
}

/** D1 database UUID */
function validateDatabaseId(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    fail(`D1_DATABASE_ID 不是合法 UUID：${JSON.stringify(value)}`);
  }
}

/** KV namespace id：32 位十六进制 */
function validateKvId(name, value) {
  if (!/^[0-9a-f]{32}$/i.test(value)) {
    fail(`${name} 不是合法 KV 命名空间 id：${JSON.stringify(value)}`);
  }
}

/** 用正则在 JSONC 文本里替换第一个匹配到的字段，保持其余内容与注释原样 */
function replaceField(text, pattern, replacement, label) {
  if (!pattern.test(text)) fail(`wrangler.jsonc 中找不到 ${label}`);
  return text.replace(pattern, (_match, prefix, suffix) => {
    return `${prefix}${replacement}${suffix}`;
  });
}

let config = readFileSync(sourcePath, "utf8");

const bucketName = envValue("R2_BUCKET_NAME");
if (bucketName) {
  validateBucketName(bucketName);
  config = replaceField(
    config,
    /("binding":\s*"MEDIA_BUCKET",\s*"bucket_name":\s*")[^"]*(")/,
    bucketName,
    "r2_buckets[MEDIA_BUCKET].bucket_name"
  );
}

const databaseName = envValue("D1_DATABASE_NAME");
if (databaseName) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(databaseName)) {
    fail(`D1_DATABASE_NAME 非法：${JSON.stringify(databaseName)}`);
  }
  config = replaceField(
    config,
    /("database_name":\s*")[^"]*(")/,
    databaseName,
    "d1_databases[0].database_name"
  );
}

const databaseId = envValue("D1_DATABASE_ID");
if (databaseId) {
  validateDatabaseId(databaseId);
  config = replaceField(
    config,
    /("database_id":\s*")[^"]*(")/,
    databaseId,
    "d1_databases[0].database_id"
  );
}

const kvBindings = [
  ["KV_MEDIA_ID", "MEDIA"],
  ["KV_EDIT_LOCK_ID", "EDIT_LOCK"],
  ["KV_RATE_LIMIT_ID", "RATE_LIMIT"],
];
for (const [envName, binding] of kvBindings) {
  const value = envValue(envName);
  if (!value) continue;
  validateKvId(envName, value);
  config = replaceField(
    config,
    new RegExp(`("binding":\\s*"${binding}",\\s*"id":\\s*")[^"]*(")`),
    value,
    `kv_namespaces[${binding}].id`
  );
}

const siteUrl = envValue("SITE_URL");
let normalizedSiteUrl = "";
if (siteUrl) {
  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch {
    fail(`SITE_URL 不是合法 URL：${JSON.stringify(siteUrl)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(`SITE_URL 必须是 http(s)：${JSON.stringify(siteUrl)}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail(`SITE_URL 不得包含路径 / 查询 / 片段：${JSON.stringify(siteUrl)}`);
  }
  normalizedSiteUrl = parsed.origin;
  config = replaceField(
    config,
    /("SITE_URL":\s*")[^"]*(")/,
    normalizedSiteUrl,
    "vars.SITE_URL"
  );
}

const workerName = envValue("WORKER_NAME");
if (workerName) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName)) {
    fail(`WORKER_NAME 非法：${JSON.stringify(workerName)}`);
  }
  config = replaceField(config, /("name":\s*")[^"]*(")/, workerName, "name");
}

writeFileSync(targetPath, config, "utf8");
console.log(
  `[render-worker-config] 已生成 worker/wrangler.deploy.jsonc` +
    `（bucket=${bucketName || "默认"}，site=${normalizedSiteUrl || "默认"}）`
);
