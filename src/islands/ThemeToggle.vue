<template>
  <button class="theme-toggle" @click="toggleTheme" :title="themeLabel" :aria-label="themeLabel">
    <svg v-if="currentTheme === 'light'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>
    <svg v-else-if="currentTheme === 'dark'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

type Theme = 'light' | 'dark' | 'system';

const currentTheme = ref<Theme>('system');

const themeLabel = computed(() => {
  const labels: Record<Theme, string> = {
    light: '浅色模式',
    dark: '深色模式',
    system: '跟随系统',
  };
  return labels[currentTheme.value];
});

function toggleTheme() {
  const order: Theme[] = ['light', 'dark', 'system'];
  const nextIndex = (order.indexOf(currentTheme.value) + 1) % order.length;
  const next = order[nextIndex];
  currentTheme.value = next;
  localStorage.setItem('theme', next);
  applyTheme(next);
}

function applyTheme(theme: Theme) {
  const effective = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.setAttribute('data-theme', effective);
}

onMounted(() => {
  const stored = localStorage.getItem('theme') as Theme | null;
  currentTheme.value = stored || 'system';
  applyTheme(currentTheme.value);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme.value === 'system') {
      applyTheme('system');
    }
  });
});
</script>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  transition: background-color 0.2s, color 0.2s;
}

.theme-toggle:hover {
  background-color: var(--color-bg-secondary);
  color: var(--color-accent);
}
</style>