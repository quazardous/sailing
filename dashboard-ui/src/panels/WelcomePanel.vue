<script setup lang="ts">
import { useArtefactsStore } from '../stores/artefacts';
import { useAgentsStore } from '../stores/agents';
import { computed } from 'vue';

const artefactsStore = useArtefactsStore();
const agentsStore = useAgentsStore();

const stats = computed(() => ({
  prds: artefactsStore.prds.length,
  runningAgents: agentsStore.agents.filter(a => a.status === 'running').length,
  totalAgents: agentsStore.agents.length,
}));
</script>

<template>
  <div class="panel-container welcome-panel">
    <div class="welcome-content">
      <div class="welcome-hero">
        <div class="hero-icon">🏴‍☠️</div>
        <h1 class="hero-title">Sailing Dashboard</h1>
        <p class="hero-subtitle">Ahoy sailor</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">📋</div>
          <div class="stat-value">{{ stats.prds }}</div>
          <div class="stat-label">PRDs</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">🤖</div>
          <div class="stat-value">{{ stats.runningAgents }}</div>
          <div class="stat-label">Active Agents</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-value">{{ stats.totalAgents }}</div>
          <div class="stat-label">Total Agents</div>
        </div>
      </div>

      <div class="keyboard-shortcuts">
        <h3>Navigation</h3>
        <ul class="shortcuts-list">
          <li>
            <span class="shortcut-icon">🏴‍☠️</span>
            <span class="shortcut-name">Welcome</span>
            <span class="shortcut-desc">Overview and quick actions</span>
          </li>
          <li>
            <span class="shortcut-icon">📋</span>
            <span class="shortcut-name">Artefacts</span>
            <span class="shortcut-desc">Explore PRDs, Epics, Tasks</span>
          </li>
          <li>
            <span class="shortcut-icon">🤖</span>
            <span class="shortcut-name">Agents</span>
            <span class="shortcut-desc">Monitor agent activity</span>
          </li>
          <li>
            <span class="shortcut-icon">⚙️</span>
            <span class="shortcut-name">Settings</span>
            <span class="shortcut-desc">Configure preferences</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl, 24px);
}

.welcome-content {
  max-width: 600px;
  width: 100%;
}

.welcome-hero {
  text-align: center;
  margin-bottom: var(--spacing-xl, 32px);
}

.hero-icon {
  font-size: 64px;
  margin-bottom: var(--spacing-md, 12px);
}

.hero-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: var(--text, #fff);
}

.hero-subtitle {
  font-size: 14px;
  color: var(--text-dim, #888);
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-md, 12px);
  margin-bottom: var(--spacing-xl, 32px);
}

.stat-card {
  text-align: center;
  padding: var(--spacing-lg, 16px);
  background: var(--bg, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-md, 6px);
}

.stat-icon {
  font-size: 24px;
  margin-bottom: var(--spacing-xs, 4px);
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--accent, #4fc3f7);
}

.stat-label {
  font-size: 12px;
  color: var(--text-dim, #888);
  margin-top: var(--spacing-xs, 4px);
}

.keyboard-shortcuts {
  background: var(--bg, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-md, 6px);
  padding: var(--spacing-lg, 16px);
}

.keyboard-shortcuts h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 var(--spacing-md, 12px) 0;
  color: var(--text, #fff);
}

.shortcuts-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.shortcuts-list li {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-sm, 8px) 0;
  border-bottom: 1px solid var(--border, #333);
}

.shortcuts-list li:last-child {
  border-bottom: none;
}

.shortcut-icon {
  font-size: 16px;
  width: 24px;
  text-align: center;
}

.shortcut-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text, #fff);
  min-width: 100px;
}

.shortcut-desc {
  font-size: 12px;
  color: var(--text-dim, #888);
}
</style>
