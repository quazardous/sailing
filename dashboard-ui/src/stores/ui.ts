/**
 * UI Store
 *
 * Manages layout and UI preferences.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

type Theme = 'dark' | 'light';
export type GanttZoomMode = 'hour' | 'day' | 'week';

interface LayoutState {
  // Dockview layout JSON
  layout: unknown;
  savedAt: string;
}

const LAYOUT_STORAGE_KEY = 'rudder-dashboard-layout';
const THEME_STORAGE_KEY = 'rudder-dashboard-theme';
const GANTT_ZOOM_STORAGE_KEY = 'rudder-dashboard-gantt-zoom';

export const useUiStore = defineStore('ui', () => {
  // State
  const theme = ref<Theme>('dark');
  const sidebarCollapsed = ref(false);
  const layoutLoaded = ref(false);
  const ganttZoomMode = ref<GanttZoomMode>('day');

  // Initialize theme from localStorage
  function initTheme(): void {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      theme.value = stored;
    } else {
      // Detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme.value = prefersDark ? 'dark' : 'light';
    }
    applyTheme();
  }

  function setTheme(newTheme: Theme): void {
    theme.value = newTheme;
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    applyTheme();
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  function applyTheme(): void {
    document.documentElement.setAttribute('data-theme', theme.value);
  }

  // Layout persistence
  function saveLayout(layout: unknown): void {
    const state: LayoutState = {
      layout,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[UiStore] Failed to save layout:', e);
    }
  }

  function loadLayout(): unknown | null {
    try {
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored) as LayoutState;
        layoutLoaded.value = true;
        return state.layout;
      }
    } catch (e) {
      console.warn('[UiStore] Failed to load layout:', e);
    }
    return null;
  }

  function clearLayout(): void {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    layoutLoaded.value = false;
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  // Gantt zoom mode persistence
  function initGanttZoom(): void {
    const stored = localStorage.getItem(GANTT_ZOOM_STORAGE_KEY);
    if (stored === 'hour' || stored === 'day' || stored === 'week') {
      ganttZoomMode.value = stored;
    }
  }

  function setGanttZoomMode(mode: GanttZoomMode): void {
    ganttZoomMode.value = mode;
    localStorage.setItem(GANTT_ZOOM_STORAGE_KEY, mode);
  }

  // Initialize on store creation
  initTheme();
  initGanttZoom();

  return {
    // State
    theme,
    sidebarCollapsed,
    layoutLoaded,
    ganttZoomMode,
    // Actions
    setTheme,
    toggleTheme,
    saveLayout,
    loadLayout,
    clearLayout,
    toggleSidebar,
    setGanttZoomMode,
  };
});
