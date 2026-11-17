// 全站导航回归：每个页面经"客户端导航离开 → 客户端导航返回"后，动态内容必须与首次进入一致
// 用法：node scripts/verify-all-pages-nav.mjs
// 退出码 0 = 全部一致；1 = 有页面导航后内容缺失
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";

// 注意：slug 收集在浏览器内进行。Node 端全局 fetch 读取 astro dev 代理的 /api 响应时，
// 响应 body 存在 chunked/gzip 编码兼容问题（r.json() 挂起或 Z_DATA_ERROR），浏览器 fetch 则正常

// 友链 island 每次导航重新挂载会请求 /api/v1/friend-links，先注册响应等待，保证快照时数据就绪
async function navByLink(page, href) {
  const friendResp = page
    .waitForResponse((r) => r.url().includes("/api/v1/friend-links"), {
      timeout: 12000,
    })
    .catch(() => {});
  // 注入临时链接并真实点击，确保走 ClientRouter 客户端导航（而非硬加载）
  await page.evaluate((h) => {
    let a = document.getElementById("__test-nav__");
    if (!a) {
      a = document.createElement("a");
      a.id = "__test-nav__";
      a.style.cssText =
        "position:fixed;top:8px;left:8px;z-index:99999;font-size:12px;";
      document.body.appendChild(a);
    }
    a.setAttribute("href", h);
    a.textContent = h;
  }, href);
  await page.click("#__test-nav__");
  // taxonomy v2（#81 §5）：目标可能带 ?tag= 查询串，pathname+search 一起比对
  await page.waitForFunction(
    (h) => location.pathname + location.search === h,
    href,
    { timeout: 10000 }
  );
  await friendResp;
}

/**
 * taxonomy v2 回归期网络容错：本机到远端 API 的新建连接偶发失败/挂起
 * （直连与代理均 ~1/6），连接池热了之后稳定。每次导航前先打一发
 * /api/v1/health 预热 dev server → 上游的连接池，失败换发直至成功（上限 5 次）。
 * 只影响测试基建，不改变产品代码与断言语义。
 */
