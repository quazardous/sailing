<script setup lang="ts">
import { computed } from 'vue';
import { useActivitiesStore } from '../stores/activities';
import { useProjectStore } from '../stores/project';

const activitiesStore = useActivitiesStore();
const projectStore = useProjectStore();

const projectPath = computed(() => projectStore.projectPath);
const projectName = computed(() => projectStore.projectName);

function goToArtefacts() {
  activitiesStore.setActivity('artefacts');
}

function goToAgents() {
  activitiesStore.setActivity('agents');
}
</script>

<template>
  <div class="sidebar-container">
    <div class="sidebar-header">
      <span class="sidebar-title">Welcome</span>
    </div>
    <div class="sidebar-content">
      <!-- Project Info -->
      <div class="project-info">
        <div class="project-icon">⛵</div>
        <div class="project-details">
          <div class="project-name">{{ projectName }}</div>
          <div class="project-path">{{ projectPath }}</div>
        </div>
      </div>

      <div class="quick-actions">
        <h3 class="section-title">Quick Actions</h3>

        <button class="action-btn" @click="goToArtefacts">
          <span class="action-icon">📋</span>
          <span class="action-text">
            <span class="action-label">Explore PRDs</span>
            <span class="action-desc">View your product roadmap</span>
          </span>
        </button>

        <button class="action-btn" @click="goToAgents">
          <span class="action-icon">🤖</span>
          <span class="action-text">
            <span class="action-label">Monitor Agents</span>
            <span class="action-desc">Track running agents</span>
          </span>
        </button>
      </div>

      <div class="info-section">
        <h3 class="section-title">Tips</h3>
        <ul class="tips-list">
          <li>Use the activity bar to navigate</li>
          <li>Drag panels to rearrange layout</li>
          <li>Layouts are saved per activity</li>
        </ul>
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

.project-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 12px);
  padding: var(--spacing-md, 12px);
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-md, 6px);
  margin-bottom: var(--spacing-lg, 20px);
}

.project-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.project-details {
  min-width: 0;
}

.project-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #fff);
}

.project-path {
  font-size: 11px;
  color: var(--accent, #0078d4);
  font-family: var(--font-mono, monospace);
  word-break: break-all;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim, #888);
  margin-bottom: var(--spacing-sm, 8px);
}

.quick-actions {
  margin-bottom: var(--spacing-lg, 20px);
}

.action-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacing-md, 12px);
  padding: var(--spacing-md, 12px);
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  text-align: left;
  margin-bottom: var(--spacing-sm, 8px);
  transition: all 0.15s;
  color: var(--text, #fff);
}

.action-btn:hover {
  border-color: var(--accent, #0078d4);
  background: var(--bg-tertiary, #333);
}

.action-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.action-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-label {
  font-size: 13px;
  font-weight: 600;
}

.action-desc {
  font-size: 11px;
  color: var(--text-dim, #888);
}

.info-section {
  padding-top: var(--spacing-md, 12px);
  border-top: 1px solid var(--border, #333);
}

.tips-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, #888);
}

.tips-list li {
  padding: 4px 0;
  padding-left: 16px;
  position: relative;
}

.tips-list li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--accent, #0078d4);
}
</style>
