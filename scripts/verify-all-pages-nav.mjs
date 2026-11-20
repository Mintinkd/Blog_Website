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

/**
 * taxonomy SSR 回归（#119）的接口真值。本机 dev→远端 API 偶发失败，
 * 沿用 warmUpApi 的容错约定换发直至成功（上限 3 次）。
 */
async function fetchTaxonomyTruth(page) {
  for (let i = 0; i < 3; i++) {
    await warmUpApi(page);
    const data = await page
      .evaluate(async () => {
        const pick = (d) => (Array.isArray(d) ? d : d.items || []);
        const [c, t] = await Promise.all([
          fetch("/api/v1/categories").then((r) => r.json()),
          fetch("/api/v1/tags").then((r) => r.json()),
        ]);
        return {
          categories:
            c.code === 0
              ? pick(c.data).map((x) => ({
                  name: x.name,
                  slug: x.slug,
                  tag_count: x.tag_count ?? 0,
                }))
              : null,
          tags:
            t.code === 0
              ? pick(t.data).map((x) => ({
                  name: x.name,
                  slug: x.slug,
                  categorySlug: x.category?.slug ?? null,
                }))
              : null,
        };
      })
      .catch(() => null);
    if (data?.categories && data?.tags) return data;
    await page.waitForTimeout(800);
  }
  throw new Error("接口取数失败，无法比对 taxonomy SSR");
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
    // #121：分类 discovery 取数完成后再快照；失败保持 hidden 时由断言给出原因
    await page
      .waitForSelector(
        "#taxonomy-discovery:not([hidden]) #discovery-categories .discovery-cat",
        { timeout: 15000 }
      )
      .catch(() => {});
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
    // #118：搜索页只剩关键词搜索，等待输入框挂载即可
    await page.waitForSelector(".search-container input", { timeout: 15000 });
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
      searchInput: qa(".search-container input"),
      categoryItems: qa(".category-item"),
      tagItems: qa(".tag-item"),
      // taxonomy v2（#81）新增快照维度
      tagGroups: qa("#tags-cloud .tag-group"),
      tagGroupLinks: qa("#tags-cloud .tag-group-name"),
      sameCatChips: qa("#same-category-tags:not([hidden]) .same-category-tag"),
      filterChips: qa("#category-filter-chips .filter-chip"),
      activeFilterChips: qa(
        '#category-filter-chips .filter-chip[aria-current="page"]'
      ),
      activeFilterTags: [
        ...document.querySelectorAll(
          '#category-filter-chips .filter-chip[aria-current="page"]'
        ),
      ].map((a) => a.dataset.tag || ""),
      filterVisible:
        document.getElementById("category-tag-filter")?.hidden === false,
      categoryTagChips: qa(".category-tag-chip"),
      breadcrumbs: qa(".breadcrumb"),
      articleTagGroups: qa(".article-detail .article-tag-group"),
      discoveryVisible:
        document.getElementById("taxonomy-discovery")?.hidden === false,
      discoveryCats: qa("#discovery-categories .discovery-cat"),
      discoveryTags: qa("#discovery-tags"),
      taxonomyTagLinks: qa('#taxonomy-discovery a[href^="/tags"]'),
      taxonomyText: q("#taxonomy-discovery")?.textContent || "",
      allTagsLink: qa(".all-tags-link"),
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
  // taxonomy v2（#81）：筛选页（/categories/:slug?tag=<slug>）——筛选条已渲染、
  // 恰一个 aria-current=page 的 chip（#117：链接语义），且 SSR/客户端已渲染卡片
  __filter__: (s) =>
    s.filterChips > 0 && s.activeFilterChips === 1 && s.listCards > 0,
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

  // #121：记录首页硬加载期间的 taxonomy 请求，稍后断言不含 /api/v1/tags
  const homeTagRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/tags")) homeTagRequests.push(r.url());
  });

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
      // 等分类 discovery 取数完成（#121 断言覆盖 taxonomy 取数；失败保持 hidden 时由断言报原因）
      await page
        .waitForSelector(
          "#taxonomy-discovery:not([hidden]) #discovery-categories .discovery-cat",
          { timeout: 15000 }
        )
        .catch(() => {});
      homeLoaded = true;
    } catch (e) {
      if (i === 2) throw e;
      console.log("[retry] 首页硬加载超时，重试一次…");
    }
  }

  // #121：首页 taxonomy 区块只取分类，不再请求 /api/v1/tags
  if (homeTagRequests.length) {
    failures.push(
      `首页硬加载仍请求 /api/v1/tags（#121）：${homeTagRequests.join(", ")}`
    );
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
            tt && tt.code === 0
              ? (pick(tt.data).find((t) => (t.article_count ?? 0) > 0)?.slug ??
                null)
              : null;
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

  // #121：前台入口移除后 /tags、/tags/:slug 仍保留为兼容入口，直连必须 200
  await warmUpApi(page);
  const tagEntryRoutes = ["/tags"];
  if (slugs.tag) {
    tagEntryRoutes.push("/tags/" + encodeURIComponent(slugs.tag));
  } else {
    console.log(
      "[skip] /tags/:slug 直连 200 回归：标签 API 未返回任何标签 slug（#121）"
    );
  }
  for (const route of tagEntryRoutes) {
    const res = await page.request.get(BASE + route);
    if (res.status() !== 200) {
      failures.push(`${route} 直连返回 ${res.status()}，期望 200（#121）`);
    }
  }

  for (const target of targets) {
    let first = null;
    let second = null;
    let matched = false;
    // #121：记录本次客户端导航进入 / 返回首页窗口内的 /api/v1/tags 请求
    let homeNavTagRequests = [];
    // #118：导航「标签」入口必须消失。单独取数，不放进内容快照——
    // 否则导航回归会污染「两次快照一致」的判据（断言 B）。
    let navTagLinks = null;
    // 整个"进入→离开→返回"序列最多跑 2 次：dev 代理远程 API 偶发失败会导致两次结果偶然不一致；
    // 单次尝试内抛异常（导航 / 等待超时）也按"本次未成"处理，重试一次而不是整脚本崩掉
    for (let attempt = 0; attempt < 3 && !matched; attempt++) {
      try {
        await warmUpApi(page);
        // 1) 客户端导航进入目标页
        const enterTagMark = homeTagRequests.length;
        await navByLink(page, target);
        await waitForPageLoaded(page, target);
        first = await contentCheck(page);
        if (target === "/") {
          homeNavTagRequests = homeNavTagRequests.concat(
            homeTagRequests.slice(enterTagMark)
          );
        }
        navTagLinks = await page.evaluate(
          () => document.querySelectorAll('.nav-links a[href="/tags"]').length
        );
        // 2) 客户端导航离开
        await navByLink(page, "/about");
        await waitForPageLoaded(page, "/about");
        // 3) 客户端导航返回目标页
        const returnTagMark = homeTagRequests.length;
        await navByLink(page, target);
        await waitForPageLoaded(page, target);
        second = await contentCheck(page);
        if (target === "/") {
          homeNavTagRequests = homeNavTagRequests.concat(
            homeTagRequests.slice(returnTagMark)
          );
        }

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

    // 断言 A0（#121）：客户端导航进入 / 返回首页都不得请求 /api/v1/tags
    if (target === "/" && homeNavTagRequests.length) {
      failures.push(
        `首页客户端导航回访仍请求 /api/v1/tags（#121）：${homeNavTagRequests.join(", ")}`
      );
    }
    // 断言 A：首次进入满足基线
    const check = baselineFor(target);
    if (check && !check(first)) {
      failures.push(`${target} 首次进入未完成加载：${JSON.stringify(first)}`);
    }
    // 断言 A1（#118）：导航不再有「标签」入口（五项导航：首页 / 文章 / 分类 / 归档 / 关于）
    if (navTagLinks !== 0) {
      failures.push(`${target} 导航仍含「标签」入口：${navTagLinks} 个`);
    }
    // 断言 A1b（#121）：首页 taxonomy 区块只剩分类，不再有热门标签入口
    if (target === "/") {
      if (!first.discoveryVisible || first.discoveryCats === 0) {
        failures.push(
          `首页分类 discovery 未渲染（#121）：${JSON.stringify(first)}`
        );
      }
      if (first.discoveryTags !== 0) {
        failures.push(
          `首页仍存在 #discovery-tags 容器（#121）：${first.discoveryTags} 个`
        );
      }
      if (first.taxonomyTagLinks !== 0) {
        failures.push(
          `首页 taxonomy 区块仍含 /tags 链接（#121）：${first.taxonomyTagLinks} 个`
        );
      }
      if (first.taxonomyText.includes("热门标签")) {
        failures.push("首页 taxonomy 区块仍含「热门标签」文案（#121）");
      }
    }
    // 断言 A1c（#121）：分类页移除「全部标签」入口
    if (target === "/categories" && first.allTagsLink !== 0) {
      failures.push(
        `/categories 仍含「全部标签」入口（#121）：${first.allTagsLink} 个`
      );
    }
    // 断言 A2（#117）：筛选页恰好选中 URL 指定的 tag（「全部」也算通过会让回归失效）
    if (target.includes("?tag=")) {
      const expected = new URL(target, BASE).searchParams.get("tag") ?? "";
      const active = first.activeFilterTags ?? [];
      if (active.length !== 1 || active[0] !== expected) {
        failures.push(
          `${target} 选中 chip 与 URL 不一致：期望 ${expected}，实际 ${JSON.stringify(active)}`
        );
      }
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

  // taxonomy v2（#117）：禁用 JS 时筛选页仍由 SSR 输出筛选后的文章与 aria-current chip
  if (slugs.cat && slugs.tagOfCat) {
    const filterTarget = `/categories/${encodeURIComponent(slugs.cat)}?tag=${encodeURIComponent(slugs.tagOfCat)}`;
    try {
      const noJsContext = await browser.newContext({
        javaScriptEnabled: false,
        locale: "zh-CN",
      });
      const noJsPage = await noJsContext.newPage();
      await noJsPage.goto(BASE + filterTarget, {
        waitUntil: "domcontentloaded",
      });
      await noJsPage.waitForSelector("#category-filter-chips .filter-chip", {
        timeout: 15000,
      });
      const ssr = await contentCheck(noJsPage);
      if (
        ssr.filterChips === 0 ||
        ssr.activeFilterChips !== 1 ||
        ssr.activeFilterTags[0] !== slugs.tagOfCat ||
        ssr.listCards === 0 ||
        !ssr.filterVisible
      ) {
        failures.push(
          `禁用 JS 的筛选页 SSR 输出不完整（#117）${filterTarget}：${JSON.stringify(ssr)}`
        );
      }
      await noJsContext.close();
    } catch (e) {
      failures.push("禁用 JS 的筛选页检查异常：" + e.message);
    }
  }

  // taxonomy SSR（#119）：中文首屏会跳过首次客户端刷新，错误 SSR 数据不会自愈，
  // 因此用禁用 JS 的 context 直接比对服务端 HTML 与接口真值。
  // /categories：每个分类的「N 标签」与接口 tag_count 一致，前 3 个标签 chip 恢复；
  // /tags：有分类归属的标签落在对应分类组，而不是全落到「未分类」。
  try {
    const apiTaxonomy = await fetchTaxonomyTruth(page);

    const noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      locale: "zh-CN",
    });
    const noJsPage = await noJsContext.newPage();

    // /categories：计数 + chip
    await noJsPage.goto(BASE + "/categories", {
      waitUntil: "domcontentloaded",
    });
    await noJsPage.waitForSelector("#categories-cloud .category-item", {
      timeout: 15000,
    });
    const ssrCategories = await noJsPage.evaluate(() =>
      [...document.querySelectorAll("#categories-cloud .category-item")].map(
        (el) => ({
          name: el.querySelector(".category-name")?.textContent?.trim() ?? "",
          countText:
            el.querySelector(".category-count")?.textContent?.trim() ?? "",
          chips: [...el.querySelectorAll(".category-tag-chip")].map((a) =>
            a.getAttribute("href")
          ),
        })
      )
    );
    if (ssrCategories.length !== apiTaxonomy.categories.length) {
      failures.push(
        `/categories SSR 卡片数 ${ssrCategories.length} ≠ 接口分类数 ${apiTaxonomy.categories.length}（#119）`
      );
    }
    for (const cat of apiTaxonomy.categories) {
      const card = ssrCategories.find((c) => c.name === cat.name);
      if (!card) {
        failures.push(`/categories SSR 缺少分类卡片「${cat.name}」（#119）`);
        continue;
      }
      // 卡片结构：`<article_count> 篇文章 · <tag_count> 标签`——取「·」后第一个数字
      const shown = Number(
        (card.countText.split("·")[1] ?? "").match(/\d+/)?.[0]
      );
      if (shown !== cat.tag_count) {
        failures.push(
          `/categories SSR「${cat.name}」标签数 ${shown} ≠ 接口 tag_count ${cat.tag_count}（#119）：${card.countText}`
        );
      }
      const expectedChips = apiTaxonomy.tags
        .filter((t) => t.categorySlug === cat.slug)
        .slice(0, 3)
        .map(
          (t) =>
            `/categories/${encodeURIComponent(cat.slug)}?tag=${encodeURIComponent(t.slug)}`
        );
      if (JSON.stringify(card.chips) !== JSON.stringify(expectedChips)) {
        failures.push(
          `/categories SSR「${cat.name}」标签 chip 不符（#119）：期望 ${JSON.stringify(expectedChips)}，实际 ${JSON.stringify(card.chips)}`
        );
      }
    }

    // /tags：分类分组归属 + chip 目标
    await noJsPage.goto(BASE + "/tags", { waitUntil: "domcontentloaded" });
    await noJsPage.waitForSelector("#tags-cloud .tag-group", {
      timeout: 15000,
    });
    const ssrTags = await noJsPage.evaluate(() =>
      [...document.querySelectorAll("#tags-cloud .tag-group")].map((g) => ({
        head: g.querySelector(".tag-group-name")?.getAttribute("href") ?? null,
        items: [...g.querySelectorAll(".tag-item")].map((a) =>
          a.getAttribute("href")
        ),
      }))
    );
    const ssrTagCount = ssrTags.reduce((n, g) => n + g.items.length, 0);
    if (ssrTagCount !== apiTaxonomy.tags.length) {
      failures.push(
        `/tags SSR 标签数 ${ssrTagCount} ≠ 接口标签数 ${apiTaxonomy.tags.length}（#119）`
      );
    }
    for (const tag of apiTaxonomy.tags) {
      const groupHead = tag.categorySlug
        ? `/categories/${encodeURIComponent(tag.categorySlug)}`
        : null;
      const expectedHref = tag.categorySlug
        ? `${groupHead}?tag=${encodeURIComponent(tag.slug)}`
        : `/tags/${encodeURIComponent(tag.slug)}`;
      const group = ssrTags.find((g) => g.items.includes(expectedHref));
      if (!group) {
        failures.push(
          `/tags SSR 未输出标签「${tag.name}」的 chip ${expectedHref}（#119）`
        );
      } else if (group.head !== groupHead) {
        failures.push(
          `/tags SSR 标签「${tag.name}」落入分组 ${group.head ?? "未分类"}，期望 ${groupHead ?? "未分类"}（#119）`
        );
      }
    }

    await noJsContext.close();
  } catch (e) {
    failures.push("taxonomy SSR 检查异常（#119）：" + e.message);
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
    // #117：筛选页本身（?tag=）也要量 375px 横向溢出
    if (slugs.cat && slugs.tagOfCat) {
      mobileTargets.push(
        `/categories/${encodeURIComponent(slugs.cat)}?tag=${encodeURIComponent(slugs.tagOfCat)}`
      );
    }
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
