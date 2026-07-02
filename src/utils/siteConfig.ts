interface SiteConfig {
  site_title: string;
  site_subtitle: string;
  site_description: string;
  site_keywords: string;
  posts_per_page: string;
  about_content: string;
}

let cachedConfig: SiteConfig | null = null;
let configPromise: Promise<SiteConfig | null> | null = null;

export async function getSiteConfig(): Promise<SiteConfig | null> {
  if (cachedConfig) return cachedConfig;
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const res = await fetch('/api/v1/config');
      const data = await res.json();
      if (data.code === 0 && data.data) {
        cachedConfig = data.data as SiteConfig;
        return cachedConfig;
      }
      return null;
    } catch {
      return null;
    }
  })();

  return configPromise;
}

export function applySiteConfig(config: SiteConfig) {
  const logo = document.querySelector('.site-logo span');
  if (logo && config.site_title) logo.textContent = config.site_title;

  const footer = document.querySelector('.footer-inner p');
  if (footer && config.site_title) footer.textContent = `\u00A9 ${new Date().getFullYear()} ${config.site_title}`;

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && config.site_description && !metaDesc.getAttribute('data-page-set')) {
    metaDesc.setAttribute('content', config.site_description);
  }

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && config.site_title) ogTitle.setAttribute('content', document.title);

  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc && config.site_description) ogDesc.setAttribute('content', config.site_description);

  const keywords = document.querySelector('meta[name="keywords"]');
  if (keywords && config.site_keywords) keywords.setAttribute('content', config.site_keywords);
}