async function warmUpApi(page) {
  for (let i = 0; i < 5; i++) {
    const ok = await page
      .evaluate(async () => {
        try {
          const r = await fetch("/api/v1/health", { cache: "no-store" });
          const d = await r.json();
          return d?.status === "ok";
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(800);
  }
}

// 等待页面动态内容真正渲染（卡片或空状态/错误占位出现），替代固定 sleep，避免把未完成加载当结果
async function waitForPageLoaded(page, target) {
  // 先等所有"加载中"占位消失（占位可能有多个）
  await page
    .waitForFunction(
      () =>
        !document.querySelector(
          ".loading-placeholder, .article-loading, .taxonomy-loading, .categories-loading, .tags-loading"
        ),
      { timeout: 15000 }
    )
    .catch(() => {});
  if (target === "/") {
    await page.waitForSelector("#article-grid > *", { timeout: 15000 });
  } else if (
    target === "/articles" ||
    target.startsWith("/categories/") ||
    target.startsWith("/tags/")
  ) {
    await page.waitForSelector(".article-list-inner > *", { timeout: 15000 });
  } else if (target === "/archives") {
    await page.waitForSelector("#archives-list > :not(.loading-placeholder)", {
      timeout: 15000,
    });
  } else if (target === "/about") {
    await page.waitForSelector("#about-content > :not(.loading-placeholder)", {
      timeout: 15000,
    });
  } else if (target === "/search") {
    await page.waitForSelector("#search-tags > :not(.taxonomy-loading)", {
      timeout: 15000,
    });
  } else if (target === "/categories") {
    await page.waitForSelector(
      "#categories-cloud > :not(.categories-loading)",
      { timeout: 15000 }
    );
  } else if (target === "/tags") {
    await page.waitForSelector("#tags-cloud > :not(.tags-loading)", {
      timeout: 15000,
    });
  } else if (target.startsWith("/categories/") && target.includes("?tag=")) {
    // taxonomy v2（#81 §5）：分类详情筛选页等筛选条与列表就绪
    await page.waitForSelector("#category-filter-chips .filter-chip", {
      timeout: 15000,
    });
    await page.waitForSelector(".article-list-inner > *", { timeout: 15000 });
  } else if (target.startsWith("/articles/")) {
    await page.waitForSelector(".article-title, .article-not-found", {
      timeout: 15000,
    });
    // 文章详情的评论 island 挂载完成
    await page
      .waitForSelector("#comment-section-mount > *", { timeout: 10000 })
      .catch(() => {});
  }
  await page.waitForTimeout(300);
}

function contentCheck(page) {
  return page.evaluate(() => {
    const qa = (s) => document.querySelectorAll(s).length;
    const q = (s) => document.querySelector(s);
    return {
      path: location.pathname,
      homeCards: qa("#article-grid .article-card"),
      heroTitle: q("#hero-site-title")?.textContent || null,
      heroDesc: q("#hero-site-desc")?.textContent || null,
      listCards: qa(".article-list-inner .list-card"),
      archiveYears: qa(".archive-year"),
      aboutProse: qa("#about-content .prose"),
      aboutEmpty: qa("#about-content .about-empty"),
      searchTags: qa("#search-tags .taxonomy-item"),
      searchCats: qa("#search-categories .taxonomy-item"),
      searchInput: qa(".search-container input"),
      categoryItems: qa(".category-item"),
      tagItems: qa(".tag-item"),
      // taxonomy v2（#81）新增快照维度
      tagGroups: qa("#tags-cloud .tag-group"),
      tagGroupLinks: qa("#tags-cloud .tag-group-name"),
      searchTagGroups: qa("#search-tags .tag-group"),
      sameCatChips: qa("#same-category-tags:not([hidden]) .same-category-tag"),
      filterChips: qa("#category-filter-chips .filter-chip"),
      activeFilterChips: qa(
        '#category-filter-chips .filter-chip[aria-pressed="true"]'
      ),
      categoryTagChips: qa(".category-tag-chip"),
      breadcrumbs: qa(".breadcrumb"),
      articleTagGroups: qa(".article-detail .article-tag-group"),
      discoveryVisible:
        document.getElementById("taxonomy-discovery")?.hidden === false,
      articleTitle: q(".article-title")?.textContent || null,
      articleContent: qa(".article-content"),
      likeMounted: qa("#like-button-mount > *"),
      commentsMounted: qa("#comment-section-mount > *"),
      friendLinks: qa(".footer-friend-links .link-item"),
      loadingLeft: qa(
        ".loading-placeholder, .article-loading, .taxonomy-loading, .categories-loading, .tags-loading"
      ),
    };
  });
}

// 首次进入某页面时，该页必须满足的最小加载断言（防止"加载中"残留也算通过）
const BASELINE = {
  "/": (s) => s.homeCards === 3 && !!s.heroTitle && !!s.heroDesc,
  "/articles": (s) => s.listCards === 3,
  "/archives": (s) => s.archiveYears > 0,
  "/about": (s) => s.aboutProse === 1 || s.aboutEmpty === 1,
  "/search": (s) => s.searchInput === 1 && s.loadingLeft === 0,
  "/categories": (s) => s.categoryItems > 0,
  "/tags": (s) => s.tagItems > 0 && s.tagGroups > 0,
  // taxonomy v2（#81）：筛选页（/categories/:slug?tag=<slug>）——筛选条已渲染且恰一个选中项
  __filter__: (s) => s.filterChips > 0 && s.activeFilterChips === 1,
};
function baselineFor(target) {
  return (
    BASELINE[target] ??
    (target.includes("?tag=") ? BASELINE.__filter__ : undefined)
  );
}

async function run() {
  const failures = [];

  const targets = Object.keys(BASELINE).filter((k) => !k.startsWith("__"));

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon"))
      consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

  // 首页硬加载基线（taxonomy v2 回归期：dev→远端 API 首连偶发挂起，
  // 失败重试一次再判死，属网络环境容错、不掩盖真实回归）
  let homeLoaded = false;
  for (let i = 0; i < 3 && !homeLoaded; i++) {
    try {
      await page.goto(BASE + "/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await warmUpApi(page);
      await page.waitForSelector("#article-grid .article-card", {
        timeout: 15000,
      });
      homeLoaded = true;
    } catch (e) {
      if (i === 2) throw e;
      console.log("[retry] 首页硬加载超时，重试一次…");
    }
  }

  // 收集真实 slug（在浏览器内 fetch，规避 Node fetch 与 dev server 代理响应的编码兼容问题）
  // dev→远端 API 首连偶发 502：失败重试一次再判死（网络环境容错）
  let slugs = null;
  for (let i = 0; i < 3 && !slugs; i++) {
    try {
      await warmUpApi(page);
      slugs = await page.evaluate(async () => {
        const pick = (d) => (Array.isArray(d) ? d : d.items || []);
        const [a, c, t] = await Promise.all([
          fetch("/api/v1/articles?page=1&page_size=5&status=published").then(
            (r) => r.json()
          ),
          fetch("/api/v1/categories").then((r) => r.json()),
          fetch("/api/v1/tags").then((r) => r.json()),
        ]);
        if (!a.data || !c.data || !t.data) return null; // 任一取数 502 → 触发重试
        const cat = pick(c.data)[0];
        // taxonomy v2（#81）：取该分类下的一个标签，供 ?tag= 筛选页用例
        let tagOfCat = null;
        if (cat?.slug) {
          const tt = await fetch(
            `/api/v1/tags?category_slug=${encodeURIComponent(cat.slug)}`
          )
            .then((r) => r.json())
            .catch(() => null);
          tagOfCat =
            tt && tt.code === 0 ? (pick(tt.data)[0]?.slug ?? null) : null;
        }
        return {
          article: a.data.items[0]?.slug,
          cat: cat?.slug,
          tag: pick(t.data)[0]?.slug,
          tagOfCat,
        };
      });
    } catch (e) {
      if (i === 2) throw e;
      console.log("[retry] slug 收集失败，重试一次…");
      await page.waitForTimeout(1500);
    }
  }
  if (slugs.article)
    targets.push("/articles/" + encodeURIComponent(slugs.article));
  if (slugs.cat) targets.push("/categories/" + encodeURIComponent(slugs.cat));
  if (slugs.tag) targets.push("/tags/" + encodeURIComponent(slugs.tag));
  // taxonomy v2（#81 §5）：?tag= 筛选契约（该分类下真实存在的标签；不存在则跳过）
  if (slugs.cat && slugs.tagOfCat) {
    targets.push(
      `/categories/${encodeURIComponent(slugs.cat)}?tag=${encodeURIComponent(slugs.tagOfCat)}`
    );
  }

  for (const target of targets) {
    let first = null;
    let second = null;
    let matched = false;
    // 整个"进入→离开→返回"序列最多跑 2 次：dev 代理远程 API 偶发失败会导致两次结果偶然不一致；
    // 单次尝试内抛异常（导航 / 等待超时）也按"本次未成"处理，重试一次而不是整脚本崩掉
    for (let attempt = 0; attempt < 3 && !matched; attempt++) {
      try {
        await warmUpApi(page);
        // 1) 客户端导航进入目标页
        await navByLink(page, target);
        await waitForPageLoaded(page, target);
        first = await contentCheck(page);
        // 2) 客户端导航离开
        await navByLink(page, "/about");
        await waitForPageLoaded(page, "/about");
        // 3) 客户端导航返回目标页
        await navByLink(page, target);
        await waitForPageLoaded(page, target);
        second = await contentCheck(page);

        const { path: _p, ...a } = first;
        const { path: _q, ...b } = second;
        matched =
          second.loadingLeft === 0 && JSON.stringify(a) === JSON.stringify(b);
        if (!matched && attempt === 0) {
          console.log(
            `[retry] ${target} 两次快照不一致或加载未完成，重试一次…`
          );
        }
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(
          `[retry] ${target} 第 ${attempt + 1} 次尝试异常（${String(e.message).split("\n")[0]}），重试一次…`
        );
      }
    }

    // 断言 A：首次进入满足基线
    const check = baselineFor(target);
    if (check && !check(first)) {
      failures.push(`${target} 首次进入未完成加载：${JSON.stringify(first)}`);
    }
    // 断言 B：导航返回后内容与首次一致
    const { path: _p, ...a } = first;
    const { path: _q, ...b } = second;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`${target} 导航返回后内容变化：
        首次 ${JSON.stringify(a)}
        返回 ${JSON.stringify(b)}`);
    }
    // 断言 C：无"加载中"残留
    if (second.loadingLeft > 0) {
      failures.push(
        `${target} 导航返回后仍有 ${second.loadingLeft} 个加载占位`
      );
    }
    console.log(`OK ${target}  ${JSON.stringify(b)}`);
  }

  await browser.close();

  // taxonomy v2（#81 §8）：375px 触控视口无横向滚动（六条 taxonomy 页面）
  try {
    const mobile = await chromium.launch({ channel: "msedge", headless: true });
    const mpage = await mobile.newPage({
      viewport: { width: 375, height: 667 },
    });
    const mobileTargets = ["/tags", "/categories", "/search"];
    if (slugs.cat)
      mobileTargets.push("/categories/" + encodeURIComponent(slugs.cat));
    if (slugs.tag) mobileTargets.push("/tags/" + encodeURIComponent(slugs.tag));
    const overflowFails = [];
    for (const target of mobileTargets) {
      await mpage.goto(BASE + target, { waitUntil: "networkidle" });
      await mpage.waitForTimeout(600);
      const overflow = await mpage.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      if (overflow > 1) {
        overflowFails.push(`${target} 横向溢出 ${overflow}px`);
      }
    }
    await mobile.close();
    if (overflowFails.length) {
      failures.push(
        "375px 无横向滚动（#81 §8）：\n    " + overflowFails.join("\n    ")
      );
    }
  } catch (e) {
    failures.push("375px 视口检查异常：" + e.message);
  }

  console.log("\n================ 结果 ================");
  if (consoleErrors.length) {
    failures.push("控制台错误：\n    " + consoleErrors.join("\n    "));
  }
  if (failures.length === 0) {
    console.log(`PASS：${targets.length} 个页面导航返回后内容全部一致`);
    process.exit(0);
  } else {
    console.log(`FAIL：${failures.length} 处问题：`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("脚本异常：", e);
  process.exit(2);
});
