<template>
  <div class="admin-app">
    <div v-if="!isLoggedIn" class="login-page">
      <div class="login-card">
        <div class="login-header">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path
              d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
            ></path>
          </svg>
          <h1>Blog Admin</h1>
        </div>
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="form-group">
            <label>{{ t("admin.username") }}</label>
            <input
              v-model="loginForm.username"
              type="text"
              :placeholder="t('admin.username')"
              required
            />
          </div>
          <div class="form-group">
            <label>{{ t("admin.password") }}</label>
            <input
              v-model="loginForm.password"
              type="password"
              :placeholder="t('admin.password')"
              required
            />
          </div>
          <p v-if="loginError" class="error-msg">{{ loginError }}</p>
          <button type="submit" class="login-btn" :disabled="loginLoading">
            {{ loginLoading ? t("admin.login_loading") : t("admin.login") }}
          </button>
        </form>
      </div>
    </div>

    <div v-else class="admin-layout" :data-locale="currentLocale">
      <aside class="admin-sidebar">
        <div class="sidebar-header">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path
              d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
            ></path>
          </svg>
          <span>Blog Admin</span>
        </div>
        <nav class="sidebar-nav">
          <button
            v-for="item in visibleNavItems"
            :key="item.key"
            :class="['nav-item', { active: currentTab === item.key }]"
            @click="switchTab(item.key)"
          >
            <component :is="item.icon" />
            {{ item.label() }}
          </button>
        </nav>
        <div class="sidebar-footer">
          <a href="/" class="nav-item">{{ t("admin.back_site") }}</a>
          <button class="nav-item" @click="handleLogout">
            {{ t("admin.logout") }}
          </button>
        </div>
      </aside>

      <main class="admin-main">
        <ArticlesPanel
          v-if="currentTab === 'articles'"
          :articles="articles"
          :loading="articlesLoading"
          :author-filter="authorFilter"
          :users="users"
          :user-role="userRole"
          @new="openNewArticle"
          @edit="editArticle"
          @delete="deleteArticle"
          @update:author-filter="setAuthorFilter"
          @filter-change="loadArticles()"
        />

        <div v-if="currentTab === 'scrape'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.scrape") }}</h2>
          </div>
          <div class="scrape-form">
            <input
              v-model="scrapeUrl"
              type="url"
              :placeholder="t('admin.scrape_url_placeholder')"
              :disabled="scrapeLoading"
              @keydown.enter.prevent="runScrape"
            />
            <button
              class="btn-primary"
              :disabled="scrapeLoading"
              @click="runScrape"
            >
              {{
                scrapeLoading
                  ? t("admin.scrape_loading")
                  : t("admin.scrape_button")
              }}
            </button>
          </div>

          <div v-if="scrapeError" class="scrape-error">
            <p>{{ scrapeError }}</p>
            <button
              class="btn-secondary"
              :disabled="scrapeLoading"
              @click="runScrape"
            >
              {{ t("admin.scrape_retry") }}
            </button>
          </div>

          <div v-if="scrapePreview" class="scrape-preview">
            <h3>
              {{ scrapePreview.title || t("admin.scrape_no_title") }}
            </h3>
            <p v-if="scrapePreview.summary" class="scrape-summary">
              {{ scrapePreview.summary }}
            </p>
            <div
              v-if="scrapePreview.coverImage && !scrapeCoverFailed"
              class="scrape-cover"
            >
              <img
                :src="scrapePreview.coverImage"
                :alt="scrapePreview.title"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="scrapeCoverFailed = true"
              />
            </div>
            <p v-else class="scrape-hint">
              {{ t("admin.scrape_no_cover") }}
            </p>
            <p class="scrape-meta">
              {{ t("admin.scrape_final_url") }}:
              <a
                :href="scrapePreview.finalUrl"
                target="_blank"
                rel="noopener noreferrer"
                >{{ scrapePreview.finalUrl }}</a
              >
            </p>
            <p class="scrape-meta">
              {{
                t("admin.scrape_word_count", {
                  count: scrapePreview.wordCount,
                })
              }}
              ·
              {{
                t("admin.scrape_images", { count: scrapePreview.images.total })
              }}
              · {{ t("admin.scrape_charset") }}: {{ scrapePreview.charset }}
            </p>
            <p class="scrape-meta">
              {{ t("admin.scrape_tags") }}:
              {{
                scrapePreview.tags.length
                  ? scrapePreview.tags.join(", ")
                  : t("admin.scrape_no_tags")
              }}
              · {{ t("admin.scrape_category") }}: {{ scrapeCategoryName }} ·
              {{ t("admin.scrape_status") }}: {{ t("article.draft") }}
            </p>
            <p
              v-if="scrapePreview.images.unresolved > 0"
              class="scrape-warning"
            >
              {{
                t("admin.scrape_images_broken", {
                  count: scrapePreview.images.unresolved,
                })
              }}
            </p>
            <p v-else-if="scrapePreview.images.total > 0" class="scrape-hint">
              {{ t("admin.scrape_images_external") }}
            </p>
            <p
              v-if="scrapePreview.robotsStatus === 'unchecked'"
              class="scrape-warning"
            >
              {{ t("admin.scrape_robots_unchecked") }}
            </p>
            <p
              v-for="warning in scrapePreview.warnings"
              :key="warning"
              class="scrape-warning"
            >
              {{ scrapeWarningText(warning) }}
            </p>
            <div class="scrape-selector">
              <input
                v-model="scrapeSelector"
                type="text"
                :placeholder="t('admin.scrape_selector_placeholder')"
                :disabled="scrapeLoading"
                @keydown.enter.prevent="reextractScrape"
              />
              <button
                class="btn-secondary"
                :disabled="scrapeLoading"
                @click="reextractScrape"
              >
                {{ t("admin.scrape_selector_button") }}
              </button>
            </div>
            <p v-if="scrapeSelectorError" class="scrape-selector-error">
              {{ scrapeSelectorError }}
            </p>
            <div class="scrape-actions">
              <button
                class="btn-secondary"
                :disabled="scrapeLoading"
                @click="runScrape"
              >
                {{ t("admin.scrape_again") }}
              </button>
              <button
                class="btn-primary"
                :disabled="!scrapePreview.markdown.trim()"
                @click="editScrapedDraft"
              >
                {{ t("admin.scrape_generate_draft") }}
              </button>
            </div>
            <div class="content-label-row">
              <label>{{ t("admin.scrape_preview") }}</label>
              <div class="preview-toggle">
                <button
                  :class="[
                    'toggle-btn',
                    { active: scrapeViewMode === 'markdown' },
                  ]"
                  @click="scrapeViewMode = 'markdown'"
                >
                  {{ t("admin.scrape_markdown") }}
                </button>
                <button
                  :class="[
                    'toggle-btn',
                    { active: scrapeViewMode === 'rendered' },
                  ]"
                  @click="scrapeViewMode = 'rendered'"
                >
                  {{ t("admin.scrape_rendered") }}
                </button>
              </div>
            </div>
            <pre v-if="scrapeViewMode === 'markdown'" class="scrape-markdown">{{
              scrapePreview.markdown
            }}</pre>
            <div
              v-else
              class="scrape-rendered prose"
              v-html="scrapePreviewHtml"
            ></div>
          </div>
        </div>

        <div v-if="currentTab === 'categories'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.categories") }}</h2>
            <button
              class="btn-primary"
              @click="
                editingCategoryId = null;
                showCategoryForm = true;
                categoryForm = { name: '', slug: '', description: '' };
              "
            >
              {{ t("admin.new_category") }}
            </button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t("admin.name") }}</th>
                <th>{{ t("admin.slug") }}</th>
                <th>{{ t("admin.article_count") }}</th>
                <th>{{ t("admin.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in categories" :key="c.id">
                <td :data-label="t('admin.name')">{{ c.name }}</td>
                <td :data-label="t('admin.slug')">{{ c.slug }}</td>
                <td :data-label="t('admin.article_count')">
                  {{ c.article_count || 0 }}
                </td>
                <td class="actions" :data-label="t('admin.actions')">
                  <button
                    v-if="
                      userRole === 'admin' ||
                      !c.created_by ||
                      c.created_by === currentUserId
                    "
                    @click="
                      categoryForm = {
                        name: c.name,
                        slug: c.slug,
                        description: c.description || '',
                      };
                      editingCategoryId = c.id;
                      showCategoryForm = true;
                    "
                  >
                    {{ t("admin.edit") }}
                  </button>
                  <button
                    v-if="userRole === 'admin'"
                    @click="deleteCategory(c.id)"
                    class="btn-danger"
                  >
                    {{ t("admin.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="showCategoryForm"
            class="modal-overlay"
            @click.self="showCategoryForm = false"
          >
            <div class="modal">
              <h3>
                {{
                  editingCategoryId
                    ? t("admin.edit") + t("admin.categories")
                    : t("admin.new_category")
                }}
              </h3>
              <div class="form-group">
                <label>{{ t("admin.name") }}</label
                ><input v-model="categoryForm.name" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.slug") }}</label
                ><input v-model="categoryForm.slug" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.description") }}</label
                ><textarea
                  v-model="categoryForm.description"
                  rows="3"
                ></textarea>
              </div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showCategoryForm = false">
                  {{ t("admin.cancel") }}
                </button>
                <button class="btn-primary" @click="saveCategory">
                  {{ t("admin.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'tags'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.tags") }}</h2>
            <button
              class="btn-primary"
              @click="
                showTagForm = true;
                tagForm = { name: '', slug: '' };
              "
            >
              {{ t("admin.new_tag") }}
            </button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t("admin.name") }}</th>
                <th>{{ t("admin.slug") }}</th>
                <th>{{ t("admin.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in tags" :key="tag.id">
                <td :data-label="t('admin.name')">{{ tag.name }}</td>
                <td :data-label="t('admin.slug')">{{ tag.slug }}</td>
                <td class="actions" :data-label="t('admin.actions')">
                  <button
                    v-if="userRole === 'admin'"
                    @click="deleteTag(tag.id)"
                    class="btn-danger"
                  >
                    {{ t("admin.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="showTagForm"
            class="modal-overlay"
            @click.self="showTagForm = false"
          >
            <div class="modal">
              <h3>{{ t("admin.new_tag") }}</h3>
              <div class="form-group">
                <label>{{ t("admin.name") }}</label
                ><input v-model="tagForm.name" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.slug") }}</label
                ><input v-model="tagForm.slug" />
              </div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showTagForm = false">
                  {{ t("admin.cancel") }}
                </button>
                <button class="btn-primary" @click="saveTag">
                  {{ t("admin.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'about'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.about_page") }}</h2>
            <a
              href="/about"
              target="_blank"
              class="btn-secondary"
              style="
                font-size: 0.8rem;
                padding: 0.35rem 0.75rem;
                text-decoration: none;
              "
              >{{ t("admin.preview_page") }}</a
            >
          </div>
          <div v-if="configLoading" class="loading">
            {{ t("common.loading") }}
          </div>
          <div v-else class="config-form">
            <p
              style="
                font-size: 0.85rem;
                color: var(--color-text-tertiary);
                margin-bottom: 1rem;
              "
            >
              {{ t("admin.about_hint") }}
            </p>

            <!-- 个人名片：展示在 /about 页面顶部，与下方 Markdown 正文互不干扰 -->
            <div class="profile-editor">
              <div class="profile-editor-head">
                <h3>个人名片</h3>
                <span>展示在 /about 页面顶部；留空的字段前台会自动隐藏</span>
              </div>

              <div class="form-group">
                <label>头像</label>
                <div class="profile-avatar-row">
                  <div class="profile-avatar-preview">
                    <img
                      v-if="profileForm.avatar"
                      :src="profileForm.avatar"
                      alt="头像预览"
                    />
                    <span v-else class="profile-avatar-initial">?</span>
                  </div>
                  <div class="profile-avatar-actions">
                    <label class="btn-secondary profile-upload-btn">
                      {{
                        profileAvatarUploading
                          ? t("common.loading")
                          : t("admin.upload")
                      }}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                        :disabled="profileAvatarUploading"
                        @change="uploadProfileAvatar"
                        style="display: none"
                      />
                    </label>
                    <button
                      v-if="profileForm.avatar"
                      class="btn-secondary"
                      @click="profileForm.avatar = ''"
                    >
                      移除头像
                    </button>
                    <p class="profile-tip">
                      支持 PNG / JPG / GIF / WebP / SVG，≤
                      10MB。上传后需点「保存名片」才生效。
                    </p>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label>姓名</label>
                <input
                  v-model="profileForm.name"
                  maxlength="80"
                  placeholder="例如：老大 / Laoda"
                />
              </div>
              <div class="form-group">
                <label>职位 / 头衔</label>
                <input
                  v-model="profileForm.role"
                  maxlength="120"
                  placeholder="例如：独立开发者 · Indie Maker"
                />
              </div>
              <div class="form-group">
                <label>简介</label>
                <textarea
                  v-model="profileForm.bio"
                  rows="3"
                  maxlength="500"
                  placeholder="一句话介绍自己"
                ></textarea>
              </div>

              <div class="form-group">
                <label>社交联系方式</label>
                <div
                  v-for="(link, index) in profileForm.links"
                  :key="index"
                  class="profile-link-row"
                >
                  <input
                    v-model="link.label"
                    maxlength="30"
                    placeholder="名称"
                    class="profile-link-label"
                  />
                  <input
                    v-model="link.url"
                    maxlength="500"
                    placeholder="https://... / mailto:... / /rss.xml"
                    class="profile-link-url"
                  />
                  <button
                    class="btn-danger profile-link-remove"
                    @click="removeProfileLink(index)"
                  >
                    删除
                  </button>
                </div>
                <button
                  class="btn-secondary"
                  :disabled="profileForm.links.length >= 6"
                  @click="addProfileLink"
                >
                  + 添加链接
                </button>
                <p class="profile-tip">
                  最多 6 条；仅支持 http(s)://、mailto: 与站内 /
                  路径。名称或地址留空的行保存时自动忽略。
                </p>
              </div>

              <div class="profile-editor-actions">
                <button
                  class="btn-primary"
                  :disabled="profileSaving"
                  @click="saveProfile"
                >
                  {{ profileSaving ? t("admin.save_loading") : "保存名片" }}
                </button>
                <span v-if="profileMsg" class="msg">{{ profileMsg }}</span>
              </div>
            </div>

            <div class="profile-editor-divider"></div>

            <div class="form-group">
              <label>关于页内容 (Markdown)</label>
              <textarea
                v-model="aboutContent"
                rows="20"
                class="editor-textarea"
              ></textarea>
            </div>
            <button
              class="btn-primary"
              @click="saveAbout"
              :disabled="aboutSaving"
            >
              {{ aboutSaving ? t("admin.save_loading") : t("admin.save") }}
            </button>
            <p v-if="aboutMsg" class="msg">{{ aboutMsg }}</p>
          </div>
        </div>

        <div v-if="currentTab === 'config'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.site_config") }}</h2>
          </div>
          <div v-if="configLoading" class="loading">
            {{ t("common.loading") }}
          </div>
          <div v-else class="config-form">
            <div class="form-group">
              <label>{{ t("admin.site_title") }}</label
              ><input v-model="configForm.site_title" />
            </div>
            <div class="form-group">
              <label>{{ t("admin.site_subtitle") }}</label
              ><input v-model="configForm.site_subtitle" />
            </div>
            <div class="form-group">
              <label>{{ t("admin.site_description") }}</label
              ><textarea
                v-model="configForm.site_description"
                rows="2"
              ></textarea>
            </div>

            <div class="form-group">
              <label>{{ t("admin.posts_per_page") }}</label
              ><input
                v-model.number="configForm.posts_per_page"
                type="number"
                min="1"
                max="50"
              />
            </div>
            <button class="btn-primary" @click="saveConfig">
              {{ t("admin.save") }}
            </button>
            <p v-if="configMsg" class="msg">{{ configMsg }}</p>
          </div>
        </div>

        <div v-if="currentTab === 'comments'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.comments") }}</h2>
            <div style="display: flex; gap: 0.5rem">
              <button
                :class="['btn-secondary', { active: commentFilter === '' }]"
                style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
                @click="
                  commentFilter = '';
                  loadComments();
                "
              >
                {{ t("admin.all") }}
              </button>
              <button
                :class="[
                  'btn-secondary',
                  { active: commentFilter === 'pending' },
                ]"
                style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
                @click="
                  commentFilter = 'pending';
                  loadComments();
                "
              >
                {{ t("admin.pending") }}
              </button>
              <button
                :class="[
                  'btn-secondary',
                  { active: commentFilter === 'approved' },
                ]"
                style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
                @click="
                  commentFilter = 'approved';
                  loadComments();
                "
              >
                {{ t("admin.approved") }}
              </button>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t("admin.nickname") }}</th>
                <th>{{ t("admin.content") }}</th>
                <th>{{ t("admin.articles") }}</th>
                <th>{{ t("admin.status") }}</th>
                <th>{{ t("admin.created_at") }}</th>
                <th>{{ t("admin.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in comments" :key="c.id">
                <td :data-label="t('admin.nickname')">{{ c.nickname }}</td>
                <td class="cell-clip" :data-label="t('admin.content')">
                  {{ c.content }}
                </td>
                <td :data-label="t('admin.articles')">
                  <a
                    :href="`/articles/${c.article_slug || ''}`"
                    target="_blank"
                    style="font-size: 0.8rem"
                    >{{ c.article_title }}</a
                  >
                </td>
                <td :data-label="t('admin.status')">
                  <span :class="['status-badge', c.status]">{{
                    c.status === "pending"
                      ? t("admin.pending")
                      : c.status === "approved"
                        ? t("admin.approved")
                        : t("admin.rejected")
                  }}</span>
                </td>
                <td :data-label="t('admin.created_at')">
                  {{ formatDate(c.created_at) }}
                </td>
                <td class="actions" :data-label="t('admin.actions')">
                  <button
                    v-if="c.status === 'pending'"
                    @click="approveComment(c.id)"
                    style="color: var(--color-success)"
                  >
                    {{ t("admin.approve") }}
                  </button>
                  <button
                    v-if="c.status === 'pending'"
                    @click="rejectComment(c.id)"
                    style="color: var(--color-warning)"
                  >
                    {{ t("admin.reject") }}
                  </button>
                  <button @click="deleteComment(c.id)" class="btn-danger">
                    {{ t("admin.delete") }}
                  </button>
                </td>
              </tr>
              <tr v-if="comments.length === 0">
                <td colspan="6" class="empty">{{ t("admin.no_comments") }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="currentTab === 'media'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.media") }}</h2>
            <label class="btn-primary" style="cursor: pointer">
              {{ t("admin.upload") }}
              <input
                type="file"
                accept="image/*"
                @change="uploadMedia"
                style="display: none"
              />
            </label>
          </div>
          <div v-if="mediaLoading" class="loading">
            {{ t("common.loading") }}
          </div>
          <div v-else class="media-grid">
            <div v-for="m in mediaList" :key="m.id" class="media-item">
              <img :src="m.url" :alt="m.original_name" class="media-thumb" />
              <div class="media-info">
                <span class="media-name">{{ m.original_name }}</span>
                <div class="media-actions-row">
                  <button
                    class="btn-secondary"
                    style="font-size: 0.7rem; padding: 0.2rem 0.5rem"
                    @click="copyMediaUrl(m.url)"
                  >
                    {{ t("admin.copy_url") }}
                  </button>
                  <button
                    class="btn-danger"
                    style="font-size: 0.7rem; padding: 0.2rem 0.5rem"
                    @click="deleteMedia(m.id)"
                  >
                    {{ t("admin.delete") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p v-if="mediaList.length === 0 && !mediaLoading" class="empty">
            {{ t("admin.no_media") }}
          </p>
        </div>

        <div v-if="currentTab === 'users'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.users") }}</h2>
            <button
              class="btn-primary"
              @click="
                editingUserId = null;
                showUserForm = true;
                userForm = {
                  username: '',
                  password: '',
                  display_name: '',
                  role: 'admin',
                };
              "
            >
              {{ t("admin.new_user") }}
            </button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t("admin.username") }}</th>
                <th>{{ t("admin.display_name") }}</th>
                <th>{{ t("admin.role") }}</th>
                <th>{{ t("admin.created_at") }}</th>
                <th>{{ t("admin.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td :data-label="t('admin.username')">{{ u.username }}</td>
                <td :data-label="t('admin.display_name')">
                  {{ u.display_name || "-" }}
                </td>
                <td :data-label="t('admin.role')">
                  <span :class="['status-badge', u.role]">{{
                    u.role === "admin"
                      ? t("admin.role_admin")
                      : t("admin.role_editor")
                  }}</span>
                </td>
                <td :data-label="t('admin.created_at')">
                  {{ formatDate(u.created_at) }}
                </td>
                <td class="actions" :data-label="t('admin.actions')">
                  <button
                    @click="
                      editingUserId = u.id;
                      originalUserRole = u.role;
                      userForm = {
                        username: u.username,
                        password: '',
                        display_name: u.display_name || '',
                        role: u.role,
                      };
                      showUserForm = true;
                    "
                  >
                    {{ t("admin.edit") }}
                  </button>
                  <button @click="deleteUser(u.id)" class="btn-danger">
                    {{ t("admin.delete") }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="showUserForm"
            class="modal-overlay"
            @click.self="showUserForm = false"
          >
            <div class="modal">
              <h3>
                {{
                  editingUserId
                    ? t("admin.edit") + t("admin.users")
                    : t("admin.new_user")
                }}
              </h3>
              <div class="form-group">
                <label>{{ t("admin.username") }}</label
                ><input
                  v-model="userForm.username"
                  :disabled="!!editingUserId"
                />
              </div>
              <div class="form-group">
                <label
                  >{{ t("admin.password")
                  }}{{ editingUserId ? t("admin.password_hint") : "" }}</label
                ><input
                  v-model="userForm.password"
                  type="password"
                  :required="!editingUserId"
                />
              </div>
              <div class="form-group">
                <label>{{ t("admin.display_name") }}</label
                ><input v-model="userForm.display_name" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.role") }}</label>
                <select v-model="userForm.role">
                  <option value="admin">{{ t("admin.role_admin") }}</option>
                  <option value="editor">{{ t("admin.role_editor") }}</option>
                </select>
              </div>
              <div class="modal-actions">
                <button class="btn-secondary" @click="showUserForm = false">
                  {{ t("admin.cancel") }}
                </button>
                <button class="btn-primary" @click="saveUser">
                  {{ t("admin.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'friend_links'" class="admin-panel">
          <div class="panel-header">
            <h2>{{ t("admin.friend_links") }}</h2>
            <button
              class="btn-primary"
              @click="
                showFriendLinkForm = true;
                editingFriendLinkId = null;
                friendLinkForm = {
                  name: '',
                  url: '',
                  description: '',
                  sort_order: 0,
                  is_active: true,
                };
              "
            >
              {{ t("admin.new_friend_link") }}
            </button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t("admin.name") }}</th>
                <th>URL</th>
                <th>{{ t("admin.description") }}</th>
                <th>{{ t("admin.sort_order") }}</th>
                <th>{{ t("admin.status") }}</th>
                <th>{{ t("admin.actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="fl in safeFriendLinks" :key="fl.id">
                <td :data-label="t('admin.name')">{{ fl.name }}</td>
                <td :data-label="'URL'">
                  <a
                    v-if="fl.safe_url"
                    :href="fl.safe_url"
                    target="_blank"
                    style="font-size: 0.8rem"
                    >{{ fl.url }}</a
                  >
                  <span v-else style="font-size: 0.8rem">{{ fl.url }}</span>
                </td>
                <td :data-label="t('admin.description')">
                  {{ fl.description || "-" }}
                </td>
                <td :data-label="t('admin.sort_order')">{{ fl.sort_order }}</td>
                <td :data-label="t('admin.status')">
                  <span
                    :class="[
                      'status-badge',
                      fl.is_active ? 'published' : 'draft',
                    ]"
                    >{{
                      fl.is_active ? t("admin.active") : t("admin.inactive")
                    }}</span
                  >
                </td>
                <td class="actions" :data-label="t('admin.actions')">
                  <button
                    @click="
                      editingFriendLinkId = fl.id;
                      friendLinkForm = {
                        name: fl.name,
                        url: fl.url,
                        description: fl.description || '',
                        sort_order: fl.sort_order,
                        is_active: !!fl.is_active,
                      };
                      showFriendLinkForm = true;
                    "
                  >
                    {{ t("admin.edit") }}
                  </button>
                  <button @click="deleteFriendLink(fl.id)" class="btn-danger">
                    {{ t("admin.delete") }}
                  </button>
                </td>
              </tr>
              <tr v-if="friendLinks.length === 0">
                <td colspan="6" class="empty">
                  {{ t("admin.no_friend_links") }}
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="showFriendLinkForm"
            class="modal-overlay"
            @click.self="showFriendLinkForm = false"
          >
            <div class="modal">
              <h3>
                {{
                  editingFriendLinkId
                    ? t("admin.edit") + t("admin.friend_links")
                    : t("admin.new_friend_link")
                }}
              </h3>
              <div class="form-group">
                <label>{{ t("admin.name") }}</label
                ><input v-model="friendLinkForm.name" />
              </div>
              <div class="form-group">
                <label>URL</label><input v-model="friendLinkForm.url" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.description") }}</label
                ><input v-model="friendLinkForm.description" />
              </div>
              <div class="form-group">
                <label>{{ t("admin.sort_order") }}</label
                ><input
                  v-model.number="friendLinkForm.sort_order"
                  type="number"
                />
              </div>
              <div class="form-group">
                <label class="checkbox-label"
                  ><input type="checkbox" v-model="friendLinkForm.is_active" />
                  {{ t("admin.active") }}</label
                >
              </div>
              <div class="modal-actions">
                <button
                  class="btn-secondary"
                  @click="showFriendLinkForm = false"
                >
                  {{ t("admin.cancel") }}
                </button>
                <button class="btn-primary" @click="saveFriendLink">
                  {{ t("admin.save") }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'appearance'" class="admin-panel">
          <div class="panel-header">
            <h2>外观与个性化</h2>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
              <button class="btn-secondary" @click="exportSettingsFile">
                导出
              </button>
              <label class="btn-secondary" style="cursor: pointer">
                导入
                <input
                  type="file"
                  accept="application/json"
                  @change="importSettingsFile"
                  style="display: none"
                />
              </label>
              <button
                class="btn-secondary"
                style="color: var(--color-error)"
                @click="resetSettings"
              >
                恢复默认
              </button>
              <button
                class="btn-primary"
                @click="saveSettings"
                :disabled="settingsSaving"
              >
                {{ settingsSaving ? t("admin.save_loading") : t("admin.save") }}
              </button>
            </div>
          </div>
          <div v-if="settingsLoading" class="loading">
            {{ t("common.loading") }}
          </div>
          <div v-else class="config-form appearance-form">
            <section class="setting-section">
              <h3>主题与配色</h3>
              <div
                class="theme-group"
                v-for="themeKey in ['light', 'dark']"
                :key="themeKey"
              >
                <h4>{{ themeKey === "light" ? "浅色模式" : "深色模式" }}</h4>
                <div class="color-grid">
                  <div
                    class="color-field"
                    v-for="cf in colorFields"
                    :key="cf.key"
                  >
                    <label>{{ cf.label }}</label>
                    <div class="color-input-row">
                      <input
                        type="color"
                        v-model="settings.theme[themeKey][cf.key]"
                        @input="previewSettings"
                      />
                      <input
                        type="text"
                        class="color-hex"
                        v-model="settings.theme[themeKey][cf.key]"
                        @input="previewSettings"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="setting-section">
              <h3>布局</h3>
              <div class="form-row">
                <div class="form-group">
                  <label>内容最大宽度</label
                  ><input
                    v-model="settings.layout.contentMaxWidth"
                    @input="previewSettings"
                    placeholder="1200px"
                  />
                </div>
                <div class="form-group">
                  <label>顶栏高度</label
                  ><input
                    v-model="settings.layout.headerHeight"
                    @input="previewSettings"
                    placeholder="64px"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>圆角(小)</label
                  ><input
                    v-model="settings.layout.radiusSm"
                    @input="previewSettings"
                    placeholder="6px"
                  />
                </div>
                <div class="form-group">
                  <label>圆角(中)</label
                  ><input
                    v-model="settings.layout.radiusMd"
                    @input="previewSettings"
                    placeholder="10px"
                  />
                </div>
                <div class="form-group">
                  <label>圆角(大)</label
                  ><input
                    v-model="settings.layout.radiusLg"
                    @input="previewSettings"
                    placeholder="16px"
                  />
                </div>
              </div>
            </section>

            <section class="setting-section">
              <h3>背景</h3>
              <div class="form-group">
                <label>背景图路径 (URL，留空用默认)</label
                ><input
                  v-model="settings.background.bgImage"
                  @input="previewSettings"
                  placeholder="/bg-placeholder.svg"
                />
              </div>
              <div class="form-group">
                <label>背景图片强度：{{ settings.background.bgOpacity }}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  v-model.number="settings.background.bgOpacity"
                  @input="previewSettings"
                />
              </div>
              <p class="hint">
                数值越高，背景图片越清晰、蒙版越淡；建议 0.3~0.7
                平衡可读性与图片可见度。
              </p>
              <div class="form-group">
                <label>背景雾化强度：{{ settings.background.bgBlur }}px</label>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  v-model.number="settings.background.bgBlur"
                  @input="previewSettings"
                />
              </div>
              <p class="hint">
                数值越高背景越模糊（0
                为不模糊）。轻度雾化可显著提升前景文字可读性，建议 4~10。
              </p>
              <div class="form-group">
                <label>背景亮度：{{ settings.background.bgBrightness }}</label>
                <input
                  type="range"
                  min="0.7"
                  max="1.3"
                  step="0.01"
                  v-model.number="settings.background.bgBrightness"
                  @input="previewSettings"
                />
              </div>
              <p class="hint">
                低于 1 可压暗过亮的背景图（暗色主题更舒适），高于 1 提亮。
              </p>
            </section>

            <section class="setting-section">
              <h3>动效</h3>
              <div class="form-row">
                <div class="form-group">
                  <label>动效强度</label>
                  <select
                    v-model="settings.motion.intensity"
                    @change="previewSettings"
                  >
                    <option value="normal">标准（全部动效）</option>
                    <option value="reduced">减弱（仅轻量入场与进度条）</option>
                    <option value="off">关闭（无动效）</option>
                  </select>
                </div>
              </div>
              <div class="toggle-grid">
                <label class="toggle-item">
                  <input
                    type="checkbox"
                    v-model="settings.motion.parallax"
                    @change="previewSettings"
                  />
                  <span>启用背景视差</span>
                </label>
              </div>
              <div class="form-group">
                <label>视差速度：{{ settings.motion.parallaxSpeed }}</label>
                <input
                  type="range"
                  min="0"
                  max="0.1"
                  step="0.005"
                  v-model.number="settings.motion.parallaxSpeed"
                  @input="previewSettings"
                  :disabled="!settings.motion.parallax"
                />
              </div>
              <p class="hint">
                背景视差为极轻微滚动位移，增强沉浸感且不干扰阅读；在任意主题与语言下均生效。
              </p>
            </section>

            <section class="setting-section">
              <h3>功能开关</h3>
              <div class="toggle-grid">
                <label
                  class="toggle-item"
                  v-for="ft in featureList"
                  :key="ft.key"
                >
                  <input
                    type="checkbox"
                    v-model="settings.features[ft.key]"
                    @change="previewSettings"
                  />
                  <span>{{ ft.label }}</span>
                </label>
              </div>
            </section>

            <section class="setting-section">
              <h3>文案覆盖</h3>
              <p class="hint">
                覆盖界面文案（随当前语言生效），留空使用默认文案。
              </p>
              <div class="copy-row head">
                <span>键 (key)</span><span>中文 (zh)</span><span>英文 (en)</span
                ><span></span>
              </div>
              <div class="copy-row" v-for="key in copyKeys" :key="key">
                <input
                  :list="'i18n-keys'"
                  :value="key"
                  @input="
                    renameCopyKey(
                      key,
                      ($event.target as HTMLInputElement).value
                    )
                  "
                  placeholder="如 nav.home"
                />
                <input
                  v-model="settings.copy.zh[key]"
                  @input="previewSettings"
                />
                <input
                  v-model="settings.copy.en[key]"
                  @input="previewSettings"
                />
                <button class="btn-danger" @click="removeCopyKey(key)">
                  ×
                </button>
              </div>
              <div class="copy-row">
                <input
                  :list="'i18n-keys'"
                  v-model="newCopyKey"
                  placeholder="新增键名，如 nav.home"
                />
                <input v-model="newCopyZh" placeholder="中文" />
                <input v-model="newCopyEn" placeholder="English" />
                <button class="btn-primary" @click="addCopyKey">+</button>
              </div>
              <datalist id="i18n-keys">
                <option v-for="k in i18nKeys" :key="k" :value="k"></option>
              </datalist>
            </section>

            <p v-if="settingsMsg" class="msg">{{ settingsMsg }}</p>
          </div>
        </div>

        <!-- 阅读统计（issue #58）：Tier 0 概览 / 趋势 / 文章表 / 分布 / 质量 -->
        <div
          v-if="currentTab === 'analytics'"
          class="admin-panel analytics-panel"
        >
          <div class="panel-header analytics-header">
            <h2>{{ t("analytics.title") }}</h2>
            <div class="analytics-filters">
              <label>
                {{ t("analytics.range") }}
                <select v-model="analyticsRange" @change="loadAnalytics()">
                  <option value="today">
                    {{ t("analytics.range_today") }}
                  </option>
                  <option value="7d">{{ t("analytics.range_7d") }}</option>
                  <option value="30d">{{ t("analytics.range_30d") }}</option>
                  <option value="90d">{{ t("analytics.range_90d") }}</option>
                </select>
              </label>
              <label>
                {{ t("analytics.article_filter") }}
                <input
                  v-model="analyticsArticleQuery"
                  list="analytics-article-options"
                  :placeholder="t('analytics.article_all')"
                  @change="applyAnalyticsArticleFilter"
                />
                <datalist id="analytics-article-options">
                  <option
                    v-for="option in analyticsArticleOptions"
                    :key="option.id"
                    :value="option.title"
                  ></option>
                </datalist>
              </label>
              <span class="analytics-updated">{{
                t("analytics.updated_at", { time: analyticsUpdatedAt })
              }}</span>
            </div>
          </div>

          <div v-if="analyticsLoading" class="loading">
            {{ t("analytics.loading") }}
          </div>
          <div v-else-if="analyticsError" class="error-msg">
            {{ t("analytics.error") }}
            <small v-if="analyticsErrorDetail" class="analytics-error-detail">
              {{ analyticsErrorDetail }}
            </small>
            <button class="btn-secondary" @click="loadAnalytics()">
              {{ t("analytics.retry") }}
            </button>
          </div>
          <div v-else class="analytics-body">
            <!-- §7.2：Tier 0 仅 3 张卡；Tier 1 卡片完全不渲染 -->
            <div class="analytics-cards">
              <div
                v-for="card in analyticsCards"
                :key="card.key"
                class="analytics-card"
              >
                <span class="analytics-card-label">{{ card.label }}</span>
                <strong class="analytics-card-value">{{ card.value }}</strong>
              </div>
            </div>

            <!-- §7.3：PV / UV 双线，手写 SVG -->
            <section class="analytics-section">
              <h3>{{ t("analytics.trend_title") }}</h3>
              <div v-if="!analyticsTrendReady" class="empty">
                {{ t("analytics.trend_pending") }}
              </div>
              <template v-else>
                <svg
                  class="analytics-trend"
                  viewBox="0 0 600 160"
                  preserveAspectRatio="none"
                >
                  <path
                    :d="analyticsTrendPaths.pvPath"
                    fill="none"
                    stroke="#d64545"
                    stroke-width="2"
                  />
                  <path
                    :d="analyticsTrendPaths.uvPath"
                    fill="none"
                    stroke="#3b7ddd"
                    stroke-width="2"
                  />
                  <circle
                    v-for="point in analyticsTrendPaths.points"
                    :key="point.day"
                    :cx="point.x"
                    :cy="point.yPv"
                    r="3"
                    fill="#d64545"
                  >
                    <title>
                      {{ point.day }} · {{ t("analytics.trend_pv") }}
                      {{ point.pv }} · {{ t("analytics.trend_uv") }}
                      {{ point.uv }} ·
                      {{
                        t("analytics.trend_bot", { count: point.bot_filtered })
                      }}
                    </title>
                  </circle>
                </svg>
                <div class="analytics-legend">
                  <span
                    ><i class="analytics-dot analytics-dot-pv"></i
                    >{{ t("analytics.trend_pv") }}</span
                  >
                  <span
                    ><i class="analytics-dot analytics-dot-uv"></i
                    >{{ t("analytics.trend_uv") }}</span
                  >
                </div>
              </template>
            </section>

            <!-- §7.4：文章表；Tier 1 两列完全不渲染 -->
            <section class="analytics-section">
              <h3>
                {{ t("analytics.articles_title") }}
                <small v-if="analyticsArticlesData?.since"
                  >{{
                    t("analytics.table_since", {
                      day: analyticsArticlesData.since,
                    })
                  }}
                </small>
              </h3>
              <table class="analytics-table">
                <thead>
                  <tr>
                    <th>{{ t("analytics.table_title") }}</th>
                    <th>{{ t("analytics.table_pv") }}</th>
                    <th>{{ t("analytics.table_uv") }}</th>
                    <th>{{ t("analytics.table_referrer") }}</th>
                    <th>{{ t("analytics.table_sparkline") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in analyticsArticlesData?.items || []"
                    :key="row.id"
                  >
                    <td>
                      <a
                        :href="'/articles/' + encodeURIComponent(row.slug)"
                        target="_blank"
                        rel="noopener"
                        >{{ row.title }}</a
                      >
                    </td>
                    <td>{{ row.pv }}</td>
                    <td>{{ row.uv }}</td>
                    <td>
                      {{ row.top_referrer ?? t("analytics.no_data") }}
                    </td>
                    <td>
                      <svg
                        v-if="row.sparkline?.filter((v) => v > 0).length >= 2"
                        class="analytics-spark"
                        viewBox="0 0 80 24"
                        preserveAspectRatio="none"
                      >
                        <path
                          :d="buildSparklinePath(row.sparkline)"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.5"
                        />
                      </svg>
                      <span v-else>{{ t("analytics.no_data") }}</span>
                    </td>
                  </tr>
                  <tr v-if="!analyticsArticlesData?.items?.length">
                    <td colspan="5" class="empty">
                      {{ t("analytics.table_empty") }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="analytics-pager">
                <button
                  class="btn-secondary"
                  :disabled="analyticsPage <= 1"
                  @click="
                    analyticsPage--;
                    loadAnalytics();
                  "
                >
                  {{ t("analytics.prev") }}
                </button>
                <span>{{
                  t("analytics.table_page", {
                    page: analyticsPage,
                    pages: analyticsArticlesData?.total_pages || 1,
                  })
                }}</span>
                <button
                  class="btn-secondary"
                  :disabled="
                    analyticsPage >= (analyticsArticlesData?.total_pages || 1)
                  "
                  @click="
                    analyticsPage++;
                    loadAnalytics();
                  "
                >
                  {{ t("analytics.next") }}
                </button>
              </div>
            </section>

            <!-- §7.5：设备 / 地区条形图 + 来源表；Tier 1 图完全不渲染 -->
            <section class="analytics-section">
              <h3>{{ t("analytics.dim_title") }}</h3>
              <div class="analytics-dims">
                <div
                  v-for="dim in analyticsDimensionViews"
                  :key="dim.key"
                  class="analytics-dim"
                >
                  <h4>{{ dim.label }}</h4>
                  <div v-if="dim.view.insufficient" class="empty">
                    {{ t("analytics.dim_insufficient") }}
                  </div>
                  <div v-else-if="dim.view.rows.length === 0" class="empty">
                    {{ t("analytics.no_data") }}
                  </div>
                  <div
                    v-else-if="dim.key !== 'referrer'"
                    class="analytics-bars"
                  >
                    <div
                      v-for="row in dim.view.rows"
                      :key="row.label"
                      class="analytics-bar-row"
                    >
                      <span class="analytics-bar-label">{{ row.label }}</span>
                      <div class="analytics-bar-track">
                        <div
                          class="analytics-bar-fill"
                          :style="{ width: row.percent }"
                        ></div>
                      </div>
                      <span>{{ row.count }} · {{ row.percent }}</span>
                    </div>
                  </div>
                  <table v-else class="analytics-table">
                    <thead>
                      <tr>
                        <th>{{ t("analytics.dim_bucket") }}</th>
                        <th>{{ t("analytics.dim_count") }}</th>
                        <th>{{ t("analytics.dim_percent") }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in dim.view.rows" :key="row.label">
                        <td>{{ row.label }}</td>
                        <td>{{ row.count }}</td>
                        <td>{{ row.percent }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <!-- §7.6：数据质量 -->
            <section class="analytics-section">
              <h3>{{ t("analytics.quality_title") }}</h3>
              <div class="analytics-quality">
                <div
                  v-for="row in analyticsQualityRows"
                  :key="row.key"
                  :class="[
                    'analytics-quality-row',
                    { alert: row.alert, critical: row.critical },
                  ]"
                >
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                  <span v-if="row.alert" class="analytics-alert-tag">{{
                    t("analytics.quality_alert")
                  }}</span>
                </div>
              </div>
              <!-- §4.1：规则改动时同步的解释文案，说明免费版守卫分支 -->
              <p class="analytics-bot-hint">{{ t("analytics.bot_hint") }}</p>
            </section>
          </div>
        </div>

        <ArticleEditorOverlay
          v-if="isEditorOpen(editorState)"
          :state="editorState"
          :conflict="editorConflict"
          :categories="categories"
          :tags="tags"
          :user-role="userRole"
          @update-form="onEditorForm"
          @save="onEditorSave"
          @close="onEditorClose"
          @retry="onEditorRetry"
          @takeover="onEditorTakeover"
          @discard="onEditorDiscard"
          @continue="onEditorContinue"
          @open-link="onEditorOpenLink"
          @close-dialog="onEditorCloseDialog"
          @add-tag="addEditorTag"
          @keep-draft="onEditorKeepDraft"
        />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import "./admin-shared.css";
import ArticlesPanel from "./articles/ArticlesPanel.vue";
import ArticleEditorOverlay from "./articles/ArticleEditorOverlay.vue";
import {
  createArticleEditor,
  type ArticleEditorCore,
} from "./editor/useArticleEditor.ts";
import { createEditLock, type LockConflict } from "./editor/useEditLock.ts";
import {
  initialEditorState,
  isEditorOpen,
  type EditorFormSnapshot,
  type EditorState,
} from "../utils/editor/editorState";
import { clearUserDrafts } from "../utils/editor/draftStore";
import {
  ref,
  reactive,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  shallowRef,
  nextTick,
  h,
  defineComponent,
} from "vue";
import { t, getLocale, setLocale, initLocale } from "../utils/i18n.ts";
import {
  applySettings,
  getDefaultSettings,
  broadcastSettingsChange,
} from "../utils/settings.ts";
import zh from "../i18n/zh.json";
import { renderMarkdown } from "../utils/markdown";
import type { ScrapeDraft, ScrapeWarning } from "../utils/scrape";
import { safeFriendLinkUrl } from "../utils/friend-link-url";
import { toConfigPayload } from "../utils/config-payload";
import {
  TIER0_CARDS,
  TIER0_DIMENSIONS,
  buildSparklinePath,
  buildTrendPaths,
  dimensionRows,
  formatAnalyticsFailures,
  formatMetric,
  formatRatio,
  hasAnalyticsData,
  hasEnoughTrendDays,
  type AnalyticsFailure,
  type DimensionData,
  type TrendDay,
} from "../utils/analyticsView.ts";

const API = "/api/v1";

// 编辑器编排器延迟赋值：api() 的 10003 分支需要先落盘草稿再退出登录。
let editorCore: ArticleEditorCore | null = null;
const currentLocale = ref(initLocale());

const token = ref(localStorage.getItem("admin_token") || "");
const userRole = ref(localStorage.getItem("admin_role") || "editor");
const currentUserId = ref(Number(localStorage.getItem("admin_user_id")) || 0);
const isLoggedIn = ref(!!token.value);
const currentTab = ref("articles");

/* ── 阅读统计面板（issue #58 / docs/READER_ANALYTICS.md §7） ─────────────── */
const analyticsRange = ref("7d");
const analyticsArticleQuery = ref("");
const analyticsArticleId = ref("");
const analyticsPage = ref(1);
const analyticsLoading = ref(false);
const analyticsError = ref(false);
/** 失败接口 / code / 服务端消息，错误态里一并展示（2026-11-11 可诊断性加固） */
const analyticsErrorDetail = ref("");
const analyticsUpdatedAt = ref("—");
const analyticsOverview = ref<any>(null);
const analyticsTrend = ref<TrendDay[]>([]);
const analyticsArticlesData = ref<any>(null);
const analyticsQuality = ref<any>(null);
const analyticsDimensions = ref<Record<string, DimensionData | null>>({
  device: null,
  country: null,
  referrer: null,
});
const analyticsArticleOptions = ref<Array<{ id: number; title: string }>>([]);

const analyticsCards = computed(() => {
  // t() 读模块级 locale，显式依赖以便切语言时 computed 重新求值（不重挂载、不丢状态）
  void currentLocale.value;
  const overview = analyticsOverview.value;
  const empty = !hasAnalyticsData(overview);
  const values: Record<string, string> = {
    pv: empty ? formatMetric(null) : formatMetric(overview?.pv ?? null),
    uv: empty ? formatMetric(null) : formatMetric(overview?.uv ?? null),
    bot_filtered: formatMetric(overview?.bot_filtered ?? 0),
  };
  const labels: Record<string, string> = {
    pv: t("analytics.pv"),
    uv: t("analytics.uv"),
    bot_filtered: t("analytics.bot_filtered"),
  };
  // Tier 1 卡片不在清单里，关闭时完全不渲染
  return TIER0_CARDS.map((key) => ({
    key,
    label: labels[key],
    value: values[key],
  }));
});

const analyticsTrendPaths = computed(() =>
  buildTrendPaths(analyticsTrend.value, 600, 160)
);
const analyticsTrendReady = computed(() =>
  hasEnoughTrendDays(analyticsTrend.value)
);

const analyticsDimensionViews = computed(() => {
  void currentLocale.value;
  return TIER0_DIMENSIONS.map((dim) => ({
    key: dim,
    label: t(`analytics.dim_${dim}`),
    view: dimensionRows(
      analyticsDimensions.value[dim] ?? null,
      t,
      dim,
      currentLocale.value
    ),
  }));
});

const analyticsQualityRows = computed(() => {
  void currentLocale.value;
  const quality = analyticsQuality.value;
  return [
    {
      key: "bot_ratio",
      label: t("analytics.quality_bot_ratio"),
      value: formatRatio(quality?.bot_ratio ?? null),
      alert: !!quality?.bot_ratio_alert,
    },
    {
      key: "coverage",
      label: t("analytics.quality_coverage"),
      value: formatRatio(quality?.proxy_coverage ?? null),
      alert: !!quality?.proxy_coverage_alert,
    },
    {
      key: "heartbeat",
      label: t("analytics.quality_heartbeat"),
      value: quality?.heartbeat_at ?? t("analytics.quality_heartbeat_missing"),
      alert: !!quality?.heartbeat_alert,
      // §7.6：心跳超 26h 标红，其余告警标黄
      critical: !!quality?.heartbeat_alert,
    },
    {
      key: "anomaly",
      label: t("analytics.quality_anomaly"),
      value: quality?.anomaly
        ? t("analytics.quality_anomaly_hint")
        : t("analytics.quality_ok"),
      alert: !!quality?.anomaly,
    },
    {
      key: "tokens",
      label: t("analytics.quality_tokens"),
      value: formatMetric(quality?.token_rows ?? 0),
      alert: !!quality?.token_rows_alert,
    },
  ];
});

async function loadAnalytics() {
  if (userRole.value !== "admin") return;
  analyticsLoading.value = true;
  analyticsError.value = false;
  analyticsErrorDetail.value = "";
  const range = analyticsRange.value;
  const articleQuery = analyticsArticleId.value
    ? `&article_id=${encodeURIComponent(analyticsArticleId.value)}`
    : "";
  const base = "/admin/analytics";
  try {
    const [
      overview,
      trend,
      articles,
      quality,
      device,
      country,
      referrer,
      list,
    ] = await Promise.all([
      api("GET", `${base}/overview?range=${range}`),
      api("GET", `${base}/trend?range=${range}`),
      api("GET", `${base}/articles?range=${range}&page=${analyticsPage.value}`),
      api("GET", `${base}/quality?range=${range}`),
      api("GET", `${base}/dimensions?dim=device&range=${range}${articleQuery}`),
      api(
        "GET",
        `${base}/dimensions?dim=country&range=${range}${articleQuery}`
      ),
      api(
        "GET",
        `${base}/dimensions?dim=referrer&range=${range}${articleQuery}`
      ),
      api("GET", "/articles?page_size=50"),
    ]);
    const checks = [
      { name: "overview", res: overview },
      { name: "trend", res: trend },
      { name: "articles", res: articles },
      { name: "quality", res: quality },
      { name: "device", res: device },
      { name: "country", res: country },
      { name: "referrer", res: referrer },
      { name: "articles_list", res: list },
    ];
    const failures: AnalyticsFailure[] = checks
      .filter((item) => item.res?.code !== 0)
      .map((item) => ({ name: item.name, code: item.res?.code ?? null }));
    if (failures.length > 0) {
      analyticsError.value = true;
      analyticsErrorDetail.value = formatAnalyticsFailures(failures);
      return;
    }
    analyticsOverview.value = overview.data;
    analyticsTrend.value = trend.data?.days ?? [];
    analyticsArticlesData.value = articles.data;
    analyticsQuality.value = quality.data;
    analyticsDimensions.value = {
      device: device.data,
      country: country.data,
      referrer: referrer.data,
    };
    if (list?.code === 0 && Array.isArray(list.data?.items)) {
      analyticsArticleOptions.value = list.data.items.map((item: any) => ({
        id: item.id,
        title: item.title,
      }));
    }
    // §7.1「数据时间」优先用清理任务心跳；无心跳时回落到本次取数时刻
    const heartbeat = quality.data?.heartbeat_at;
    const stamp = heartbeat
      ? new Date(String(heartbeat).replace(" ", "T") + "Z")
      : new Date();
    analyticsUpdatedAt.value = Number.isFinite(stamp.getTime())
      ? stamp.toLocaleTimeString(getLocale() === "zh" ? "zh-CN" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  } catch (error) {
    analyticsError.value = true;
    // 只展示错误类型，不把任意异常文本写进 DOM
    analyticsErrorDetail.value = formatAnalyticsFailures([
      { name: "request", code: error instanceof Error ? error.name : "Error" },
    ]);
  } finally {
    analyticsLoading.value = false;
  }
}

function applyAnalyticsArticleFilter() {
  const query = analyticsArticleQuery.value.trim();
  const match = analyticsArticleOptions.value.find(
    (item) => item.title === query
  );
  analyticsArticleId.value = query !== "" && match ? String(match.id) : "";
  analyticsPage.value = 1;
  loadAnalytics();
}

watch(currentTab, (key) => {
  if (key === "analytics") {
    analyticsPage.value = 1;
    loadAnalytics();
  }
});

function handleLocaleChanged() {
  // 只更新响应式 locale 触发重渲染，不重挂载面板，筛选 / 分页 / 数据状态保留
  currentLocale.value = getLocale();
}

const loginForm = ref({ username: "", password: "" });
const loginError = ref("");
const loginLoading = ref(false);

const articles = ref<any[]>([]);
const articlesLoading = ref(false);
const authorFilter = ref("");
interface ScrapeSource {
  html: string;
  finalUrl: string;
  decodeWarnings: ScrapeWarning[];
  /** 首次抓取时间；selector 重提取沿用，避免脚注日期漂移 */
  scrapedAt: Date;
}

interface ScrapePreview extends ScrapeDraft {
  finalUrl: string;
  robotsStatus: "allowed" | "unchecked";
  charset: string;
}
const scrapeUrl = ref("");
const scrapeLoading = ref(false);
const scrapeError = ref("");
const scrapeSource = ref<ScrapeSource | null>(null);
const scrapeSelector = ref("");
const scrapeSelectorError = ref("");
const scrapePreview = ref<ScrapePreview | null>(null);
const scrapeViewMode = ref<"markdown" | "rendered">("markdown");
const scrapeCoverFailed = ref(false);

const categories = ref<any[]>([]);
const showCategoryForm = ref(false);
const categoryForm = ref({ name: "", slug: "", description: "" });
const editingCategoryId = ref<number | null>(null);

const tags = ref<any[]>([]);
const showTagForm = ref(false);
const tagForm = ref({ name: "", slug: "" });

const scrapePreviewHtml = computed(() => {
  const markdown = scrapePreview.value?.markdown;
  if (!markdown) return "";
  try {
    return renderMarkdown(markdown);
  } catch {
    return "";
  }
});

const scrapeCategoryName = computed(() => {
  const id = scrapePreview.value?.categoryId;
  const category = categories.value.find((item) => Number(item.id) === id);
  return category?.name || t("admin.scrape_default_category");
});

// 新预览 / 重新提取后重置封面加载失败状态
watch(scrapePreview, () => {
  scrapeCoverFailed.value = false;
});

const configForm = ref({
  site_title: "",
  site_subtitle: "",
  site_description: "",
  posts_per_page: 10,
});
const configLoading = ref(false);
const configMsg = ref("");

const aboutContent = ref("");
const aboutSaving = ref(false);
const aboutMsg = ref("");

// ===== 个人名片（/about 页顶部）=====
interface ProfileLinkForm {
  label: string;
  url: string;
}
interface ProfileForm {
  name: string;
  role: string;
  bio: string;
  avatar: string;
  links: ProfileLinkForm[];
}

/** 三条空值示例：只预填名称，地址留空；保存时过滤掉未填完整的行 */
function defaultProfileLinks(): ProfileLinkForm[] {
  return [
    { label: "GitHub", url: "" },
    { label: "Email", url: "" },
    { label: "RSS", url: "" },
  ];
}

function emptyProfileForm(): ProfileForm {
  return {
    name: "",
    role: "",
    bio: "",
    avatar: "",
    links: defaultProfileLinks(),
  };
}

/** 后台表单容错解析：坏 JSON / 字段异常一律回退空表单，不让编辑页白屏 */
function parseProfileForm(raw: unknown): ProfileForm {
  let src: any = raw;
  if (typeof src === "string") {
    if (!src.trim()) return emptyProfileForm();
    try {
      src = JSON.parse(src);
    } catch {
      return emptyProfileForm();
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return emptyProfileForm();
  }
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const links: ProfileLinkForm[] = Array.isArray(src.links)
    ? src.links.slice(0, 6).map((l: any) => ({
        label: text(l?.label),
        url: text(l?.url),
      }))
    : [];
  return {
    name: text(src.name),
    role: text(src.role),
    bio: text(src.bio),
    avatar: text(src.avatar),
    links: links.length ? links : defaultProfileLinks(),
  };
}

const profileForm = ref<ProfileForm>(emptyProfileForm());
const profileSaving = ref(false);
const profileAvatarUploading = ref(false);
const profileMsg = ref("");

const users = ref<any[]>([]);
const showUserForm = ref(false);
const userForm = ref({
  username: "",
  password: "",
  display_name: "",
  role: "admin",
});
const editingUserId = ref<number | null>(null);
const originalUserRole = ref<string>("");

const comments = ref<any[]>([]);
const commentFilter = ref("");

const mediaList = ref<any[]>([]);
const mediaLoading = ref(false);

const friendLinks = ref<any[]>([]);
/** C1 / issue #43：后台友链列表渲染兜底，非法协议（含存量脏数据）降级为非可点击文本 */
const safeFriendLinks = computed(() =>
  friendLinks.value.map((fl) => ({
    ...fl,
    safe_url: safeFriendLinkUrl(fl.url),
  }))
);
const showFriendLinkForm = ref(false);
const friendLinkForm = ref({
  name: "",
  url: "",
  description: "",
  sort_order: 0,
  is_active: true,
});
const editingFriendLinkId = ref<number | null>(null);

const SvgIcon = (paths: string) =>
  defineComponent({
    render() {
      return h("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        innerHTML: paths,
      });
    },
  });

const navItems = [
  {
    key: "analytics",
    label: () => t("analytics.nav"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M3 3v18h18"></path><polyline points="7 15 11 10 15 13 20 6"></polyline>'
    ),
  },
  {
    key: "articles",
    label: () => t("admin.articles"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>'
    ),
  },
  {
    key: "scrape",
    label: () => t("admin.scrape"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>'
    ),
  },
  {
    key: "categories",
    label: () => t("admin.categories"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'
    ),
  },
  {
    key: "tags",
    label: () => t("admin.tags"),
    minRole: "editor",
    icon: SvgIcon(
      '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>'
    ),
  },
  {
    key: "about",
    label: () => t("admin.about_page"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    ),
  },
  {
    key: "comments",
    label: () => t("admin.comments"),
    minRole: "editor",
    icon: SvgIcon(
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'
    ),
  },
  {
    key: "media",
    label: () => t("admin.media"),
    minRole: "editor",
    icon: SvgIcon(
      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
    ),
  },
  {
    key: "friend_links",
    label: () => t("admin.friend_links"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>'
    ),
  },
  {
    key: "config",
    label: () => t("admin.site_config"),
    minRole: "admin",
    icon: SvgIcon(
      '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'
    ),
  },
  {
    key: "appearance",
    label: () => "外观与个性化",
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.37-.34-.36-.55-.84-.55-1.38 0-1.1.9-2 2-2h2.34c2.64 0 4.79-2.15 4.79-4.79C21.63 6.32 17.31 2 12 2z"></path><circle cx="7.5" cy="10.5" r="1.5"></circle><circle cx="12" cy="7.5" r="1.5"></circle><circle cx="16.5" cy="10.5" r="1.5"></circle>'
    ),
  },
  {
    key: "users",
    label: () => t("admin.users"),
    minRole: "admin",
    icon: SvgIcon(
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
    ),
  },
];

const adminOnlyTabs = [
  "analytics",
  "scrape",
  "config",
  "users",
  "about",
  "friend_links",
  "appearance",
];

const visibleNavItems = computed(() => {
  return navItems.filter((item) => {
    if (item.minRole === "admin" && userRole.value !== "admin") return false;
    return true;
  });
});

function switchTab(key: string) {
  if (adminOnlyTabs.includes(key) && userRole.value !== "admin") {
    alert("您没有权限访问此页面");
    return;
  }
  currentTab.value = key;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token.value}`,
  };
}

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (data.code === 10003) {
    // 会话失效：先同步落盘本地草稿 + 尽力释放锁，再退出到登录页；不清该用户草稿。
    void editorCore?.sessionExpired();
    token.value = "";
    userRole.value = "editor";
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_role");
    localStorage.removeItem("admin_user_id");
    isLoggedIn.value = false;
  }
  if (data.code === 10004) {
    console.warn("Permission denied:", data.message);
  }
  return data;
}

async function handleLogin() {
  loginError.value = "";
  loginLoading.value = true;
  try {
    const data = await api("POST", "/auth/login", loginForm.value);
    if (data.code === 0 && data.data?.token) {
      token.value = data.data.token;
      localStorage.setItem("admin_token", data.data.token);
      const role = data.data.user?.role || "editor";
      const userId = data.data.user?.id || 0;
      userRole.value = role;
      currentUserId.value = userId;
      localStorage.setItem("admin_role", role);
      localStorage.setItem("admin_user_id", String(userId));
      // 换账号登录后回到文章页，避免沿用上一个会话的管理员专属标签
      currentTab.value = "articles";
      isLoggedIn.value = true;
    } else {
      loginError.value = data.message || t("admin.login_error");
    }
  } catch (e) {
    loginError.value = t("admin.login_error");
  } finally {
    loginLoading.value = false;
  }
}

async function handleLogout() {
  // 主动退出：释放编辑锁并清理该用户全部本地草稿（10003 会话失效不走这里）。
  editorCore?.dispose();
  clearUserDrafts(window.localStorage, currentUserId.value);
  token.value = "";
  userRole.value = "editor";
  currentUserId.value = 0;
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_role");
  localStorage.removeItem("admin_user_id");
  currentTab.value = "articles";
  isLoggedIn.value = false;
}

function formatDate(d: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString(
    getLocale() === "zh" ? "zh-CN" : "en-US"
  );
}

async function loadArticles() {
  articlesLoading.value = true;
  try {
    let url = "/articles?page_size=100&status=all";
    if (authorFilter.value) url += `&author_id=${authorFilter.value}`;
    const data = await api("GET", url);
    if (data.code === 0) articles.value = data.data?.items || [];
  } finally {
    articlesLoading.value = false;
  }
}

async function loadCategories() {
  const data = await api("GET", "/categories");
  if (data.code === 0) categories.value = data.data?.items || data.data || [];
}

async function loadTags() {
  const data = await api("GET", "/tags");
  if (data.code === 0) tags.value = data.data?.items || data.data || [];
}

async function loadConfig() {
  configLoading.value = true;
  try {
    const data = await api("GET", "/config/all");
    if (data.code === 0 && data.data) {
      configForm.value = {
        site_title: data.data.site_title || "",
        site_subtitle: data.data.site_subtitle || "",
        site_description: data.data.site_description || "",

        posts_per_page: parseInt(data.data.posts_per_page) || 10,
      };
      aboutContent.value = data.data.about_content || "";
      profileForm.value = parseProfileForm(data.data.profile_card);
    }
  } finally {
    configLoading.value = false;
  }
}

const editorState = shallowRef<EditorState>(initialEditorState());
const editorConflict = shallowRef<LockConflict | null>(null);

const editorLock = createEditLock({
  apiBase: import.meta.env.PUBLIC_API_BASE || "/api/v1",
  getToken: () => token.value,
});

editorCore = createArticleEditor({
  userId: currentUserId.value,
  api: { request: (method, path, body) => api(method, path, body) },
  lock: editorLock,
  storage: window.localStorage,
  messages: () => ({
    loadFailed: t("admin.editor_load_failed"),
    saveFailed: t("admin.save_failed"),
    lockFailed: t("admin.lock_failed"),
    lockLost: t("admin.lock_lost_message"),
  }),
  onSaved: () => {
    void loadArticles();
  },
  onSessionExpired: () => {
    isLoggedIn.value = false;
  },
  onError: (message: string) => {
    alert(message);
  },
});
editorCore.subscribe((next, conflict) => {
  editorState.value = next;
  editorConflict.value = conflict;
});

function openNewArticle(): void {
  void editorCore?.open(null);
}

function editArticle(a: { id: number }): void {
  void editorCore?.open({ id: a.id });
}

function setAuthorFilter(value: string): void {
  authorFilter.value = value;
}

function onEditorForm(form: EditorFormSnapshot): void {
  editorCore?.updateForm(form);
}
function onEditorSave(): void {
  void editorCore?.save();
}
function onEditorClose(): void {
  editorCore?.close();
}
function onEditorRetry(): void {
  void editorCore?.retryLoad();
}
function onEditorTakeover(): void {
  void editorCore?.takeover();
}
function onEditorDiscard(): void {
  editorCore?.discard();
}
function onEditorContinue(): void {
  editorCore?.continueEditing();
}
function onEditorOpenLink(): void {
  editorCore?.openDialog("link");
}
function onEditorCloseDialog(): void {
  editorCore?.closeDialog();
}
function onEditorKeepDraft(): void {
  editorCore?.keepDraftAndClose();
}

/** 新建标签沿用原有 POST /tags → loadTags → 加进表单的路径，行为等价。 */
async function addEditorTag(name: string): Promise<void> {
  const current = editorCore?.getState();
  if (!current || current.form.tags.includes(name)) return;
  let slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");
  if (!slug) slug = "tag-" + Date.now().toString(36);
  try {
    const res = await api("POST", "/tags", { name, slug });
    if (res.code === 0 || res.code === 10006) {
      await loadTags();
      const latest = editorCore?.getState();
      if (latest && !latest.form.tags.includes(name)) {
        editorCore?.updateForm({
          ...latest.form,
          tags: [...latest.form.tags, name],
        });
      }
    } else {
      alert(res.message || t("admin.save_failed"));
    }
  } catch {
    alert(t("admin.save_failed"));
  }
}

const SCRAPE_WARNING_KEYS: Record<ScrapeWarning, string> = {
  no_article: "admin.scrape_warning_no_article",
  readability_failed: "admin.scrape_warning_readability_failed",
  convert_failed: "admin.scrape_warning_convert_failed",
  charset_fallback: "admin.scrape_warning_charset_fallback",
};

function scrapeWarningText(warning: ScrapeWarning): string {
  return t(SCRAPE_WARNING_KEYS[warning]);
}

function previewFromDraft(
  draft: ScrapeDraft,
  warnings: ScrapeWarning[],
  meta: Pick<ScrapePreview, "finalUrl" | "robotsStatus" | "charset">
): ScrapePreview {
  return {
    ...meta,
    ...draft,
    warnings: [...warnings, ...draft.warnings],
  };
}

/** 初次抓取与 selector 重提取共用同一组标签/日期参数。 */
function scrapeBuildOptions(scrapedAt: Date) {
  return {
    existingTags: tags.value.map((tag) => tag.name),
    scrapedAt,
  };
}

async function runScrape() {
  const target = scrapeUrl.value.trim();
  if (!target) {
    scrapeError.value = t("admin.scrape_url_required");
    return;
  }
  if (scrapePreview.value && !confirm(t("admin.scrape_replace_confirm"))) {
    return;
  }

  scrapeLoading.value = true;
  scrapeError.value = "";
  scrapeSelectorError.value = "";
  const scrapedAt = new Date();
  try {
    const res = await fetch(
      `${API}/admin/scrape?url=${encodeURIComponent(target)}`,
      { headers: { Authorization: `Bearer ${token.value}` } }
    );
    if (!res.ok) {
      let message = t("admin.scrape_failed");
      try {
        const data = await res.json();
        if (data?.message) message = data.message;
      } catch {
        // 非 JSON 错误响应保留通用文案
      }
      scrapeError.value = message;
      return;
    }

    const bytes = await res.arrayBuffer();
    const finalHeader = res.headers.get("X-Final-URL");
    let finalUrl = target;
    if (finalHeader) {
      try {
        finalUrl = decodeURIComponent(finalHeader);
      } catch {
        finalUrl = finalHeader;
      }
    }
    const robotsStatus =
      res.headers.get("X-Robots-Status") === "allowed"
        ? "allowed"
        : "unchecked";

    const { buildScrapeDraft, decodeHtmlBytes } =
      await import("../utils/scrape");
    // #34：按 BOM / Content-Type / <meta charset> 解码字节，未知字符集回退 UTF-8
    const decoded = decodeHtmlBytes(bytes, res.headers.get("Content-Type"));
    // #35：元数据映射只匹配已有标签；来源脚注日期固定为本次抓取日期
    const draft: ScrapeDraft = buildScrapeDraft(
      decoded.html,
      finalUrl,
      scrapeBuildOptions(scrapedAt)
    );

    // 原始 HTML 留在内存，供 selector「重新提取」本地重跑（不重新请求源站）
    scrapeSource.value = {
      html: decoded.html,
      finalUrl,
      decodeWarnings: decoded.warnings,
      scrapedAt,
    };
    scrapeSelector.value = "";
    scrapePreview.value = previewFromDraft(draft, decoded.warnings, {
      finalUrl,
      robotsStatus,
      charset: decoded.charset,
    });
    // 空正文也保留预览与 selector，允许在已抓取的 HTML 上手动覆盖
    if (!draft.markdown.trim()) {
      scrapeSelectorError.value = t("admin.scrape_empty");
    }
  } catch {
    scrapeError.value = t("admin.scrape_failed");
  } finally {
    scrapeLoading.value = false;
  }
}

/**
 * 在已抓取的 HTML 上按手动 selector 重新提取；失败时保留上一份预览，
 * 错误只显示在 selector 行下方（不影响「重新抓取」的错误区）。
 */
async function reextractScrape() {
  const source = scrapeSource.value;
  const current = scrapePreview.value;
  if (!source || !current) return;

  scrapeSelectorError.value = "";

  let mod: typeof import("../utils/scrape");
  try {
    mod = await import("../utils/scrape");
  } catch {
    scrapeSelectorError.value = t("admin.scrape_selector_failed");
    return;
  }

  try {
    const draft = mod.buildScrapeDraft(source.html, source.finalUrl, {
      selector: scrapeSelector.value,
      ...scrapeBuildOptions(source.scrapedAt),
    });
    scrapePreview.value = previewFromDraft(draft, source.decodeWarnings, {
      finalUrl: current.finalUrl,
      robotsStatus: current.robotsStatus,
      charset: current.charset,
    });
    // 命中但正文为空（例如只选中了标题 H1）仍算命中，预览照常替换
    if (!draft.markdown.trim()) {
      scrapeSelectorError.value = t("admin.scrape_empty");
    }
  } catch (error) {
    if (error instanceof mod.ScrapeSelectorError) {
      scrapeSelectorError.value =
        error.code === "selector_invalid"
          ? t("admin.scrape_selector_invalid")
          : t("admin.scrape_selector_no_match");
    } else {
      scrapeSelectorError.value = t("admin.scrape_selector_failed");
    }
  }
}

function editScrapedDraft() {
  const draft = scrapePreview.value;
  if (!draft) return;
  void editorCore?.open(null, {
    title: draft.title,
    slug: draft.slug,
    summary: draft.summary,
    content: draft.markdown,
    cover_image: draft.coverImage,
    category_id: String(draft.categoryId),
    status: draft.status,
    tags: [...draft.tags],
  });
}

async function deleteArticle(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/articles/${id}`);
  if (data.code === 0) await loadArticles();
  else alert(data.message || t("admin.delete_failed"));
}

async function saveCategory() {
  let data;
  if (editingCategoryId.value) {
    data = await api(
      "PUT",
      `/categories/${editingCategoryId.value}`,
      categoryForm.value
    );
  } else {
    data = await api("POST", "/categories", categoryForm.value);
  }
  if (data.code === 0) {
    showCategoryForm.value = false;
    editingCategoryId.value = null;
    await loadCategories();
  } else {
    alert(data.message || t("admin.save_failed"));
  }
}

async function deleteCategory(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/categories/${id}`);
  if (data.code === 0) await loadCategories();
  else alert(data.message || t("admin.delete_failed"));
}

async function saveTag() {
  const data = await api("POST", "/tags", tagForm.value);
  if (data.code === 0) {
    showTagForm.value = false;
    await loadTags();
  } else {
    alert(data.message || t("admin.save_failed"));
  }
}

async function deleteTag(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/tags/${id}`);
  if (data.code === 0) await loadTags();
  else alert(data.message || t("admin.delete_failed"));
}

async function saveConfig() {
  configMsg.value = "";
  const data = await api("PUT", "/config", toConfigPayload(configForm.value));
  if (data.code === 0) configMsg.value = t("admin.save_success");
  else configMsg.value = data.message || t("admin.save_failed");
}

async function saveAbout() {
  aboutSaving.value = true;
  aboutMsg.value = "";
  try {
    const data = await api("PUT", "/config", {
      about_content: aboutContent.value,
    });
    if (data.code === 0) aboutMsg.value = t("admin.save_success");
    else aboutMsg.value = data.message || t("admin.save_failed");
  } finally {
    aboutSaving.value = false;
  }
}

async function saveProfile() {
  profileSaving.value = true;
  profileMsg.value = "";
  try {
    // 半填 / 全空的示例行不提交，由后端白名单与协议校验兜住剩下的非法地址
    const links = profileForm.value.links
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label && l.url);
    const data = await api("PUT", "/config", {
      profile_card: JSON.stringify({
        name: profileForm.value.name,
        role: profileForm.value.role,
        bio: profileForm.value.bio,
        avatar: profileForm.value.avatar,
        links,
      }),
    });
    if (data.code === 0) profileMsg.value = t("admin.save_success");
    else profileMsg.value = data.message || t("admin.save_failed");
  } catch {
    profileMsg.value = t("admin.save_failed");
  } finally {
    profileSaving.value = false;
  }
}

async function uploadProfileAvatar(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  profileAvatarUploading.value = true;
  profileMsg.value = "";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${API}/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.value}` },
      body: formData,
    });
    const data = await res.json();
    if (data.code === 0 && data.data?.url) {
      profileForm.value.avatar = data.data.url;
      profileMsg.value = "头像已上传，请点「保存名片」生效";
    } else {
      alert(data.message || t("admin.upload_failed"));
    }
  } catch {
    alert(t("admin.upload_failed"));
  } finally {
    profileAvatarUploading.value = false;
    input.value = "";
  }
}

function addProfileLink() {
  if (profileForm.value.links.length >= 6) return;
  profileForm.value.links.push({ label: "", url: "" });
}

function removeProfileLink(index: number) {
  profileForm.value.links.splice(index, 1);
}

// ===== 外观与个性化（可视化配置中心）=====
const settings = reactive(getDefaultSettings());
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const settingsMsg = ref("");
const newCopyKey = ref("");
const newCopyZh = ref("");
const newCopyEn = ref("");

const i18nKeys = Object.keys(zh as Record<string, unknown>);
const colorFields = [
  { key: "accent", label: "主色" },
  { key: "accentHover", label: "主色(悬停)" },
  { key: "bgPrimary", label: "页面背景" },
  { key: "bgSecondary", label: "卡片背景" },
  { key: "bgTertiary", label: "次要背景" },
  { key: "textPrimary", label: "主文字" },
  { key: "textSecondary", label: "次文字" },
  { key: "textTertiary", label: "辅助文字" },
  { key: "border", label: "边框" },
  { key: "borderLight", label: "浅边框" },
] as const;
const featureList = [
  { key: "comments", label: "评论" },
  { key: "likes", label: "点赞" },
  { key: "friendLinks", label: "友情链接" },
  { key: "search", label: "搜索" },
  { key: "rss", label: "RSS" },
  { key: "darkMode", label: "暗色切换按钮" },
  { key: "i18n", label: "语言切换按钮" },
] as const;

const copyKeys = computed(() =>
  Array.from(
    new Set([
      ...Object.keys(settings.copy.zh),
      ...Object.keys(settings.copy.en),
    ])
  )
);

// 实时预览：把当前草稿直接套用到页面（后台面板本身也用同一套 CSS 变量，因此可即时预览）
function previewSettings() {
  applySettings(settings);
}

async function loadSettings() {
  settingsLoading.value = true;
  try {
    const data = await api("GET", "/settings");
    if (data.code === 0 && data.data) {
      const inc = data.data;
      settings.theme = inc.theme;
      settings.layout = inc.layout;
      settings.background = inc.background;
      settings.features = inc.features;
      settings.copy = inc.copy || { zh: {}, en: {} };
      settings.motion = inc.motion || getDefaultSettings().motion;
      previewSettings();
    }
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings() {
  settingsSaving.value = true;
  settingsMsg.value = "";
  try {
    const data = await api(
      "PUT",
      "/settings",
      JSON.parse(JSON.stringify(settings))
    );
    if (data.code === 0) {
      settingsMsg.value = t("admin.save_success");
      broadcastSettingsChange();
    } else {
      settingsMsg.value = data.message || t("admin.save_failed");
    }
  } catch {
    settingsMsg.value = t("admin.save_failed");
  } finally {
    settingsSaving.value = false;
  }
}

async function exportSettingsFile() {
  try {
    const res = await fetch(`${API}/settings/export`, {
      headers: authHeaders(),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "site-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert("导出失败");
  }
}

async function importSettingsFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    const data = await api("POST", "/settings/import", obj);
    if (data.code === 0 && data.data) {
      settings.theme = data.data.theme;
      settings.layout = data.data.layout;
      settings.background = data.data.background;
      settings.features = data.data.features;
      settings.copy = data.data.copy || { zh: {}, en: {} };
      settings.motion = data.data.motion || getDefaultSettings().motion;
      previewSettings();
      broadcastSettingsChange();
      settingsMsg.value = "配置导入成功";
    } else {
      settingsMsg.value = data.message || "导入失败";
    }
  } catch {
    settingsMsg.value = "导入失败：文件格式错误";
  }
  input.value = "";
}

async function resetSettings() {
  if (!confirm("确定将所有外观设置恢复为默认值？此操作不可撤销。")) return;
  const data = await api("POST", "/settings/reset");
  if (data.code === 0 && data.data) {
    settings.theme = data.data.theme;
    settings.layout = data.data.layout;
    settings.background = data.data.background;
    settings.features = data.data.features;
    settings.copy = data.data.copy || { zh: {}, en: {} };
    settings.motion = data.data.motion || getDefaultSettings().motion;
    previewSettings();
    broadcastSettingsChange();
    settingsMsg.value = "已恢复默认设置";
  } else {
    settingsMsg.value = "恢复失败";
  }
}

function addCopyKey() {
  const k = (newCopyKey.value || "").trim();
  if (!k) return;
  if (newCopyZh.value) settings.copy.zh[k] = newCopyZh.value;
  if (newCopyEn.value) settings.copy.en[k] = newCopyEn.value;
  newCopyKey.value = "";
  newCopyZh.value = "";
  newCopyEn.value = "";
  previewSettings();
}

function removeCopyKey(k: string) {
  delete settings.copy.zh[k];
  delete settings.copy.en[k];
  previewSettings();
}

function renameCopyKey(oldKey: string, newKey: string) {
  const k = (newKey || "").trim();
  if (!k || k === oldKey) return;
  const zhv = settings.copy.zh[oldKey];
  const env = settings.copy.en[oldKey];
  delete settings.copy.zh[oldKey];
  delete settings.copy.en[oldKey];
  if (zhv !== undefined) settings.copy.zh[k] = zhv;
  if (env !== undefined) settings.copy.en[k] = env;
  previewSettings();
}

async function loadUsers() {
  const data = await api("GET", "/users");
  if (data.code === 0) users.value = data.data || [];
}

async function saveUser() {
  let data;
  if (editingUserId.value) {
    const body: any = { display_name: userForm.value.display_name };
    if (userForm.value.role !== originalUserRole.value)
      body.role = userForm.value.role;
    if (userForm.value.password) body.password = userForm.value.password;
    data = await api("PUT", `/users/${editingUserId.value}`, body);
  } else {
    if (!userForm.value.username || !userForm.value.password) {
      alert(t("admin.username_password_required"));
      return;
    }
    data = await api("POST", "/users", userForm.value);
  }
  if (data.code === 0) {
    showUserForm.value = false;
    editingUserId.value = null;
    await loadUsers();
  } else {
    alert(data.message || t("admin.save_failed"));
  }
}

async function deleteUser(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/users/${id}`);
  if (data.code === 0) await loadUsers();
  else alert(data.message || t("admin.delete_failed"));
}

async function loadComments() {
  const status = commentFilter.value ? `?status=${commentFilter.value}` : "";
  const data = await api("GET", `/comments${status}`);
  if (data.code === 0) comments.value = data.data || [];
}

async function approveComment(id: number) {
  const data = await api("PUT", `/comments/${id}/approve`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t("admin.save_failed"));
}

async function rejectComment(id: number) {
  const data = await api("PUT", `/comments/${id}/reject`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t("admin.save_failed"));
}

async function deleteComment(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/comments/${id}`);
  if (data.code === 0) await loadComments();
  else alert(data.message || t("admin.delete_failed"));
}

async function loadMedia() {
  mediaLoading.value = true;
  try {
    const data = await api("GET", "/media");
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
  formData.append("file", file);

  try {
    const res = await fetch("/api/v1/media/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.value}` },
      body: formData,
    });
    const data = await res.json();
    if (data.code === 0) await loadMedia();
    else alert(data.message || t("admin.upload_failed"));
  } catch {
    alert(t("admin.upload_failed"));
  }
  input.value = "";
}

async function deleteMedia(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/media/${id}`);
  if (data.code === 0) await loadMedia();
  else alert(data.message || t("admin.delete_failed"));
}

function copyMediaUrl(url: string) {
  const fullUrl = new URL(url, window.location.origin).href;
  navigator.clipboard.writeText(fullUrl);
  alert(t("admin.copied"));
}

async function loadFriendLinks() {
  const data = await api("GET", "/friend-links/all");
  if (data.code === 0) friendLinks.value = data.data?.items || data.data || [];
}

async function saveFriendLink() {
  let data;
  if (editingFriendLinkId.value) {
    data = await api(
      "PUT",
      `/friend-links/${editingFriendLinkId.value}`,
      friendLinkForm.value
    );
  } else {
    data = await api("POST", "/friend-links", friendLinkForm.value);
  }
  if (data.code === 0) {
    showFriendLinkForm.value = false;
    editingFriendLinkId.value = null;
    await loadFriendLinks();
  } else {
    alert(data.message || t("admin.save_failed"));
  }
}

async function deleteFriendLink(id: number) {
  if (!confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/friend-links/${id}`);
  if (data.code === 0) await loadFriendLinks();
  else alert(data.message || t("admin.delete_failed"));
}

function loadInitialData() {
  loadArticles();
  loadCategories();
  loadTags();
  loadComments();
  loadMedia();
  loadFriendLinks();
  if (userRole.value === "admin") {
    loadUsers();
  }
}

watch(isLoggedIn, (v) => {
  if (v) loadInitialData();
});

onMounted(() => {
  if (isLoggedIn.value) loadInitialData();
  editorCore?.attach();
  document.addEventListener("locale-changed", handleLocaleChanged);
});

onBeforeUnmount(() => {
  editorCore?.dispose();
  document.removeEventListener("locale-changed", handleLocaleChanged);
});

watch(currentTab, (tab) => {
  if (tab === "config" || tab === "about") loadConfig();
  if (tab === "appearance") loadSettings();
  if (tab === "users") loadUsers();
  if (tab === "comments") loadComments();
  if (tab === "media") loadMedia();
  if (tab === "friend_links") loadFriendLinks();
});
</script>
