// 全站导航回归：每个页面经"客户端导航离开 → 客户端导航返回"后，动态内容必须与首次进入一致
// 用法：node scripts/verify-all-pages-nav.mjs
// 退出码 0 = 全部一致；1 = 有页面导航后内容缺失
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';

// 注意：slug 收集在浏览器内进行。Node 端全局 fetch 读取 astro dev 代理的 /api 响应时，
// 响应 body 存在 chunked/gzip 编码兼容问题（r.json() 挂起或 Z_DATA_ERROR），浏览器 fetch 则正常

async function navByLink(page, href) {
  // 友链 island 每次导航重新挂载会请求 /api/v1/friend-links，先注册响应等待，保证快照时数据就绪
  const friendResp = page
    .waitForResponse((r) => r.url().includes('/api/v1/friend-links'), { timeout: 12000 })
    .catch(() => {});
  // 注入临时链接并真实点击，确保走 ClientRouter 客户端导航（而非硬加载）
  await page.evaluate((h) => {
    let a = document.getElementById('__test-nav__');
    if (!a) {
      a = document.createElement('a');
      a.id = '__test-nav__';
      a.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;font-size:12px;';
      document.body.appendChild(a);
    }
    a.setAttribute('href', h);
    a.textContent = h;
  }, href);
  await page.click('#__test-nav__');
  await page.waitForFunction((h) => location.pathname === h, href, { timeout: 10000 });
  await friendResp;
}

// 等待页面动态内容真正渲染（卡片或空状态/错误占位出现），替代固定 sleep，避免把未完成加载当结果
async function waitForPageLoaded(page, target) {
  // 先等所有"加载中"占位消失（占位可能有多个）
  await page
    .waitForFunction(
      () => !document.querySelector('.loading-placeholder, .article-loading, .taxonomy-loading, .categories-loading, .tags-loading'),
      { timeout: 15000 }
    )
    .catch(() => {});
  if (target === '/') {
    await page.waitForSelector('#article-grid > *', { timeout: 15000 });
  } else if (target === '/articles' || target.startsWith('/categories/') || target.startsWith('/tags/')) {
    await page.waitForSelector('.article-list-inner > *', { timeout: 15000 });
  } else if (target === '/archives') {
    await page.waitForSelector('#archives-list > :not(.loading-placeholder)', { timeout: 15000 });
  } else if (target === '/about') {
    await page.waitForSelector('#about-content > :not(.loading-placeholder)', { timeout: 15000 });
  } else if (target === '/search') {
    await page.waitForSelector('#search-tags > :not(.taxonomy-loading)', { timeout: 15000 });
  } else if (target === '/categories') {
    await page.waitForSelector('#categories-cloud > :not(.categories-loading)', { timeout: 15000 });
  } else if (target === '/tags') {
    await page.waitForSelector('#tags-cloud > :not(.tags-loading)', { timeout: 15000 });
  } else if (target.startsWith('/articles/')) {
    await page.waitForSelector('.article-title, .article-not-found', { timeout: 15000 });
    // 文章详情的评论 island 挂载完成
    await page.waitForSelector('#comment-section-mount > *', { timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

function contentCheck(page) {
  return page.evaluate(() => {
    const qa = (s) => document.querySelectorAll(s).length;
    const q = (s) => document.querySelector(s);
    return {
      path: location.pathname,
      homeCards: qa('#article-grid .article-card'),
      heroTitle: q('#hero-site-title')?.textContent || null,
      heroDesc: q('#hero-site-desc')?.textContent || null,
      listCards: qa('.article-list-inner .list-card'),
      archiveYears: qa('.archive-year'),
      aboutProse: qa('#about-content .prose'),
      aboutEmpty: qa('#about-content .about-empty'),
      searchTags: qa('#search-tags .taxonomy-item'),
      searchCats: qa('#search-categories .taxonomy-item'),
      searchInput: qa('.search-container input'),
      categoryItems: qa('.category-item'),
      tagItems: qa('.tag-item'),
      articleTitle: q('.article-title')?.textContent || null,
      articleContent: qa('.article-content'),
      likeMounted: qa('#like-button-mount > *'),
      commentsMounted: qa('#comment-section-mount > *'),
      friendLinks: qa('.footer-friend-links .link-item'),
      loadingLeft: qa('.loading-placeholder, .article-loading, .taxonomy-loading, .categories-loading, .tags-loading'),
    };
  });
}

// 首次进入某页面时，该页必须满足的最小加载断言（防止"加载中"残留也算通过）
const BASELINE = {
  '/': (s) => s.homeCards === 3 && !!s.heroTitle && !!s.heroDesc,
  '/articles': (s) => s.listCards === 3,
  '/archives': (s) => s.archiveYears > 0,
  '/about': (s) => s.aboutProse === 1 || s.aboutEmpty === 1,
  '/search': (s) => s.searchInput === 1 && s.loadingLeft === 0,
  '/categories': (s) => s.categoryItems > 0,
  '/tags': (s) => s.tagItems > 0,
};

async function run() {
  const failures = [];

  const targets = Object.keys(BASELINE);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  // 首页硬加载基线
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#article-grid .article-card', { timeout: 15000 });

  // 收集真实 slug（在浏览器内 fetch，规避 Node fetch 与 dev server 代理响应的编码兼容问题）
  const slugs = await page.evaluate(async () => {
    const pick = (d) => (Array.isArray(d) ? d : d.items || []);
    const [a, c, t] = await Promise.all([
      fetch('/api/v1/articles?page=1&page_size=5&status=published').then((r) => r.json()),
      fetch('/api/v1/categories').then((r) => r.json()),
      fetch('/api/v1/tags').then((r) => r.json()),
    ]);
    return {
      article: a.data.items[0]?.slug,
      cat: pick(c.data)[0]?.slug,
      tag: pick(t.data)[0]?.slug,
    };
  });
  if (slugs.article) targets.push('/articles/' + encodeURIComponent(slugs.article));
  if (slugs.cat) targets.push('/categories/' + encodeURIComponent(slugs.cat));
  if (slugs.tag) targets.push('/tags/' + encodeURIComponent(slugs.tag));

  for (const target of targets) {
    let first = null;
    let second = null;
    let matched = false;
    // 整个"进入→离开→返回"序列最多跑 2 次：dev 代理远程 API 偶发失败会导致两次结果偶然不一致
    for (let attempt = 0; attempt < 2 && !matched; attempt++) {
      // 1) 客户端导航进入目标页
      await navByLink(page, target);
      await waitForPageLoaded(page, target);
      first = await contentCheck(page);
      // 2) 客户端导航离开
      await navByLink(page, '/about');
      await waitForPageLoaded(page, '/about');
      // 3) 客户端导航返回目标页
      await navByLink(page, target);
      await waitForPageLoaded(page, target);
      second = await contentCheck(page);

      const { path: _p, ...a } = first;
      const { path: _q, ...b } = second;
      matched = second.loadingLeft === 0 && JSON.stringify(a) === JSON.stringify(b);
    }

    // 断言 A：首次进入满足基线
    const check = BASELINE[target];
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
      failures.push(`${target} 导航返回后仍有 ${second.loadingLeft} 个加载占位`);
    }
    console.log(`OK ${target}  ${JSON.stringify(b)}`);
  }

  await browser.close();

  console.log('\n================ 结果 ================');
  if (consoleErrors.length) {
    failures.push('控制台错误：\n    ' + consoleErrors.join('\n    '));
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
  console.error('脚本异常：', e);
  process.exit(2);
});
