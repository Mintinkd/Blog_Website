<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">博客管理后台</h1>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" type="text" required autocomplete="username" />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" required autocomplete="current-password" />
        </div>
        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
        <button type="submit" class="login-btn" :disabled="loading">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMsg = ref('');

async function handleLogin() {
  loading.value = true;
  errorMsg.value = '';

  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });

    const data = await response.json();

    if (data.code === 0 && data.data?.token) {
      localStorage.setItem('auth_token', data.data.token);
      window.location.href = '/admin/dashboard';
    } else {
      errorMsg.value = data.message || '登录失败';
    }
  } catch (e) {
    errorMsg.value = '网络错误，请重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: var(--color-bg-secondary);
}

.login-card {
  background-color: var(--color-bg-primary);
  padding: 2.5rem;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  width: 100%;
  max-width: 400px;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 2rem;
  color: var(--color-text-primary);
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.form-group input {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.error-msg {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.login-btn {
  width: 100%;
  padding: 0.7rem;
  background-color: var(--color-accent);
  color: #fff;
  border-radius: var(--radius-md);
  font-size: 1rem;
  font-weight: 500;
  transition: background-color 0.2s;
}

.login-btn:hover:not(:disabled) {
  background-color: var(--color-accent-hover);
}

.login-btn:disabled {
  opacity: 0.6;
}
</style>