<script setup lang="ts">
import { useActivitiesStore } from '../stores/activities';

const activitiesStore = useActivitiesStore();

// Modern SVG icons (VS Code style)
const icons: Record<string, string> = {
  // Compass/Navigation for Welcome
  welcome: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="10"/>
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" fill="currentColor" stroke="none"/>
  </svg>`,
  // Folder tree for Artefacts
  artefacts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H13L11 5H5C3.9 5 3 5.9 3 7Z"/>
    <line x1="8" y1="12" x2="16" y2="12"/>
    <line x1="8" y1="15" x2="14" y2="15"/>
  </svg>`,
  // CPU/Bot for Agents
  agents: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
    <circle cx="15" cy="10" r="1.5" fill="currentColor"/>
    <path d="M9 15h6"/>
    <line x1="12" y1="2" x2="12" y2="4"/>
    <line x1="12" y1="20" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="4" y2="12"/>
    <line x1="20" y1="12" x2="22" y2="12"/>
  </svg>`,
  // Gear for Settings
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`,
};

function getIcon(activityId: string): string {
  return icons[activityId] || icons.welcome;
}
</script>

<template>
  <div class="activity-bar">
    <!-- Top activities -->
    <div class="activity-bar-top">
      <button
        v-for="activity in activitiesStore.topActivities"
        :key="activity.id"
        class="activity-button"
        :class="{ active: activitiesStore.currentActivityId === activity.id }"
        :title="activity.label"
        @click="activitiesStore.setActivity(activity.id)"
      >
        <span class="activity-icon" v-html="getIcon(activity.id)"></span>
      </button>
    </div>

    <!-- Spacer -->
    <div class="activity-bar-spacer"></div>

    <!-- Bottom activities -->
    <div class="activity-bar-bottom">
      <button
        v-for="activity in activitiesStore.bottomActivities"
        :key="activity.id"
        class="activity-button"
        :class="{ active: activitiesStore.currentActivityId === activity.id }"
        :title="activity.label"
        @click="activitiesStore.setActivity(activity.id)"
      >
        <span class="activity-icon" v-html="getIcon(activity.id)"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.activity-bar {
  width: 48px;
  background: var(--bg-secondary, #1e1e1e);
  border-right: 1px solid var(--border, #333);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.activity-bar-top {
  display: flex;
  flex-direction: column;
}

.activity-bar-spacer {
  flex: 1;
}

.activity-bar-bottom {
  display: flex;
  flex-direction: column;
}

.activity-button {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: background-color 0.15s;
}

.activity-button:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
}

.activity-button.active {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.08));
}

/* Active indicator (left border) */
.activity-button.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent, #0078d4);
}

.activity-icon {
  width: 24px;
  height: 24px;
  opacity: 0.6;
  transition: opacity 0.15s;
  color: var(--text, #ccc);
  display: flex;
  align-items: center;
  justify-content: center;
}

.activity-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.activity-button:hover .activity-icon,
.activity-button.active .activity-icon {
  opacity: 1;
  color: var(--text, #fff);
}

.activity-button.active .activity-icon {
  color: var(--accent, #4fc3f7);
}
</style>
