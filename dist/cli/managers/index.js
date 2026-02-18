/**
 * Managers Index
 *
 * RULE: Commands should import from managers, NOT directly from libs.
 *
 * Managers handle:
 * - Config access (getAgentConfig, getGitConfig, etc.)
 * - Business logic and orchestration
 * - Cross-domain coordination
 *
 * Libs handle:
 * - Pure technical operations
 * - No config access
 * - Stateless functions
 *
 * Architecture:
 *   Commands → Managers → Libs
 *                 ↓
 *              Config
 */
// Agent lifecycle (spawn, reap, kill, etc.)
export * from './agent-manager.js';
// Prompt/context composition
export { composeContext, composeAgentContext, buildAgentSpawnPrompt, getExecMode, resolveInject, loadWorkflowsConfig, loadFragment, loadProjectFile } from './compose-manager.js';
// Git worktree operations
export { createWorktree, removeWorktree, cleanupWorktree, getParentBranch, ensureBranchHierarchy, getBranchHierarchy, syncParentBranch, syncUpwardHierarchy, 
// Config-aware wrappers
getWorktreePath, getBranchName, listWorktrees, listAgentWorktrees, pruneWorktrees, getWorktreeStatus, worktreeExists, branchExists, syncBranch, getBranchDivergence } from './worktree-manager.js';
// PR/MR operations
export { getProvider, create as createPr, getStatus as getPrStatus, detectProvider, checkCli, exists as prExists, isMerged, getUrlFromDb } from './pr-manager.js';
// Config semantic accessors (from core-manager)
export { getAgentConfig, getGitConfig, getMainBranch, getIdsConfig, getConfigValue, formatId, validateConfigCoherence, getConfigDisplay, getWorktreesDir, findProjectRoot } from './core-manager.js';
// Status transition orchestration
export { escalateOnTaskStart, cascadeTaskCompletion, escalateEpicToInProgress, escalatePrdToInProgress, checkAndUpdateEpicAutoDone, checkAndUpdatePrdAutoDone } from './status-manager.js';
// Memory and log operations
export { checkPendingMemory, countTaskTips, getLogStats, getEpicMemory, EpicMemoryManager } from './memory-manager.js';
// Archive operations
export { archivePrd, getDonePrds, isPrdDone, getPrdStatus } from './archive-manager.js';
// ADR (Architecture Decision Records)
export { getAdrDir, getAllAdrs, getAdr, getFullAdr, createAdr, updateAdrStatus, getAdrsByStatus, getAdrsByDomain, getAdrsByTags, getAcceptedAdrs, getRelevantAdrs, normalizeAdrId, formatAdrLine, formatAdrsForPrompt } from './adr-manager.js';
