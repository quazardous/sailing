/**
 * Tree State Store
 *
 * Persists expanded/collapsed state of tree nodes in localStorage.
 * State is project-scoped using a hash of the project path.
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { loadFromStorage, saveToStorage } from '../utils/storage';

const STORAGE_KEY = 'tree-expanded';

export const useTreeStateStore = defineStore('treeState', () => {
  // Set of expanded node IDs
  const expandedIds = ref<Set<string>>(new Set());

  // Track if initialized (loaded from storage)
  const initialized = ref(false);

  /**
   * Load state from localStorage
   */
  function loadState(): void {
    const stored = loadFromStorage<string[]>(STORAGE_KEY, []);
    expandedIds.value = new Set(stored);
    initialized.value = true;
    console.log(`[TreeState] Loaded ${expandedIds.value.size} expanded nodes`);
  }

  /**
   * Save state to localStorage
   */
  function saveState(): void {
    if (!initialized.value) return;
    saveToStorage(STORAGE_KEY, Array.from(expandedIds.value));
  }

  // Auto-save when expandedIds changes
  watch(expandedIds, () => {
    saveState();
  }, { deep: true });

  /**
   * Check if a node is expanded
   */
  function isExpanded(id: string): boolean {
    // If not initialized yet, default to expanded
    if (!initialized.value) return true;
    return expandedIds.value.has(id);
  }

  /**
   * Toggle a node's expanded state
   */
  function toggle(id: string): void {
    if (expandedIds.value.has(id)) {
      expandedIds.value.delete(id);
    } else {
      expandedIds.value.add(id);
    }
    // Trigger reactivity
    expandedIds.value = new Set(expandedIds.value);
  }

  /**
   * Set expanded state for a node
   */
  function setExpanded(id: string, expanded: boolean): void {
    if (expanded) {
      expandedIds.value.add(id);
    } else {
      expandedIds.value.delete(id);
    }
    expandedIds.value = new Set(expandedIds.value);
  }

  /**
   * Expand all nodes (called on first load if no state)
   */
  function expandAll(ids: string[]): void {
    ids.forEach(id => expandedIds.value.add(id));
    expandedIds.value = new Set(expandedIds.value);
  }

  /**
   * Collapse all nodes
   */
  function collapseAll(): void {
    expandedIds.value.clear();
    expandedIds.value = new Set(expandedIds.value);
  }

  return {
    expandedIds,
    initialized,
    loadState,
    isExpanded,
    toggle,
    setExpanded,
    expandAll,
    collapseAll,
  };
});
