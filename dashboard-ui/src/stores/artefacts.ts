/**
 * Artefacts Store
 *
 * Manages PRDs, Epics, and Tasks state.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api';
import type { PrdData, EpicData, TaskData, ArtefactResponse, ArtefactType } from '../api';
import { useNotificationsStore } from './notifications';
import { pushUrl } from '../router';

interface SelectOptions {
  /** Skip pushing URL to history (used when navigating from URL) */
  skipPush?: boolean;
}

export const useArtefactsStore = defineStore('artefacts', () => {
  // State
  const prds = ref<PrdData[]>([]);
  const selectedId = ref<string | null>(null);
  const selectedArtefact = ref<ArtefactResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastRefresh = ref<number>(Date.now()); // For forcing re-renders

  // Computed
  const selectedType = computed<ArtefactType | null>(() => {
    if (!selectedId.value) return null;
    if (selectedId.value.startsWith('PRD-')) return 'prd';
    if (selectedId.value.startsWith('E')) return 'epic';
    if (selectedId.value.startsWith('T')) return 'task';
    return null;
  });

  const totalTasks = computed(() =>
    prds.value.reduce((acc, prd) => acc + prd.totalTasks, 0)
  );

  const doneTasks = computed(() =>
    prds.value.reduce((acc, prd) => acc + prd.doneTasks, 0)
  );

  const overallProgress = computed(() =>
    totalTasks.value > 0
      ? Math.round((doneTasks.value / totalTasks.value) * 100)
      : 0
  );

  const blockedItems = computed(() => {
    const blocked: Array<{ id: string; title: string; type: ArtefactType }> = [];

    for (const prd of prds.value) {
      if (prd.status === 'Blocked') {
        blocked.push({ id: prd.id, title: prd.title, type: 'prd' });
      }
      for (const epic of (prd.epics || [])) {
        if (epic.status === 'Blocked') {
          blocked.push({ id: epic.id, title: epic.title, type: 'epic' });
        }
        for (const task of (epic.tasks || [])) {
          if (task.status === 'Blocked') {
            blocked.push({ id: task.id, title: task.title, type: 'task' });
          }
        }
      }
    }

    return blocked;
  });

  // Actions
  async function fetchTree(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.getTree();
      prds.value = response.prds;
      lastRefresh.value = Date.now(); // Trigger reactivity

      // Debug: check if timestamps are present
      if (response.prds.length > 0) {
        const prd = response.prds[0];
        console.log(`[ArtefactsStore] Sample PRD timestamps: createdAt=${prd.createdAt}, modifiedAt=${prd.modifiedAt}`);
        if (prd.epics && prd.epics.length > 0) {
          const epic = prd.epics[0];
          console.log(`[ArtefactsStore] Sample Epic timestamps: createdAt=${epic.createdAt}, modifiedAt=${epic.modifiedAt}`);
        }
      }

      // Update "new" flags based on timestamps
      updateNewFlags();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tree';
      console.error('[ArtefactsStore] fetchTree error:', e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Extract all artefacts with timestamps and update notifications
   */
  function updateNewFlags(): void {
    const notificationsStore = useNotificationsStore();
    const artefacts: Array<{ id: string; createdAt?: string; modifiedAt?: string }> = [];

    for (const prd of prds.value) {
      artefacts.push({
        id: prd.id,
        createdAt: prd.createdAt,
        modifiedAt: prd.modifiedAt,
      });
      for (const epic of (prd.epics || [])) {
        artefacts.push({
          id: epic.id,
          createdAt: epic.createdAt,
          modifiedAt: epic.modifiedAt,
        });
        for (const task of (epic.tasks || [])) {
          artefacts.push({
            id: task.id,
            createdAt: task.createdAt,
            modifiedAt: task.modifiedAt,
          });
        }
      }
    }

    notificationsStore.updateNewArtefacts(artefacts);
  }

  async function selectArtefact(id: string, options: SelectOptions = {}): Promise<void> {
    // Mark as viewed (clear "new" flag)
    useNotificationsStore().markViewed(id);

    if (selectedId.value === id && selectedArtefact.value) {
      // Already selected, but still push URL if needed
      if (!options.skipPush) {
        pushUrl({ activity: 'artefacts', selectedId: id });
      }
      return;
    }

    selectedId.value = id;
    loading.value = true;
    error.value = null;

    // Push URL unless explicitly skipped (e.g., from popstate or initial load)
    if (!options.skipPush) {
      pushUrl({ activity: 'artefacts', selectedId: id });
    }

    try {
      selectedArtefact.value = await api.getArtefact(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch artefact';
      console.error('[ArtefactsStore] selectArtefact error:', e);
    } finally {
      loading.value = false;
    }
  }

  function clearSelection(): void {
    selectedId.value = null;
    selectedArtefact.value = null;
  }

  function findEpic(epicId: string): { epic: EpicData; prd: PrdData } | null {
    for (const prd of prds.value) {
      const epic = (prd.epics || []).find((e) => e.id === epicId);
      if (epic) {
        return { epic, prd };
      }
    }
    return null;
  }

  function findTask(taskId: string): { task: TaskData; epic: EpicData; prd: PrdData } | null {
    for (const prd of prds.value) {
      for (const epic of (prd.epics || [])) {
        const task = (epic.tasks || []).find((t) => t.id === taskId);
        if (task) {
          return { task, epic, prd };
        }
      }
    }
    return null;
  }

  async function refresh(): Promise<void> {
    console.log('[ArtefactsStore] refresh() called');

    // Note: Cache is already cleared by the watcher on file changes
    // We just need to re-fetch the data
    await fetchTree();
    console.log('[ArtefactsStore] fetchTree() done, prds count:', prds.value.length);

    // Refresh selected artefact if any (force re-fetch)
    if (selectedId.value) {
      await refetchSelectedArtefact();
    }
  }

  /**
   * Force re-fetch the currently selected artefact
   */
  async function refetchSelectedArtefact(): Promise<void> {
    if (!selectedId.value) return;

    loading.value = true;
    error.value = null;

    try {
      selectedArtefact.value = await api.getArtefact(selectedId.value);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch artefact';
      console.error('[ArtefactsStore] refetchSelectedArtefact error:', e);
    } finally {
      loading.value = false;
    }
  }

  return {
    // State
    prds,
    selectedId,
    selectedArtefact,
    loading,
    error,
    lastRefresh,
    // Computed
    selectedType,
    totalTasks,
    doneTasks,
    overallProgress,
    blockedItems,
    // Actions
    fetchTree,
    selectArtefact,
    clearSelection,
    findEpic,
    findTask,
    refresh,
  };
});
