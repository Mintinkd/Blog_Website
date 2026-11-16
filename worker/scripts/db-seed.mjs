/**
 * npm run db:seed —— 生成随机初始管理员口令并写入 D1（issue #83 / H1）。
 *
 * 新部署不再有硬编码可登录口令：本脚本用 randomUUID() 生成口令，
 * 经 wrangler d1 execute 以 UPSERT 写入 users 表（must_change_password=1，
 * 首次登录强制改密），成功后**只在终端打印一次**明文口令。
 *
 * 用法：
 *   npm run db:seed                      # 远程 D1（默认，需 wrangler 登录）
 *   npm run db:seed -- --local           # 本地 D1（开发）
 *   SEED_ADMIN_USERNAME=foo npm run db:seed
 */
import { spawnSync } from "node:child_process";
import {
  generateSeedCredential,
  seedUpsertSql,
  DEFAULT_SEED_ADMIN_USERNAME,
} from "./seed-credential.mjs";

const args = process.argv.slice(2);
const local = args.includes("--local");
const username = process.env.SEED_ADMIN_USERNAME || DEFAULT_SEED_ADMIN_USERNAME;

const { password, passwordHash } = generateSeedCredential();
const sql = seedUpsertSql(username, passwordHash);

const wranglerArgs = ["wrangler", "d1", "execute", "blog-db", "--command", sql];
if (local) wranglerArgs.push("--local");

const result = spawnSync("npx", wranglerArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error(
    "\n❌ 口令写库失败，本次生成的口令已作废（未打印）。请修复后重新运行 db:seed。"
  );
  process.exit(result.status ?? 1);
}

console.log("\n初始管理员账户已创建/重置：");
console.log(`  用户名：${username}`);
console.log(`  初始口令：${password}`);
console.log("  此口令仅显示这一次，请立即保存；首次登录将强制要求改密。\n");
