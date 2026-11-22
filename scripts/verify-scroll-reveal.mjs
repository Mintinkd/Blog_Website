/**
 * 平板快速滑动「UI 丢失」回归（手动）。
 *
 * 复现路径：首页动态渲染出文章卡片后，模拟平板 fling（一次滚动跨越大段视口）。
 * IntersectionObserver 对「一帧内整段跨过视口」的元素前后两次观测都是不相交，
 * 收不到 isIntersecting，元素就永远停在 opacity: 0 —— 表现为卡片 / 区块整片空白，
 * 继续滑动再进入视口才恢复。本脚本断言滚动兜底（motion.ts 的 sweepReveal）把它补上。
 *
 * 前置：`npx astro dev --port 4321`（不访问真实 Worker，/api/v1/** 全部本地 fixture）。
 * 用法：`node scripts/verify-scroll-reveal.mjs`；Windows 可设 `PW_CHANNEL=msedge`。
 * 退出码：0 通过 / 1 断言失败 / 2 环境或脚本异常。
 */
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL || undefined;
const CARD_COUNT = 20;
const JUMP_ROUNDS = 10;

const ARTICLE = (i) => ({
  id: i,
  slug: `scroll-reveal-fixture-${i}`,
  title: `快速滑动回归文章 ${i}`,
  summary: "固定 fixture：卡片高度稳定，便于复现 fling 时入场观测漏帧。",
  cover_image: "/bg-placeholder.svg",
  category: { id: 1, name: "前端", slug: "frontend" },
  tags: [{ name: "vue", slug: "vue" }],
  view_count: 10 + i,
  published_at: "2026-11-01T08:00:00.000Z",
});

async function installFixtures(page) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/v1/articles"
        ? {
            code: 0,
            data: {
              items: Array.from({ length: CARD_COUNT }, (_, i) =>
                ARTICLE(i + 1)
              ),
              total: CARD_COUNT,
              page: 1,
              page_size: CARD_COUNT,
            },
          }
        : { code: 0, data: [] };
    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(body),
    });
  });
}

const run = async () => {
  const browser = await chromium.launch({ channel: CHANNEL });
  const context = await browser.newContext({
    viewport: { width: 800, height: 1280 }, // Android 平板竖屏
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // fixture 覆盖不到的外链资源（图片 / 一言）按环境噪声过滤
    if (/Failed to load resource/i.test(m.text())) return;
    pageErrors.push(m.text());
  });
  await installFixtures(page);

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (n) => document.querySelectorAll(".article-card").length === n,
    CARD_COUNT,
    { timeout: 15000 }
  );
  await page.waitForTimeout(1000);

  const layerContract = await page.evaluate(() => ({
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    revealWillChange: [
      ...new Set(
        [...document.querySelectorAll("[data-reveal]")].map(
          (el) => getComputedStyle(el).willChange
        )
      ),
    ],
  }));

  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight
  );
  // 固定种子：跳转序列可复现
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const failures = [];
  for (let round = 0; round < JUMP_ROUNDS; round++) {
    const target = Math.round(rand() * maxScroll);
    await page.evaluate(
      (top) => window.scrollTo({ top, behavior: "instant" }),
      target
    );
    await page.waitForTimeout(400);
    const stuck = await page.evaluate(() => {
      const vh = window.innerHeight;
      return [...document.querySelectorAll(".article-card")]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          const hidden = parseFloat(getComputedStyle(card).opacity) < 0.99;
          const animating = card
            .getAnimations()
            .some((a) => a.playState === "running");
          if (!hidden || animating) return false;
          // 已滚过视口，或停在视口内：都不该再藏着
          return rect.bottom <= 0 || (rect.top < vh && rect.bottom > 0);
        })
        .map((card) => ({
          top: Math.round(card.getBoundingClientRect().top),
          opacity: getComputedStyle(card).opacity,
          revealed: card.classList.contains("is-revealed"),
        }));
    });
    if (stuck.length) failures.push({ round, scrollY: target, stuck });
  }

  const problems = [];
  if (failures.length) {
    problems.push(`fling 后仍有隐藏卡片：${JSON.stringify(failures, null, 2)}`);
  }
  if (
    layerContract.coarsePointer &&
    layerContract.revealWillChange.some((v) => v !== "auto")
  ) {
    problems.push(
      `触屏设备上 reveal 元素仍常驻 will-change：${layerContract.revealWillChange.join(", ")}`
    );
  }
  if (pageErrors.length) problems.push(`页面报错：${pageErrors.join(" | ")}`);

  if (problems.length) {
    console.error("✗ 平板快速滑动回归失败\n" + problems.join("\n"));
    await browser.close();
    process.exit(1);
  }

  console.log(
    `✓ ${CARD_COUNT} 张卡片、${JUMP_ROUNDS} 次大跨度跳转后无隐藏卡片；` +
      `触屏 will-change=${layerContract.revealWillChange.join(",")}`
  );
  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(2);
});
