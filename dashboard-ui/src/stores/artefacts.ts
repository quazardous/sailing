/**
 * Artefacts Store
 *
 * Manages PRDs, Epics, and Tasks state.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api';
import type { PrdData, EpicData, TaskData, ArtefactResponse, ArtefactType } from '../api';

export const useArtefactsStore = defineStore('artefacts', () => {
  // State
  const prds = ref<PrdData[]>([]);
  const selectedId = ref<string | null>(null);
  const selectedArtefact = ref<ArtefactResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
      for (const epic of prd.epics) {
        if (epic.status === 'Blocked') {
          blocked.push({ id: epic.id, title: epic.title, type: 'epic' });
        }
        for (const task of epic.tasks) {
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
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tree';
      console.error('[ArtefactsStore] fetchTree error:', e);
    } finally {
      loading.value = false;
    }
  }

  async function selectArtefact(id: string): Promise<void> {
    if (selectedId.value === id && selectedArtefact.value) {
      return; // Already selected
    }

    selectedId.value = id;
    loading.value = true;
    error.value = null;

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
      const epic = prd.epics.find((e) => e.id === epicId);
      if (epic) {
        return { epic, prd };
      }
    }
    return null;
  }

  function findTask(taskId: string): { task: TaskData; epic: EpicData; prd: PrdData } | null {
    for (const prd of prds.value) {
      for (const epic of prd.epics) {
        const task = epic.tasks.find((t) => t.id === taskId);
        if (task) {
          return { task, epic, prd };
        }
      }
    }
    return null;
  }

  async function refresh(): Promise<void> {
    await api.refresh();
    await fetchTree();

    // Refresh selected artefact if any
    if (selectedId.value) {
      await selectArtefact(selectedId.value);
    }
  }

  return {
    // State
    prds,
    selectedId,
    selectedArtefact,
    loading,
    error,
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
