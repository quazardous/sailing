<script setup lang="ts">
// Settings panel - main area content for settings activity
// Most settings are in the sidebar, this is for additional content
</script>

<template>
  <div class="panel-container">
    <div class="panel-content">
      <div class="settings-info">
        <h2 class="settings-title">Settings</h2>
        <p class="settings-description">
          Configure your dashboard preferences using the sidebar on the left.
        </p>

        <div class="info-section">
          <h3 class="section-title">Keyboard Shortcuts</h3>
          <div class="shortcut-list">
            <div class="shortcut-row">
              <span class="shortcut-key">Ctrl + 1</span>
              <span class="shortcut-desc">Switch to Artefacts activity</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-key">Ctrl + 2</span>
              <span class="shortcut-desc">Switch to Agents activity</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-key">Ctrl + ,</span>
              <span class="shortcut-desc">Open Settings</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #1e1e1e);
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-lg, 20px);
}

.settings-info {
  max-width: 600px;
}

.settings-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text, #fff);
  margin: 0 0 var(--spacing-sm, 8px) 0;
}

.settings-description {
  color: var(--text-dim, #888);
  font-size: 14px;
  margin: 0 0 var(--spacing-xl, 32px) 0;
}

.info-section {
  margin-bottom: var(--spacing-xl, 32px);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #fff);
  margin: 0 0 var(--spacing-md, 12px) 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 12px);
  padding: 10px 14px;
  background: var(--bg-secondary, #252526);
  border-radius: var(--radius-md, 6px);
}

.shortcut-key {
  font-family: monospace;
  font-size: 12px;
  padding: 4px 8px;
  background: var(--bg-tertiary, #333);
  border-radius: var(--radius-sm, 4px);
  color: var(--text, #fff);
  min-width: 80px;
  text-align: center;
}

.shortcut-desc {
  color: var(--text-dim, #888);
  font-size: 13px;
}
</style>
