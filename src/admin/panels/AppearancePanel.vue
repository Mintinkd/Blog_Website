<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import {
  applySettings,
  getDefaultSettings,
  broadcastSettingsChange,
} from "../../utils/settings.ts";
import zh from "../../i18n/zh.json";
import {
  copyKeyUnion,
  addCopyEntry,
  removeCopyEntry,
  renameCopyEntry,
  normalizeSettings,
} from "./appearance.logic";

const { api, feedback } = useAdminContext();

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
  copyKeyUnion(settings.copy.zh, settings.copy.en)
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
      const norm = normalizeSettings(inc, getDefaultSettings());
      settings.theme = norm.theme;
      settings.layout = norm.layout;
      settings.background = norm.background;
      settings.features = norm.features;
      settings.copy = norm.copy;
      settings.motion = norm.motion;
      previewSettings();
    }
  } finally {
    settingsLoading.value = false;
  }
}
onMounted(loadSettings);

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
    const res = await fetch(`${api.apiBase}/settings/export`, {
      headers: api.authHeaders(),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "site-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    feedback.alert("导出失败");
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
      const norm = normalizeSettings(data.data, getDefaultSettings());
      settings.theme = norm.theme;
      settings.layout = norm.layout;
      settings.background = norm.background;
      settings.features = norm.features;
      settings.copy = norm.copy;
      settings.motion = norm.motion;
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
  if (!feedback.confirm("确定将所有外观设置恢复为默认值？此操作不可撤销。"))
    return;
  const data = await api("POST", "/settings/reset");
  if (data.code === 0 && data.data) {
    const norm = normalizeSettings(data.data, getDefaultSettings());
    settings.theme = norm.theme;
    settings.layout = norm.layout;
    settings.background = norm.background;
    settings.features = norm.features;
    settings.copy = norm.copy;
    settings.motion = norm.motion;
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
  addCopyEntry(
    settings.copy,
    newCopyKey.value,
    newCopyZh.value,
    newCopyEn.value
  );
  newCopyKey.value = "";
  newCopyZh.value = "";
  newCopyEn.value = "";
  previewSettings();
}

function removeCopyKey(k: string) {
  removeCopyEntry(settings.copy, k);
  previewSettings();
}

function renameCopyKey(oldKey: string, newKey: string) {
  const k = (newKey || "").trim();
  if (!k || k === oldKey) return;
  renameCopyEntry(settings.copy, oldKey, newKey);
  previewSettings();
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>外观与个性化</h2>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap">
        <button class="btn-secondary" @click="exportSettingsFile">导出</button>
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
            <div class="color-field" v-for="cf in colorFields" :key="cf.key">
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
          <label class="toggle-item" v-for="ft in featureList" :key="ft.key">
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
        <p class="hint">覆盖界面文案（随当前语言生效），留空使用默认文案。</p>
        <div class="copy-row head">
          <span>键 (key)</span><span>中文 (zh)</span><span>英文 (en)</span
          ><span></span>
        </div>
        <div class="copy-row" v-for="key in copyKeys" :key="key">
          <input
            :list="'i18n-keys'"
            :value="key"
            @input="
              renameCopyKey(key, ($event.target as HTMLInputElement).value)
            "
            placeholder="如 nav.home"
          />
          <input v-model="settings.copy.zh[key]" @input="previewSettings" />
          <input v-model="settings.copy.en[key]" @input="previewSettings" />
          <button class="btn-danger" @click="removeCopyKey(key)">×</button>
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
</template>
