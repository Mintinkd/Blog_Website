import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://blog-website.pages.dev',
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    vue(),
    sitemap(),
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
