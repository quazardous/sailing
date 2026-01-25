/**
 * Notifications Store
 *
 * Tracks artefact states like "new" (updated but not viewed).
 * Uses localStorage to persist viewedAt timestamps.
 * Storage is project-scoped.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { loadFromStorage, saveToStorage } from '../utils/storage';

const STORAGE_KEY = 'viewed-at';

interface ViewedAtMap {
  [artefactId: string]: string; // ISO date string
}

export const useNotificationsStore = defineStore('notifications', () => {
  // Map of artefact ID -> last viewed timestamp (ISO string)
  const viewedAt = ref<ViewedAtMap>({});
  let initialized = false;

  // Count of new artefacts (computed from current tree, needs external call)
  const newArtefactsSet = ref<Set<string>>(new Set());
  const newCount = computed(() => newArtefactsSet.value.size);

  /**
   * Initialize from storage (called after project is loaded)
   */
  function init(): void {
    if (initialized) return;
    viewedAt.value = loadFromStorage<ViewedAtMap>(STORAGE_KEY, {});
    initialized = true;
    console.log(`[Notifications] Loaded ${Object.keys(viewedAt.value).length} viewedAt entries`);
  }

  /**
   * Save viewedAt map to localStorage
   */
  function persist(): void {
    saveToStorage(STORAGE_KEY, viewedAt.value);
  }

  /**
   * Check if an artefact is "new" based on its timestamps
   * Returns true if createdAt or modifiedAt is after the last viewedAt
   */
  function isNew(id: string, createdAt?: string, modifiedAt?: string): boolean {
    if (!createdAt && !modifiedAt) {
      return false;
    }

    const lastViewed = viewedAt.value[id];
    if (!lastViewed) {
      // Never viewed = new
      return true;
    }

    const lastViewedDate = new Date(lastViewed).getTime();
    const createdDate = createdAt ? new Date(createdAt).getTime() : 0;
    const modifiedDate = modifiedAt ? new Date(modifiedAt).getTime() : 0;

    // New if created or modified after last viewed
    return createdDate > lastViewedDate || modifiedDate > lastViewedDate;
  }

  /**
   * Mark artefact as viewed (update viewedAt to now)
   */
  function markViewed(id: string): void {
    viewedAt.value[id] = new Date().toISOString();
    persist();
    // Update the set
    newArtefactsSet.value.delete(id);
    newArtefactsSet.value = new Set(newArtefactsSet.value);
  }

  /**
   * Update the set of new artefacts based on tree data
   * Called when tree is loaded/refreshed
   */
  function updateNewArtefacts(artefacts: Array<{ id: string; createdAt?: string; modifiedAt?: string }>): void {
    const newSet = new Set<string>();
    for (const artefact of artefacts) {
      const artefactIsNew = isNew(artefact.id, artefact.createdAt, artefact.modifiedAt);
      if (artefactIsNew) {
        newSet.add(artefact.id);
      }
      // Debug first few artefacts
      if (artefacts.indexOf(artefact) < 5) {
        console.log(`[Notifications] ${artefact.id}: viewedAt=${viewedAt.value[artefact.id] || 'never'}, modifiedAt=${artefact.modifiedAt}, isNew=${artefactIsNew}`);
      }
    }
    console.log(`[Notifications] updateNewArtefacts: ${newSet.size} new out of ${artefacts.length}`);
    newArtefactsSet.value = newSet;
  }

  /**
   * Check if artefact is in the new set (for tree rendering)
   */
  function isInNewSet(id: string): boolean {
    return newArtefactsSet.value.has(id);
  }

  /**
   * Clear all viewed timestamps (mark everything as new)
   */
  function clearAll(): void {
    viewedAt.value = {};
    persist();
  }

  /**
   * Legacy: Mark as new (for WebSocket updates)
   * Adds to the new set without changing viewedAt
   */
  function markNew(ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => {
      if (id && id !== '*') {
        newArtefactsSet.value.add(id);
      }
    });
    newArtefactsSet.value = new Set(newArtefactsSet.value);
  }

  return {
    // State
    viewedAt,
    newArtefacts: newArtefactsSet, // Keep for compatibility
    newCount,
    // Actions
    init,
    isNew,
    isInNewSet,
    markViewed,
    markNew,
    updateNewArtefacts,
    clearAll,
  };
});
