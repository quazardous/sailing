<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useActivitiesStore } from '../stores/activities';

type Theme = 'dark' | 'light' | 'system';

const activitiesStore = useActivitiesStore();
const currentTheme = ref<Theme>('dark');

onMounted(() => {
  // Load theme from localStorage
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved && ['dark', 'light', 'system'].includes(saved)) {
    currentTheme.value = saved;
  }
  applyTheme(currentTheme.value);
});

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }

  localStorage.setItem('theme', theme);
}

function handleThemeChange(event: Event) {
  const select = event.target as HTMLSelectElement;
  currentTheme.value = select.value as Theme;
  applyTheme(currentTheme.value);
}

function resetAllLayouts() {
  // Clear all layout data from localStorage
  for (const activity of activitiesStore.allActivities) {
    localStorage.removeItem(activitiesStore.getLayoutKey(activity.id));
  }
  // Reload to apply default layouts
  window.location.reload();
}
</script>

<template>
  <div class="sidebar-container">
    <div class="sidebar-header">
      <span class="sidebar-title">Settings</span>
    </div>
    <div class="sidebar-content">
      <div class="settings-section">
        <div class="settings-group">
          <label class="settings-label">Appearance</label>

          <div class="setting-row">
            <span class="setting-name">Theme</span>
            <select
              class="setting-select"
              :value="currentTheme"
              @change="handleThemeChange"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>

        <div class="settings-group">
          <label class="settings-label">Layout</label>

          <div class="setting-row">
            <span class="setting-name">Reset all layouts</span>
            <button class="reset-btn" @click="resetAllLayouts">
              Reset
            </button>
          </div>
        </div>

        <div class="settings-group">
          <label class="settings-label">About</label>

          <div class="about-info">
            <div class="about-row">
              <span class="about-label">Dashboard</span>
              <span class="about-value">Rudder v1.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #252526);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim, #888);
}

.sidebar-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-md, 12px);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 20px);
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.settings-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim, #888);
  margin-bottom: 4px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary, #1e1e1e);
  border-radius: var(--radius-md, 6px);
}

.setting-name {
  font-size: 13px;
  color: var(--text, #fff);
}

.setting-select {
  background: var(--bg-tertiary, #333);
  border: 1px solid var(--border, #444);
  border-radius: var(--radius-sm, 4px);
  color: var(--text, #fff);
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  min-width: 100px;
}

.setting-select:hover {
  border-color: var(--accent, #0078d4);
}

.setting-select:focus {
  outline: none;
  border-color: var(--accent, #0078d4);
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary, #1e1e1e);
  border-radius: var(--radius-md, 6px);
}

.about-label {
  font-size: 13px;
  color: var(--text-dim, #888);
}

.about-value {
  font-size: 13px;
  color: var(--text, #fff);
}

.reset-btn {
  background: var(--bg-tertiary, #333);
  border: 1px solid var(--border, #444);
  border-radius: var(--radius-sm, 4px);
  color: var(--text, #fff);
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.reset-btn:hover {
  background: var(--color-error, #f87171);
  border-color: var(--color-error, #f87171);
}
</style>
