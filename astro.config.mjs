import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

function patchRoutesPlugin() {
  return {
    name: 'patch-routes',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const routesPath = path.join(fileURLToPath(dir), '_routes.json');
        try {
          const content = await fs.readFile(routesPath, 'utf-8');
          const routes = JSON.parse(content);
          if (!routes.include.includes('/api/v1/*')) {
            routes.include.push('/api/v1/*');
          }
          routes.include = routes.include.filter(Boolean);
          await fs.writeFile(routesPath, JSON.stringify(routes, null, 2) + '\n');
        } catch {}
      },
    },
  };
}

import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://blog-website.pages.dev',
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    vue(),
    sitemap(),
    patchRoutesPlugin(),
  ],
  build: {
    assets: '_assets',
  },
  vite: {
    ssr: {
      noExternal: ['element-plus'],
    },
  },
});
