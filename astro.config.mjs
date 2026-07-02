import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://blog-website.pages.dev',
  output: 'static',
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
