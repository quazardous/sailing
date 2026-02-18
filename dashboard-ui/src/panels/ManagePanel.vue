<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import { api } from '../api';
import type { PrdData, StatusesResponse } from '../api';
import StatusBadge from '../components/StatusBadge.vue';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const selectedType = computed(() => artefactsStore.selectedType);
const selectedId = computed(() => artefactsStore.selectedId);
const loading = computed(() => artefactsStore.loading);

const prdData = computed(() => {
  if (selectedType.value === 'prd' && selectedArtefact.value) {
    return selectedArtefact.value.data as PrdData;
  }
  return null;
});

const currentStatus = computed(() => {
  if (!selectedArtefact.value) return null;
  return (selectedArtefact.value.data as { status?: string }).status || null;
});

const isPrdDone = computed(() => prdData.value?.status === 'Done');

// --- Status change state ---
const statuses = ref<StatusesResponse | null>(null);
const newStatus = ref('');
const statusUpdating = ref(false);
const statusError = ref<string | null>(null);
const statusSuccess = ref<string | null>(null);

const availableStatuses = computed(() => {
  if (!statuses.value || !selectedType.value) return [];
  return statuses.value[selectedType.value] || [];
});

async function fetchStatuses() {
  try {
    statuses.value = await api.getStatuses();
  } catch {
    // Silently fail, statuses won't be available
  }
}

onMounted(fetchStatuses);

// Reset status form when selection changes
watch(selectedId, () => {
  newStatus.value = '';
  statusError.value = null;
  statusSuccess.value = null;
  // Also reset archive state
  showConfirm.value = false;
  confirmInput.value = '';
  archiveError.value = null;
  archiveSuccess.value = false;
});

async function changeStatus() {
  if (!selectedId.value || !newStatus.value) return;

  statusUpdating.value = true;
  statusError.value = null;
  statusSuccess.value = null;

  try {
    const result = await api.updateStatus(selectedId.value, newStatus.value);
    if (result.success) {
      statusSuccess.value = `Status updated to "${result.status}"`;
      newStatus.value = '';
      await artefactsStore.refresh();
    } else {
      statusError.value = result.error || 'Update failed';
    }
  } catch (e) {
    statusError.value = e instanceof Error ? e.message : 'Update failed';
  } finally {
    statusUpdating.value = false;
  }
}

// --- Archive state (PRD only) ---
const showConfirm = ref(false);
const confirmInput = ref('');
const archiving = ref(false);
const archiveError = ref<string | null>(null);
const archiveSuccess = ref(false);

function startArchive() {
  showConfirm.value = true;
  confirmInput.value = '';
  archiveError.value = null;
  archiveSuccess.value = false;
}

function cancelArchive() {
  showConfirm.value = false;
  confirmInput.value = '';
  archiveError.value = null;
}

async function confirmArchive() {
  if (!prdData.value) return;

  if (confirmInput.value !== prdData.value.id) {
    archiveError.value = `Type "${prdData.value.id}" to confirm`;
    return;
  }

  archiving.value = true;
  archiveError.value = null;

  try {
    const result = await api.archivePrd(prdData.value.id, confirmInput.value);
    if (result.success) {
      archiveSuccess.value = true;
      showConfirm.value = false;
      confirmInput.value = '';
      await artefactsStore.refresh();
    } else {
      archiveError.value = result.error || 'Archive failed';
    }
  } catch (e) {
    archiveError.value = e instanceof Error ? e.message : 'Archive failed';
  } finally {
    archiving.value = false;
  }
}

const confirmValid = computed(() =>
  prdData.value && confirmInput.value === prdData.value.id
);
</script>

