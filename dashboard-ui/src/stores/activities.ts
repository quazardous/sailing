import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import { pushUrl, type ActivityType } from '../router';

export interface Activity {
  id: string;
  label: string;
  icon: string;
  sidebarComponent: string;  // Component name for sidebar
  allowedPanels: string[];   // Panel IDs allowed in main area
  position: 'top' | 'bottom';
}

const activities: Activity[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    icon: '🏴‍☠️',
    sidebarComponent: 'WelcomeSidebar',
    allowedPanels: ['welcome', 'prd-overview'],
    position: 'top',
  },
  {
    id: 'artefacts',
    label: 'Artefacts',
    icon: '📋',
    sidebarComponent: 'ArtefactsExplorer',
    allowedPanels: ['detail', 'stats', 'meta', 'gantt', 'dag'],
    position: 'top',
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: '🤖',
    sidebarComponent: 'AgentsExplorer',
    allowedPanels: ['agent-detail', 'logs'],
    position: 'top',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    sidebarComponent: 'SettingsSidebar',
    allowedPanels: ['settings'],
    position: 'bottom',
  },
];

export const useActivitiesStore = defineStore('activities', () => {
  const currentActivityId = ref<string>('welcome');

  // Load last activity from localStorage
  const savedActivity = localStorage.getItem('currentActivity');
  if (savedActivity && activities.find(a => a.id === savedActivity)) {
    currentActivityId.value = savedActivity;
  }

  const allActivities = computed(() => activities);

  const topActivities = computed(() =>
    activities.filter(a => a.position === 'top')
  );

  const bottomActivities = computed(() =>
    activities.filter(a => a.position === 'bottom')
  );

  const currentActivity = computed(() =>
    activities.find(a => a.id === currentActivityId.value) || activities[0]
  );

  interface SetActivityOptions {
    /** Skip pushing URL to history (used when navigating from URL) */
    skipPush?: boolean;
  }

  function setActivity(activityId: string, options: SetActivityOptions = {}) {
    const activity = activities.find(a => a.id === activityId);
    if (activity) {
      // Save current layout before switching
      saveCurrentLayout();

      currentActivityId.value = activityId;
      localStorage.setItem('currentActivity', activityId);

      // Push URL unless explicitly skipped (e.g., from popstate or initial load)
      if (!options.skipPush) {
        pushUrl({ activity: activityId as ActivityType });
      }
    }
  }

  // Layout persistence per activity
  function getLayoutKey(activityId: string): string {
    return `layout-${activityId}`;
  }

  function saveLayout(activityId: string, layout: object) {
    localStorage.setItem(getLayoutKey(activityId), JSON.stringify(layout));
  }

  function loadLayout(activityId: string): object | null {
    const saved = localStorage.getItem(getLayoutKey(activityId));
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Will be set by App.vue
  let saveCurrentLayoutFn: (() => void) | null = null;

  function registerSaveLayoutFn(fn: () => void) {
    saveCurrentLayoutFn = fn;
  }

  function saveCurrentLayout() {
    if (saveCurrentLayoutFn) {
      saveCurrentLayoutFn();
    }
  }

  return {
    currentActivityId,
    allActivities,
    topActivities,
    bottomActivities,
    currentActivity,
    setActivity,
    saveLayout,
    loadLayout,
    registerSaveLayoutFn,
    getLayoutKey,
  };
});
