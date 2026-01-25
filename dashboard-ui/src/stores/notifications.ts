/**
 * Notifications Store
 *
 * Tracks artefact states like "new" (updated but not viewed).
 * Extensible for other notification types.
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useNotificationsStore = defineStore('notifications', () => {
  // Set of artefact IDs that have been updated but not viewed
  const newArtefacts = ref<Set<string>>(new Set());

  // Count of new artefacts
  const newCount = computed(() => newArtefacts.value.size);

  /**
   * Mark artefact(s) as new (updated but not viewed)
   */
  function markNew(ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => {
      if (id && id !== '*') {
        newArtefacts.value.add(id);
      }
    });
    // Trigger reactivity
    newArtefacts.value = new Set(newArtefacts.value);
  }

  /**
   * Mark all artefacts as new (wildcard update)
   * Used when we don't know which specific artefact changed
   */
  function markAllNew(artefactIds: string[]): void {
    artefactIds.forEach(id => newArtefacts.value.add(id));
    newArtefacts.value = new Set(newArtefacts.value);
  }

  /**
   * Clear new flag when artefact is viewed
   */
  function markViewed(id: string): void {
    if (newArtefacts.value.has(id)) {
      newArtefacts.value.delete(id);
      newArtefacts.value = new Set(newArtefacts.value);
    }
  }

  /**
   * Check if artefact is new
   */
  function isNew(id: string): boolean {
    return newArtefacts.value.has(id);
  }

  /**
   * Clear all new flags
   */
  function clearAll(): void {
    newArtefacts.value = new Set();
  }

  return {
    // State
    newArtefacts,
    newCount,
    // Actions
    markNew,
    markAllNew,
    markViewed,
    isNew,
    clearAll,
  };
});
