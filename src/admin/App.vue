<template>
  <div class="admin-app">
    <div v-if="!isLoggedIn" class="login-page">
      <div class="login-card">
        <div class="login-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          <h1>Blog Admin</h1>
        </div>
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="form-group">
            <label>{{ t('admin.username') }}</label>
            <input v-model="loginForm.username" type="text" :placeholder="t('admin.username')" required />
          </div>
          <div class="form-group">
            <label>{{ t('admin.password') }}</label>
            <input v-model="loginForm.password" type="password" :placeholder="t('admin.password')" required />
          </div>
          <p v-if="loginError" class="error-msg">{{ loginError }}</p>
          <button type="submit" class="login-btn" :disabled="loginLoading">
            {{ loginLoading ? t('admin.login_loading') : t('admin.login') }}
          </button>
        </form>
      </div>
    </div>

    <div v-else class="admin-layout">
      <aside class="admin-sidebar">
        <div class="sidebar-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          <span>Blog Admin</span>
        </div>
        <nav class="sidebar-nav">
          <button :class="['nav-item', { active: currentTab === 'articles' }]" @click="currentTab = 'articles'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            {{ t('admin.articles') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'categories' }]" @click="currentTab = 'categories'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            {{ t('admin.categories') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'tags' }]" @click="currentTab = 'tags'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>
            {{ t('admin.tags') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'about' }]" @click="currentTab = 'about'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            {{ t('admin.about_page') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'comments' }]" @click="currentTab = 'comments'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            {{ t('admin.comments') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'media' }]" @click="currentTab = 'media'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            {{ t('admin.media') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'config' }]" @click="currentTab = 'config'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            {{ t('admin.site_config') }}
          </button>
          <button :class="['nav-item', { active: currentTab === 'users' }]" @click="currentTab = 'users'">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            {{ t('admin.users') }}
          </button>
        </nav>
        <div class="sidebar-footer">
          <a href="/" class="nav-item">{{ t('admin.back_site') }}</a>
          <button class="nav-item" @click="handleLogout">{{ t('admin.logout') }}</button>
        </div>
      </aside>

      <main class="admin-main">
        <div v-if="currentTab === 'articles'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.articles') }}</h2>
            <button class="btn-primary" @click="showArticleEditor = true; editingArticle = null">{{ t('admin.new_article') }}</button>
          </div>
          <div v-if="articlesLoading" class="loading">{{ t('common.loading') }}</div>
          <table v-else class="data-table">
            <thead>
              <tr><th>{{ t('admin.title') }}</th><th>{{ t('admin.status') }}</th><th>{{ t('admin.category') }}</th><th>{{ t('article.views') }}</th><th>{{ t('admin.created_at') }}</th><th>{{ t('admin.actions') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in articles" :key="a.id">
                <td><a :href="`/articles/${a.slug}`" target="_blank">{{ a.title }}</a></td>
                <td><span :class="['status-badge', a.status]">{{ a.status === 'published' ? t('article.published') : t('article.draft') }}</span></td>
                <td>{{ a.category?.name || '-' }}</td>
                <td>{{ a.view_count }}</td>
                <td>{{ formatDate(a.created_at) }}</td>
                <td class="actions">
                  <button @click="editArticle(a)">{{ t('admin.edit') }}</button>
                  <button @click="deleteArticle(a.id)" class="btn-danger">{{ t('admin.delete') }}</button>
                </td>
              </tr>
              <tr v-if="articles.length === 0"><td colspan="6" class="empty">{{ t('article.no_articles') }}</td></tr>
            </tbody>
          </table>
        </div>

        <div v-if="currentTab === 'categories'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.categories') }}</h2>
            <button class="btn-primary" @click="showCategoryForm = true; categoryForm = { name: '', slug: '', description: '' }">{{ t('admin.new_category') }}</button>
          </div>
          <table class="data-table">
            <thead><tr><th>{{ t('admin.name') }}</th><th>{{ t('admin.slug') }}</th><th>{{ t('admin.article_count') }}</th><th>{{ t('admin.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in categories" :key="c.id">
                <td>{{ c.name }}</td>
                <td>{{ c.slug }}</td>
                <td>{{ c.article_count || 0 }}</td>
                <td class="actions">
                  <button @click="categoryForm = { name: c.name, slug: c.slug, description: c.description || '' }; editingCategoryId = c.id; showCategoryForm = true">{{ t('admin.edit') }}</button>
                  <button @click="deleteCategory(c.id)" class="btn-danger">{{ t('admin.delete') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="showCategoryForm" class="modal-overlay" @click.self="showCategoryForm = false">
            <div class="modal">
              <h3>{{ editingCategoryId ? t('admin.edit') + t('admin.categories') : t('admin.new_category') }}</h3>
              <div class="form-group"><label>{{ t('admin.name') }}</label><input v-model="categoryForm.name" /></div>
              <div class="form-group"><label>{{ t('admin.slug') }}</label><input v-model="categoryForm.slug" /></div>
              <div class="form-group"><label>{{ t('admin.description') }}</label><textarea v-model="categoryForm.description" rows="3"></textarea></div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showCategoryForm = false">{{ t('admin.cancel') }}</button>
                <button class="btn-primary" @click="saveCategory">{{ t('admin.save') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'tags'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.tags') }}</h2>
            <button class="btn-primary" @click="showTagForm = true; tagForm = { name: '', slug: '' }">{{ t('admin.new_tag') }}</button>
          </div>
          <table class="data-table">
            <thead><tr><th>{{ t('admin.name') }}</th><th>{{ t('admin.slug') }}</th><th>{{ t('admin.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="t in tags" :key="t.id">
                <td>{{ t.name }}</td>
                <td>{{ t.slug }}</td>
                <td class="actions"><button @click="deleteTag(t.id)" class="btn-danger">{{ t('admin.delete') }}</button></td>
              </tr>
            </tbody>
          </table>
          <div v-if="showTagForm" class="modal-overlay" @click.self="showTagForm = false">
            <div class="modal">
              <h3>{{ t('admin.new_tag') }}</h3>
              <div class="form-group"><label>{{ t('admin.name') }}</label><input v-model="tagForm.name" /></div>
              <div class="form-group"><label>{{ t('admin.slug') }}</label><input v-model="tagForm.slug" /></div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showTagForm = false">{{ t('admin.cancel') }}</button>
                <button class="btn-primary" @click="saveTag">{{ t('admin.save') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'about'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.about_page') }}</h2>
            <a href="/about" target="_blank" class="btn-secondary" style="font-size:0.8rem;padding:0.35rem 0.75rem;text-decoration:none;">{{ t('admin.preview_page') }}</a>
          </div>
          <div v-if="configLoading" class="loading">{{ t('common.loading') }}</div>
          <div v-else class="config-form">
            <p style="font-size:0.85rem;color:var(--color-text-tertiary);margin-bottom:1rem;">{{ t('admin.about_hint') }}</p>
            <div class="form-group">
              <label>关于页内容 (Markdown)</label>
              <textarea v-model="aboutContent" rows="20" class="editor-textarea"></textarea>
            </div>
            <button class="btn-primary" @click="saveAbout" :disabled="aboutSaving">{{ aboutSaving ? t('admin.save_loading') : t('admin.save') }}</button>
            <p v-if="aboutMsg" class="msg">{{ aboutMsg }}</p>
          </div>
        </div>

        <div v-if="currentTab === 'config'" class="admin-panel">
          <div class="panel-header"><h2>{{ t('admin.site_config') }}</h2></div>
          <div v-if="configLoading" class="loading">{{ t('common.loading') }}</div>
          <div v-else class="config-form">
            <div class="form-group"><label>{{ t('admin.site_title') }}</label><input v-model="configForm.site_title" /></div>
            <div class="form-group"><label>{{ t('admin.site_subtitle') }}</label><input v-model="configForm.site_subtitle" /></div>
            <div class="form-group"><label>{{ t('admin.site_description') }}</label><textarea v-model="configForm.site_description" rows="2"></textarea></div>

            <div class="form-group"><label>{{ t('admin.posts_per_page') }}</label><input v-model.number="configForm.posts_per_page" type="number" min="1" max="50" /></div>
            <button class="btn-primary" @click="saveConfig">{{ t('admin.save') }}</button>
            <p v-if="configMsg" class="msg">{{ configMsg }}</p>
          </div>
        </div>

        <div v-if="currentTab === 'comments'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.comments') }}</h2>
            <div style="display:flex;gap:0.5rem;">
              <button :class="['btn-secondary', { active: commentFilter === '' }]" style="font-size:0.8rem;padding:0.3rem 0.6rem;" @click="commentFilter = ''; loadComments()">{{ t('admin.all') }}</button>
              <button :class="['btn-secondary', { active: commentFilter === 'pending' }]" style="font-size:0.8rem;padding:0.3rem 0.6rem;" @click="commentFilter = 'pending'; loadComments()">{{ t('admin.pending') }}</button>
              <button :class="['btn-secondary', { active: commentFilter === 'approved' }]" style="font-size:0.8rem;padding:0.3rem 0.6rem;" @click="commentFilter = 'approved'; loadComments()">{{ t('admin.approved') }}</button>
            </div>
          </div>
          <table class="data-table">
            <thead><tr><th>{{ t('admin.nickname') }}</th><th>{{ t('admin.content') }}</th><th>{{ t('admin.articles') }}</th><th>{{ t('admin.status') }}</th><th>{{ t('admin.created_at') }}</th><th>{{ t('admin.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="c in comments" :key="c.id">
                <td>{{ c.nickname }}</td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ c.content }}</td>
                <td><a :href="`/articles/${c.article_slug || ''}`" target="_blank" style="font-size:0.8rem;">{{ c.article_title }}</a></td>
                <td><span :class="['status-badge', c.status]">{{ c.status === 'pending' ? t('admin.pending') : c.status === 'approved' ? t('admin.approved') : t('admin.rejected') }}</span></td>
                <td>{{ formatDate(c.created_at) }}</td>
                <td class="actions">
                  <button v-if="c.status === 'pending'" @click="approveComment(c.id)" style="color:var(--color-success);">{{ t('admin.approve') }}</button>
                  <button v-if="c.status === 'pending'" @click="rejectComment(c.id)" style="color:var(--color-warning);">{{ t('admin.reject') }}</button>
                  <button @click="deleteComment(c.id)" class="btn-danger">{{ t('admin.delete') }}</button>
                </td>
              </tr>
              <tr v-if="comments.length === 0"><td colspan="6" class="empty">{{ t('admin.no_comments') }}</td></tr>
            </tbody>
          </table>
        </div>

        <div v-if="currentTab === 'media'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.media') }}</h2>
            <label class="btn-primary" style="cursor:pointer;">
              {{ t('admin.upload') }}
              <input type="file" accept="image/*" @change="uploadMedia" style="display:none;" />
            </label>
          </div>
          <div v-if="mediaLoading" class="loading">{{ t('common.loading') }}</div>
          <div v-else class="media-grid">
            <div v-for="m in mediaList" :key="m.id" class="media-item">
              <img :src="m.url" :alt="m.original_name" class="media-thumb" />
              <div class="media-info">
                <span class="media-name">{{ m.original_name }}</span>
                <div class="media-actions-row">
                  <button class="btn-secondary" style="font-size:0.7rem;padding:0.2rem 0.5rem;" @click="copyMediaUrl(m.url)">{{ t('admin.copy_url') }}</button>
                  <button class="btn-danger" style="font-size:0.7rem;padding:0.2rem 0.5rem;" @click="deleteMedia(m.id)">{{ t('admin.delete') }}</button>
                </div>
              </div>
            </div>
          </div>
          <p v-if="mediaList.length === 0 && !mediaLoading" class="empty">{{ t('admin.no_media') }}</p>
        </div>

        <div v-if="currentTab === 'users'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t('admin.users') }}</h2>
            <button class="btn-primary" @click="showUserForm = true; userForm = { username: '', password: '', display_name: '', role: 'admin' }">{{ t('admin.new_user') }}</button>
          </div>
          <table class="data-table">
            <thead><tr><th>{{ t('admin.username') }}</th><th>{{ t('admin.display_name') }}</th><th>{{ t('admin.role') }}</th><th>{{ t('admin.created_at') }}</th><th>{{ t('admin.actions') }}</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>{{ u.username }}</td>
                <td>{{ u.display_name || '-' }}</td>
                <td><span :class="['status-badge', u.role]">{{ u.role === 'admin' ? t('admin.role_admin') : t('admin.role_editor') }}</span></td>
                <td>{{ formatDate(u.created_at) }}</td>
                <td class="actions">
                  <button @click="editingUserId = u.id; userForm = { username: u.username, password: '', display_name: u.display_name || '', role: u.role }; showUserForm = true">{{ t('admin.edit') }}</button>
                  <button @click="deleteUser(u.id)" class="btn-danger">{{ t('admin.delete') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="showUserForm" class="modal-overlay" @click.self="showUserForm = false">
            <div class="modal">
              <h3>{{ editingUserId ? t('admin.edit') + t('admin.users') : t('admin.new_user') }}</h3>
              <div class="form-group"><label>{{ t('admin.username') }}</label><input v-model="userForm.username" :disabled="!!editingUserId" /></div>
              <div class="form-group"><label>{{ t('admin.password') }}{{ editingUserId ? t('admin.password_hint') : '' }}</label><input v-model="userForm.password" type="password" :required="!editingUserId" /></div>
              <div class="form-group"><label>{{ t('admin.display_name') }}</label><input v-model="userForm.display_name" /></div>
              <div class="form-group"><label>{{ t('admin.role') }}</label>
                <select v-model="userForm.role">
                  <option value="admin">{{ t('admin.role_admin') }}</option>
                  <option value="editor">{{ t('admin.role_editor') }}</option>
                </select>
              </div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showUserForm = false">{{ t('admin.cancel') }}</button>
                <button class="btn-primary" @click="saveUser">{{ t('admin.save') }}</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showArticleEditor" class="article-editor-overlay">
          <div class="article-editor">
            <div class="editor-header">
              <h3>{{ editingArticle ? t('admin.edit') + t('admin.articles') : t('admin.new_article') }}</h3>
              <button @click="showArticleEditor = false" class="close-btn">&times;</button>
            </div>
            <div class="editor-body">
              <div class="form-group"><label>{{ t('admin.title') }}</label><input v-model="articleForm.title" /></div>
              <div class="form-group"><label>{{ t('admin.slug') }}</label><input v-model="articleForm.slug" /></div>
              <div class="form-row">
                <div class="form-group"><label>{{ t('admin.category') }}</label>
                  <select v-model="articleForm.category_id">
                    <option value="">{{ t('admin.no_category') }}</option>
                    <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </div>
                <div class="form-group"><label>{{ t('admin.status') }}</label>
                  <select v-model="articleForm.status">
                    <option value="draft">{{ t('article.draft') }}</option>
                    <option value="published">{{ t('article.published') }}</option>
                  </select>
                </div>
              </div>
              <div class="form-group"><label>{{ t('admin.summary') }}</label><textarea v-model="articleForm.summary" rows="2"></textarea></div>
              <div class="form-group">
                <div class="content-label-row">
                  <label>{{ t('admin.content') }} (Markdown)</label>
                  <div class="preview-toggle">
                    <button :class="['toggle-btn', { active: editorMode === 'edit' }]" @click="editorMode = 'edit'">{{ t('admin.edit_mode') }}</button>
                    <button :class="['toggle-btn', { active: editorMode === 'split' }]" @click="editorMode = 'split'">{{ t('admin.split_mode') }}</button>
                    <button :class="['toggle-btn', { active: editorMode === 'preview' }]" @click="editorMode = 'preview'">{{ t('admin.preview_mode') }}</button>
                  </div>
                </div>
                <div :class="['editor-content-area', editorMode]">
                  <textarea v-if="editorMode !== 'preview'" v-model="articleForm.content" rows="20" class="editor-textarea" @input="updatePreview"></textarea>
                  <div v-if="editorMode !== 'edit'" class="editor-preview prose" v-html="previewHtml"></div>
                </div>
              </div>
            </div>
            <div class="editor-footer">
              <button class="btn-secondary" @click="showArticleEditor = false">{{ t('admin.cancel') }}</button>
              <button class="btn-primary" @click="saveArticle" :disabled="articleSaving">{{ articleSaving ? t('admin.save_loading') : t('admin.save') }}</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { t, getLocale, setLocale, initLocale } from '../utils/i18n.ts';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

marked.setOptions({
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
});

function updatePreview() {
  if (!articleForm.value.content) {
    previewHtml.value = '';
    return;
  }
  try {
    const raw = marked.parse(articleForm.value.content) as string;
    previewHtml.value = DOMPurify.sanitize(raw);
  } catch {
    previewHtml.value = '';
  }
}

const API = '/api/v1';
const currentLocale = ref(initLocale());

const token = ref(localStorage.getItem('admin_token') || '');
const isLoggedIn = ref(!!token.value);
const currentTab = ref('articles');

const loginForm = ref({ username: '', password: '' });
const loginError = ref('');
const loginLoading = ref(false);

const articles = ref<any[]>([]);
const articlesLoading = ref(false);
const showArticleEditor = ref(false);
const editingArticle = ref<any>(null);
const articleForm = ref({ title: '', slug: '', summary: '', content: '', category_id: '', status: 'draft' });
const articleSaving = ref(false);
const editorMode = ref<'edit' | 'split' | 'preview'>('edit');
const previewHtml = ref('');

const categories = ref<any[]>([]);
const showCategoryForm = ref(false);
const categoryForm = ref({ name: '', slug: '', description: '' });
const editingCategoryId = ref<number | null>(null);

const tags = ref<any[]>([]);
const showTagForm = ref(false);
const tagForm = ref({ name: '', slug: '' });

const configForm = ref({ site_title: '', site_subtitle: '', site_description: '', posts_per_page: 10 });
const configLoading = ref(false);
const configMsg = ref('');

const aboutContent = ref('');
const aboutSaving = ref(false);
const aboutMsg = ref('');

const users = ref<any[]>([]);
const showUserForm = ref(false);
const userForm = ref({ username: '', password: '', display_name: '', role: 'admin' });
const editingUserId = ref<number | null>(null);

const comments = ref<any[]>([]);
const commentFilter = ref('');

const mediaList = ref<any[]>([]);
const mediaLoading = ref(false);

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token.value}` };
}

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (data.code === 10003) {
    token.value = '';
    localStorage.removeItem('admin_token');
    isLoggedIn.value = false;
  }
  return data;
}

async function handleLogin() {
  loginError.value = '';
  loginLoading.value = true;
  try {
    const data = await api('POST', '/auth/login', loginForm.value);
    if (data.code === 0 && data.data?.token) {
      token.value = data.data.token;
      localStorage.setItem('admin_token', data.data.token);
      isLoggedIn.value = true;
    } else {
      loginError.value = data.message || t('admin.login_error');
    }
  } catch (e) {
    loginError.value = t('admin.login_error');
  } finally {
    loginLoading.value = false;
  }
}

function handleLogout() {
  token.value = '';
  localStorage.removeItem('admin_token');
  isLoggedIn.value = false;
}

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString(getLocale() === 'zh' ? 'zh-CN' : 'en-US');
}

async function loadArticles() {
  articlesLoading.value = true;
  try {
    const data = await api('GET', '/articles?page_size=100&status=all');
    if (data.code === 0) articles.value = data.data?.items || [];
  } finally {
    articlesLoading.value = false;
  }
}

async function loadCategories() {
  const data = await api('GET', '/categories');
  if (data.code === 0) categories.value = data.data?.items || data.data || [];
}

async function loadTags() {
  const data = await api('GET', '/tags');
  if (data.code === 0) tags.value = data.data?.items || data.data || [];
}

async function loadConfig() {
  configLoading.value = true;
  try {
    const data = await api('GET', '/config/all');
    if (data.code === 0 && data.data) {
      configForm.value = {
        site_title: data.data.site_title || '',
        site_subtitle: data.data.site_subtitle || '',
        site_description: data.data.site_description || '',

        posts_per_page: parseInt(data.data.posts_per_page) || 10,
      };
      aboutContent.value = data.data.about_content || '';
    }
  } finally {
    configLoading.value = false;
  }
}

async function editArticle(a: any) {
  editingArticle.value = a;
  articleForm.value = {
    title: a.title,
    slug: a.slug,
    summary: a.summary || '',
    content: '',
    category_id: a.category?.id?.toString() || '',
    status: a.status || 'draft',
  };
  showArticleEditor.value = true;
  try {
    const detail = await api('GET', `/articles/${a.slug}`);
    if (detail.code === 0 && detail.data) {
      articleForm.value.content = detail.data.content || '';
      updatePreview();
    }
  } catch {}
}

async function saveArticle() {
  articleSaving.value = true;
  try {
    const body: any = { ...articleForm.value };
    delete body.tag_ids;
    if (!body.category_id) body.category_id = null;
    let data;
    if (editingArticle.value) {
      data = await api('PUT', `/articles/${editingArticle.value.id}`, body);
    } else {
      data = await api('POST', '/articles', body);
    }
    if (data.code === 0) {
      showArticleEditor.value = false;
      await loadArticles();
    } else {
      alert(data.message || t('admin.save_failed'));
    }
  } finally {
    articleSaving.value = false;
  }
}

async function deleteArticle(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/articles/${id}`);
  if (data.code === 0) await loadArticles();
  else alert(data.message || t('admin.delete_failed'));
}

async function saveCategory() {
  let data;
  if (editingCategoryId.value) {
    data = await api('PUT', `/categories/${editingCategoryId.value}`, categoryForm.value);
  } else {
    data = await api('POST', '/categories', categoryForm.value);
  }
  if (data.code === 0) {
    showCategoryForm.value = false;
    editingCategoryId.value = null;
    await loadCategories();
  } else {
    alert(data.message || t('admin.save_failed'));
  }
}

async function deleteCategory(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/categories/${id}`);
  if (data.code === 0) await loadCategories();
  else alert(data.message || t('admin.delete_failed'));
}

async function saveTag() {
  const data = await api('POST', '/tags', tagForm.value);
  if (data.code === 0) {
    showTagForm.value = false;
    await loadTags();
  } else {
    alert(data.message || t('admin.save_failed'));
  }
}

async function deleteTag(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/tags/${id}`);
  if (data.code === 0) await loadTags();
  else alert(data.message || t('admin.delete_failed'));
}

async function saveConfig() {
  configMsg.value = '';
  const data = await api('PUT', '/config', configForm.value);
  if (data.code === 0) configMsg.value = t('admin.save_success');
  else configMsg.value = data.message || t('admin.save_failed');
}

async function saveAbout() {
  aboutSaving.value = true;
  aboutMsg.value = '';
  try {
    const data = await api('PUT', '/config', { about_content: aboutContent.value });
    if (data.code === 0) aboutMsg.value = t('admin.save_success');
    else aboutMsg.value = data.message || t('admin.save_failed');
  } finally {
    aboutSaving.value = false;
  }
}

async function loadUsers() {
  const data = await api('GET', '/users');
  if (data.code === 0) users.value = data.data || [];
}

async function saveUser() {
  let data;
  if (editingUserId.value) {
    const body: any = { display_name: userForm.value.display_name, role: userForm.value.role };
    if (userForm.value.password) body.password = userForm.value.password;
    data = await api('PUT', `/users/${editingUserId.value}`, body);
  } else {
    if (!userForm.value.username || !userForm.value.password) {
      alert(t('admin.username_password_required'));
      return;
    }
    data = await api('POST', '/users', userForm.value);
  }
  if (data.code === 0) {
    showUserForm.value = false;
    editingUserId.value = null;
    await loadUsers();
  } else {
    alert(data.message || t('admin.save_failed'));
  }
}

async function deleteUser(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/users/${id}`);
  if (data.code === 0) await loadUsers();
  else alert(data.message || t('admin.delete_failed'));
}

async function loadComments() {
  const status = commentFilter.value ? `?status=${commentFilter.value}` : '';
  const data = await api('GET', `/comments${status}`);
  if (data.code === 0) comments.value = data.data || [];
}

async function approveComment(id: number) {
  const data = await api('PUT', `/comments/${id}/approve`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t('admin.save_failed'));
}

async function rejectComment(id: number) {
  const data = await api('PUT', `/comments/${id}/reject`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t('admin.save_failed'));
}

async function deleteComment(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/comments/${id}`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t('admin.delete_failed'));
}

async function loadMedia() {
  mediaLoading.value = true;
  try {
    const data = await api('GET', '/media');
    if (data.code === 0) mediaList.value = data.data?.items || [];
  } finally {
    mediaLoading.value = false;
  }
}

async function uploadMedia(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/v1/media/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token.value}` },
      body: formData,
    });
    const data = await res.json();
    if (data.code === 0) await loadMedia();
    else alert(data.message || t('admin.upload_failed'));
  } catch {
    alert(t('admin.upload_failed'));
  }
  input.value = '';
}

async function deleteMedia(id: number) {
  if (!confirm(t('admin.delete_confirm'))) return;
  const data = await api('DELETE', `/media/${id}`);
  if (data.code === 0) await loadMedia();
  else alert(data.message || t('admin.delete_failed'));
}

function copyMediaUrl(url: string) {
  const fullUrl = new URL(url, window.location.origin).href;
  navigator.clipboard.writeText(fullUrl);
  alert(t('admin.copied'));
}

watch(isLoggedIn, (v) => {
  if (v) {
    loadArticles();
    loadCategories();
    loadTags();
    loadUsers();
    loadComments();
    loadMedia();
  }
});

onMounted(() => {
  if (isLoggedIn.value) {
    loadArticles();
    loadCategories();
    loadTags();
    loadUsers();
    loadComments();
    loadMedia();
  }
});

watch(currentTab, (tab) => {
  if (tab === 'config' || tab === 'about') loadConfig();
  if (tab === 'users') loadUsers();
  if (tab === 'comments') loadComments();
  if (tab === 'media') loadMedia();
});
</script>

<style scoped>
.admin-app {
  min-height: 60vh;
}

.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.login-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 2.5rem;
  width: 100%;
  max-width: 380px;
}

.login-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  color: var(--color-accent);
}

.login-header h1 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.login-form .form-group {
  margin-bottom: 1rem;
}

.login-btn {
  width: 100%;
  padding: 0.65rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.login-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.login-btn:disabled {
  opacity: 0.6;
}

.error-msg {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.admin-layout {
  display: flex;
  gap: 1.5rem;
  min-height: 60vh;
}

.admin-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  height: fit-content;
  position: sticky;
  top: calc(var(--header-height) + 2rem);
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  color: var(--color-accent);
  font-weight: 700;
  font-size: 0.95rem;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 0.5rem;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: var(--radius-sm);
  text-decoration: none;
  width: 100%;
  text-align: left;
  transition: all 0.15s;
}

.nav-item:hover {
  background: var(--color-accent-subtle);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: var(--color-accent-light);
  color: var(--color-accent);
  font-weight: 500;
}

.sidebar-footer {
  margin-top: auto;
  padding: 0.75rem 0.5rem 0;
  border-top: 1px solid var(--color-border-light);
}

.admin-main {
  flex: 1;
  min-width: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.panel-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
}

.btn-primary {
  padding: 0.45rem 1rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
}

.btn-secondary {
  padding: 0.45rem 1rem;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-danger {
  color: var(--color-error);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.data-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  border-bottom: 2px solid var(--color-border);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.data-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-primary);
}

.data-table td a {
  color: var(--color-accent);
}

.status-badge {
  padding: 0.1rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
}

.status-badge.published {
  background: rgba(52, 199, 89, 0.1);
  color: var(--color-success);
}

.status-badge.draft {
  background: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
}

.status-badge.admin {
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-accent);
}

.status-badge.editor {
  background: rgba(255, 159, 10, 0.1);
  color: var(--color-warning);
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.actions button {
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.actions button:hover {
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.form-group {
  margin-bottom: 0.75rem;
}

.form-group label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 0.3rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: inherit;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group {
  flex: 1;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  width: 90%;
  max-width: 440px;
}

.modal h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

.article-editor-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-bg-primary);
  z-index: 300;
  display: flex;
  flex-direction: column;
}

.article-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-bg-secondary);
}

.editor-header h3 {
  font-size: 1rem;
  font-weight: 600;
}

.close-btn {
  font-size: 1.5rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  line-height: 1;
}

.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

.editor-textarea {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.6;
  min-height: 400px;
}

.content-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.3rem;
}

.content-label-row label {
  margin-bottom: 0;
}

.preview-toggle {
  display: flex;
  gap: 0.25rem;
}

.toggle-btn {
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s;
}

.toggle-btn:hover {
  color: var(--color-text-secondary);
  border-color: var(--color-accent);
}

.toggle-btn.active {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}

.editor-content-area {
  display: flex;
  gap: 1rem;
  min-height: 400px;
}

.editor-content-area .editor-textarea {
  flex: 1;
  min-height: 400px;
  resize: vertical;
}

.editor-content-area.split .editor-textarea {
  flex: 1;
  min-height: 400px;
}

.editor-content-area.split .editor-preview {
  flex: 1;
  overflow-y: auto;
}

.editor-content-area.edit .editor-preview {
  display: none;
}

.editor-content-area.preview .editor-textarea {
  display: none;
}

.editor-content-area.preview .editor-preview {
  flex: 1;
  overflow-y: auto;
}

.editor-preview {
  padding: 1rem;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-bg-primary);
  font-size: 0.9rem;
  line-height: 1.7;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-bg-secondary);
}

.config-form {
  max-width: 600px;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-tertiary);
}

.empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 1rem;
}

.msg {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-success);
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
}

.media-item {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.media-thumb {
  width: 100%;
  height: 140px;
  object-fit: cover;
  display: block;
}

.media-info {
  padding: 0.5rem;
}

.media-name {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 0.35rem;
}

.media-actions-row {
  display: flex;
  gap: 0.35rem;
}

.status-badge.pending {
  background: rgba(255, 159, 10, 0.1);
  color: var(--color-warning);
}

.status-badge.approved {
  background: rgba(52, 199, 89, 0.1);
  color: var(--color-success);
}

.status-badge.rejected {
  background: rgba(255, 59, 48, 0.1);
  color: var(--color-error);
}

@media (max-width: 767px) {
  .admin-layout {
    flex-direction: column;
  }
  .admin-sidebar {
    width: 100%;
    position: static;
  }
  .sidebar-nav {
    flex-direction: row;
    overflow-x: auto;
  }
  .sidebar-footer {
    border-top: none;
    padding-top: 0;
  }
}
</style>
