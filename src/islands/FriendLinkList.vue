<template>
  <div class="friend-links">
    <h3 class="links-title">友情链接</h3>
    <ul v-if="links.length > 0" class="links-list">
      <li v-for="link in links" :key="link.id" class="link-item">
        <a :href="link.url" target="_blank" rel="noopener noreferrer" class="link-url">
          {{ link.name }}
        </a>
      </li>
    </ul>
    <p v-else class="no-links">暂无友情链接</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const links = ref<any[]>([]);

onMounted(async () => {
  try {
    const response = await fetch('/api/v1/friend-links');
    const data = await response.json();
    if (data.code === 0 && data.data) {
      links.value = data.data;
    }
  } catch (e) {
    console.error('Load friend links failed:', e);
  }
});
</script>

<style scoped>
.friend-links {
  padding: 1rem;
  background-color: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
}

.links-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 0.75rem;
}

.links-list {
  list-style: none;
  padding: 0;
}

.link-item {
  padding: 0.4rem 0;
}

.link-url {
  color: var(--color-accent);
  font-size: 0.9rem;
}

.link-url:hover {
  color: var(--color-accent-hover);
  text-decoration: underline;
}

.no-links {
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}
</style>