<template>
  <div class="panel-container">
    <template v-if="loading && !selectedArtefact">
      <div class="loading">
        <div class="spinner"></div>
      </div>
    </template>

    <template v-else-if="!selectedArtefact">
      <div class="empty-state">
        <div class="empty-state-icon">&#x2699;</div>
        <div>Select an item to manage</div>
      </div>
    </template>

    <template v-else>
      <div class="manage-content">
        <!-- Status Change (all artefact types) -->
        <section class="manage-section">
          <h3 class="section-title">Status</h3>

          <div class="status-row">
            <span class="label">Current:</span>
            <StatusBadge :status="currentStatus || 'Unknown'" />
          </div>

          <div v-if="statusSuccess" class="message message-success">
            {{ statusSuccess }}
          </div>

          <div v-if="availableStatuses.length > 0" class="status-change">
            <div class="status-input-row">
              <select
                v-model="newStatus"
                class="select"
                :disabled="statusUpdating"
              >
                <option value="" disabled>Change to...</option>
                <option
                  v-for="s in availableStatuses"
                  :key="s"
                  :value="s"
                  :disabled="s === currentStatus"
                >
                  {{ s }}{{ s === currentStatus ? ' (current)' : '' }}
                </option>
              </select>
              <button
                class="btn btn-primary"
                :disabled="!newStatus || newStatus === currentStatus || statusUpdating"
                @click="changeStatus"
              >
                {{ statusUpdating ? 'Updating...' : 'Update' }}
              </button>
            </div>
            <div v-if="statusError" class="message message-error">
              {{ statusError }}
            </div>
          </div>
        </section>

        <!-- PRD Archive -->
        <template v-if="prdData">
          <section class="manage-section">
            <h3 class="section-title">Archive</h3>

            <template v-if="archiveSuccess">
              <div class="message message-success">
                {{ prdData.id }} has been archived successfully.
              </div>
            </template>

            <template v-else>
              <div class="archive-info">
                <p v-if="isPrdDone" class="hint">
                  This PRD is done and can be archived. Archiving moves the PRD
                  directory and its memory files to the archive folder.
                </p>
                <p v-else class="hint warning">
                  This PRD is not done yet. Only PRDs with status "Done" can be archived.
                </p>
              </div>

              <template v-if="!showConfirm">
                <button
                  class="btn btn-danger"
                  :disabled="!isPrdDone"
                  @click="startArchive"
                >
                  Archive PRD
                </button>
              </template>

              <template v-else>
                <div class="confirm-box">
                  <p class="confirm-prompt">
                    Type <strong>{{ prdData.id }}</strong> to confirm archive:
                  </p>
                  <div class="confirm-input-row">
                    <input
                      v-model="confirmInput"
                      type="text"
                      class="input"
                      :placeholder="prdData.id"
                      :disabled="archiving"
                      @keyup.enter="confirmArchive"
                    />
                    <button
                      class="btn btn-danger"
                      :disabled="!confirmValid || archiving"
                      @click="confirmArchive"
                    >
                      {{ archiving ? 'Archiving...' : 'Confirm Archive' }}
                    </button>
                    <button
                      class="btn btn-secondary"
                      :disabled="archiving"
                      @click="cancelArchive"
                    >
                      Cancel
                    </button>
                  </div>
                  <div v-if="archiveError" class="message message-error">
                    {{ archiveError }}
                  </div>
                </div>
              </template>
            </template>
          </section>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.manage-content {
  padding: var(--spacing-md);
}

.manage-section {
  margin-bottom: var(--spacing-lg);
}

.section-title {
  font-size: var(--font-size-base);
  margin: 0 0 var(--spacing-md) 0;
  color: var(--text);
}

.archive-info {
  margin-bottom: var(--spacing-md);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.label {
  color: var(--text-dim);
}

.hint {
  font-size: var(--font-size-sm);
  color: var(--text-dim);
  margin: var(--spacing-sm) 0;
  line-height: 1.4;
}

.hint.warning {
  color: var(--warning, #cca700);
}

.status-change {
  margin-top: var(--spacing-sm);
}

.status-input-row {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.select {
  max-width: 200px;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.select:focus {
  outline: none;
  border-color: var(--accent);
}

.btn {
  padding: var(--spacing-xs) var(--spacing-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent, #0078d4);
  color: #fff;
  border-color: var(--accent, #0078d4);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-danger {
  background: var(--error, #f44747);
  color: #fff;
  border-color: var(--error, #f44747);
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background: var(--bg-tertiary, #3c3c3c);
  color: var(--text);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--border);
}

.confirm-box {
  padding: var(--spacing-md);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.confirm-prompt {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: var(--font-size-sm);
  color: var(--text);
}

.confirm-input-row {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.input {
  max-width: 200px;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: inherit;
  font-size: var(--font-size-sm);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
}

.message {
  margin-top: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.message-success {
  background: rgba(0, 200, 83, 0.15);
  color: var(--success, #00c853);
  border: 1px solid rgba(0, 200, 83, 0.3);
}

.message-error {
  background: rgba(244, 71, 71, 0.15);
  color: var(--error, #f44747);
  border: 1px solid rgba(244, 71, 71, 0.3);
}
</style>
