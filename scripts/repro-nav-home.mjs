// 复现回路：客户端导航（ClientRouter / View Transitions）返回首页后，动态内容是否加载
// 用法：node scripts/repro-nav-home.mjs
// 退出码 0 = 全部正常；1 = 复现到 bug（输出红色断言）
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';

function snapshot(page) {
  return page.evaluate(() => ({
    url: location.pathname,
    cards: document.querySelectorAll('#article-grid .article-card').length,
    listCards: document.querySelectorAll('.article-list-inner .list-card').length,
    gridHtmlLen: (document.getElementById('article-grid')?.innerHTML || '').length,
    heroTitle: document.getElementById('hero-site-title')?.textContent || null,
    heroSubtitle: document.getElementById('hero-site-subtitle')?.textContent || null,
    heroDesc: document.getElementById('hero-site-desc')?.textContent || null,
    logoText: document.getElementById('site-logo-text')?.textContent || null,
    footerText: document.getElementById('footer-text')?.textContent || null,
  }));
}

async function waitForUrl(page, pathname, timeout = 10000) {
  await page.waitForFunction((p) => location.pathname === p, pathname, { timeout });
}

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures = [];
  const log = (...a) => console.log(...a);

  // ============ 场景 1：首页硬加载 → 点"文章" → 点"首页"（客户端导航返回） ============
  {
    const page = await browser.newPage();
    let phase = 'hard-load-home';
    const articleReqs = [];
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/v1/articles')) articleReqs.push({ phase, url: u.slice(BASE.length) });
    });

    // 1) 硬加载首页（基线：内容应当完整）
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#article-grid .article-card', { timeout: 15000 });
    const hard = await snapshot(page);
    log('【硬加载首页】', JSON.stringify(hard, null, 0));

    // 2) 点导航"文章"
    phase = 'nav-to-articles';
    await page.click('.nav-links a[href="/articles"]');
    await waitForUrl(page, '/articles');
    await page.waitForSelector('.article-list-inner .list-card', { timeout: 15000 });

    // 3) 点导航"首页"（ClientRouter 客户端导航）
    phase = 'nav-back-home';
    await page.click('.nav-links a[href="/"]');
    await waitForUrl(page, '/');
    // 给客户端 fetch 充足的执行窗口（若初始化逻辑存在，3 秒内必然完成）
    await page.waitForTimeout(3000);
    const back = await snapshot(page);
    log('【客户端导航返回首页】', JSON.stringify(back, null, 0));
    log('【/api/v1/articles 请求序列】', JSON.stringify(articleReqs, null, 0));

    if (back.cards !== hard.cards) {
      failures.push(`场景1 首页文章卡片数：硬加载 ${hard.cards}，导航返回后 ${back.cards}（最新文章未加载）`);
    }
    if (phase && back.gridHtmlLen === 0) {
      failures.push('场景1 #article-grid 导航返回后为空（loadArticles 未重跑）');
    }
    if (!back.heroDesc) {
      failures.push(`场景1 hero 描述栏导航返回后为空（硬加载时为 "${hard.heroDesc}"）`);
    }
    if (hard.logoText && back.logoText !== hard.logoText) {
      failures.push(`场景1 logo 文案：硬加载 "${hard.logoText}"，导航返回后 "${back.logoText}"`);
    }
    if (hard.footerText && back.footerText !== hard.footerText) {
      failures.push(`场景1 footer 文案：硬加载 "${hard.footerText}"，导航返回后 "${back.footerText}"`);
    }
    const backHomeReq = articleReqs.filter((r) => r.phase === 'nav-back-home').length;
    if (backHomeReq === 0) {
      failures.push('场景1 返回首页后没有发起 /api/v1/articles 请求（页面初始化脚本未重跑）');
    }
    await page.close();
  }

  // ============ 场景 2：冷启动直接落在文章页 → 点"首页"（首次进入首页即客户端导航） ============
  {
    const page = await browser.newPage();
    let phase = 'hard-load-articles';
    const configReqs = [];
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/v1/config')) configReqs.push({ phase });
      if (u.includes('/api/v1/articles')) articleReqs2.push({ phase });
    });
    const articleReqs2 = [];

    await page.goto(BASE + '/articles', { waitUntil: 'networkidle' });
    await page.waitForSelector('.article-list-inner .list-card', { timeout: 15000 });

    phase = 'nav-to-home-first-time';
    await page.click('.nav-links a[href="/"]');
    await waitForUrl(page, '/');
    await page.waitForTimeout(3000);
    const s = await snapshot(page);
    log('【冷启动文章页→客户端导航进首页】', JSON.stringify(s, null, 0));

    if (s.cards === 0) failures.push('场景2 首次经客户端导航进入首页：文章卡片为 0');
    if (!s.heroDesc) failures.push('场景2 首次经客户端导航进入首页：hero 描述为空');
    if (!s.heroTitle || s.heroTitle === '探索 · 记录 · 分享') {
      // 硬加载时 heroTitle 会被 config.site_title 覆盖为 Zen's Blog；客户端导航进来则保持默认
      failures.push(`场景2 hero 标题未应用站点配置："${s.heroTitle}"`);
    }
    if (s.logoText !== "Zen's Blog") {
      failures.push(`场景2 logo 未应用站点配置："${s.logoText}"`);
    }
    await page.close();
  }

  // ============ 场景 3：浏览器后退返回首页（history back 也是"返回首页"的常见路径） ============
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#article-grid .article-card', { timeout: 15000 });
    await page.click('.nav-links a[href="/articles"]');
    await waitForUrl(page, '/articles');
    await page.waitForSelector('.article-list-inner .list-card', { timeout: 15000 });

    await page.goBack();
    await waitForUrl(page, '/');
    await page.waitForTimeout(3000);
    const s = await snapshot(page);
    log('【浏览器后退返回首页】', JSON.stringify(s, null, 0));
    if (s.cards === 0) failures.push('场景3 浏览器后退返回首页：文章卡片为 0');
    if (!s.heroDesc) failures.push('场景3 浏览器后退返回首页：hero 描述为空');
    await page.close();
  }

  await browser.close();

  console.log('\n================ 结果 ================');
  if (failures.length === 0) {
    console.log('PASS：所有场景动态内容均正常加载');
    process.exit(0);
  } else {
    console.log(`FAIL：复现 ${failures.length} 处问题：`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(2);
});
