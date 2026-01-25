/**
 * Project Store - Manages project info
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api/client';
import type { ProjectInfo } from '../api/types';
import { setProjectPath } from '../utils/storage';

export const useProjectStore = defineStore('project', () => {
  const project = ref<ProjectInfo | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const projectName = computed(() => project.value?.name || 'Sailing');
  const projectPath = computed(() => project.value?.relativePath || '');

  // Actions
  async function fetchProject(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      project.value = await api.getProject();
      // Set project path for storage keys
      setProjectPath(project.value.path);
      // Update document title
      document.title = `Sailing: ${project.value.relativePath}`;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch project info';
      console.error('[ProjectStore] Error:', e);
    } finally {
      loading.value = false;
    }
  }

  return {
    project,
    loading,
    error,
    projectName,
    projectPath,
    fetchProject,
  };
});
