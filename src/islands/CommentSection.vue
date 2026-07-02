<template>
  <div class="comment-section">
    <h3 class="section-title">评论 ({{ comments.length }})</h3>

    <div v-if="comments.length > 0" class="comment-list">
      <div v-for="comment in comments" :key="comment.id" class="comment-item">
        <div class="comment-header">
          <span class="comment-nickname">{{ comment.nickname }}</span>
          <span class="comment-date">{{ formatDate(comment.created_at) }}</span>
        </div>
        <div class="comment-content">{{ comment.content }}</div>
      </div>
    </div>

    <div v-else class="no-comments">
      <p>暂无评论，来抢沙发吧！</p>
    </div>

    <form class="comment-form" @submit.prevent="submitComment">
      <div class="form-group">
        <input
          v-model="form.nickname"
          type="text"
          placeholder="昵称"
          class="form-input"
          maxlength="100"
          required
        />
      </div>
      <div class="form-group">
        <textarea
          v-model="form.content"
          placeholder="写下你的评论..."
          class="form-textarea"
          maxlength="1000"
          rows="4"
          required
        ></textarea>
      </div>
      <div v-if="submitMessage" class="submit-message" :class="{ success: submitSuccess, error: !submitSuccess }">
        {{ submitMessage }}
      </div>
      <button type="submit" class="submit-btn" :disabled="submitting">
        {{ submitting ? '提交中...' : '提交评论' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import DOMPurify from 'dompurify';

const props = defineProps<{ articleId: number }>();

const comments = ref<any[]>([]);
const form = ref({ nickname: '', content: '' });
const submitting = ref(false);
const submitMessage = ref('');
const submitSuccess = ref(false);

onMounted(() => {
  loadComments();
});

async function loadComments() {
  try {
    const response = await fetch(`/api/v1/articles/${props.articleId}/comments`);
    const data = await response.json();
    if (data.code === 0 && data.data) {
      comments.value = data.data.items || [];
    }
  } catch (e) {
    console.error('Load comments failed:', e);
  }
}

async function submitComment() {
  if (!form.value.nickname.trim() || !form.value.content.trim()) return;
  if (form.value.content.length > 1000) {
    submitMessage.value = '评论内容不能超过1000字';
    submitSuccess.value = false;
    return;
  }

  const sanitized = DOMPurify.sanitize(form.value.content);

  submitting.value = true;
  submitMessage.value = '';

  try {
    const response = await fetch(`/api/v1/articles/${props.articleId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: form.value.nickname.trim(),
        content: sanitized,
      }),
    });

    const data = await response.json();

    if (data.code === 0) {
      submitMessage.value = '评论已提交，等待审核';
      submitSuccess.value = true;
      form.value.content = '';
    } else if (data.code === 10007) {
      submitMessage.value = '评论太频繁，请稍后再试';
      submitSuccess.value = false;
    } else {
      submitMessage.value = data.message || '提交失败';
      submitSuccess.value = false;
    }
  } catch (e) {
    submitMessage.value = '网络错误，请重试';
    submitSuccess.value = false;
  } finally {
    submitting.value = false;
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-CN');
}
</script>

<style scoped>
.comment-section {
  margin-top: 3rem;
}

.section-title {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 1.5rem;
}

.comment-list {
  margin-bottom: 2rem;
}

.comment-item {
  padding: 1rem 0;
  border-bottom: 1px solid var(--color-border-light);
}

.comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.comment-nickname {
  font-weight: 500;
  color: var(--color-text-primary);
}

.comment-date {
  font-size: 0.8rem;
  color: var(--color-text-tertiary);
}

.comment-content {
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.no-comments {
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 1.5rem;
}

.comment-form {
  margin-top: 1.5rem;
}

.form-group {
  margin-bottom: 0.75rem;
}

.form-input, .form-textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus, .form-textarea:focus {
  border-color: var(--color-accent);
}

.form-textarea {
  resize: vertical;
  min-height: 100px;
}

.submit-message {
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
}

.submit-message.success {
  background-color: var(--color-accent-light);
  color: var(--color-success);
}

.submit-message.error {
  color: var(--color-error);
}

.submit-btn {
  padding: 0.6rem 1.5rem;
  background-color: var(--color-accent);
  color: #fff;
  border-radius: var(--radius-md);
  font-weight: 500;
  transition: background-color 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background-color: var(--color-accent-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
}
</style>