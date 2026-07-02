<template>
  <button class="like-btn" :class="{ liked: isLiked }" @click="toggleLike" :disabled="loading">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" :fill="isLiked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>
    <span class="like-count">{{ likeCount }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const props = defineProps<{ articleId: number; initialCount?: number }>();

const isLiked = ref(false);
const likeCount = ref(props.initialCount || 0);
const loading = ref(false);

onMounted(async () => {
  try {
    const response = await fetch(`/api/v1/articles/${props.articleId}/like-status`);
    const data = await response.json();
    if (data.code === 0 && data.data) {
      isLiked.value = data.data.liked;
    }
  } catch (e) {
    // silent fail
  }
});

async function toggleLike() {
  if (loading.value) return;
  loading.value = true;

  try {
    const response = await fetch(`/api/v1/articles/${props.articleId}/like`, {
      method: 'POST',
    });
    const data = await response.json();

    if (data.code === 0 && data.data) {
      isLiked.value = data.data.liked;
      likeCount.value += data.data.liked ? 1 : -1;
    }
  } catch (e) {
    console.error('Like toggle failed:', e);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.like-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  background-color: var(--color-bg-primary);
  font-size: 0.9rem;
  transition: all 0.2s;
  cursor: pointer;
}

.like-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.like-btn.liked {
  color: #ef4444;
  border-color: #ef4444;
}

.like-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.like-count {
  font-weight: 500;
}
</style>