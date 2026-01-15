# Architecture Contracts

## Layer Responsibilities

```
┌─────────────────────────────────────────────────────┐
│                    COMMANDS                          │
│  - CLI parsing (commander.js)                        │
│  - User interaction (prompts, output formatting)     │
│  - Error handling and display                        │
│  - Should NOT contain business logic                 │
└───────────────────────┬─────────────────────────────┘
                        │ calls
                        ▼
┌─────────────────────────────────────────────────────┐
│                    MANAGERS                          │
│  - Business/semantic logic                           │
│  - Config access (getAgentConfig, getGitConfig)      │
│  - Orchestration of multiple libs                    │
│  - Cross-domain coordination                         │
│  - CAN call other managers                           │
└───────────────────────┬─────────────────────────────┘
                        │ calls
                        ▼
┌─────────────────────────────────────────────────────┐
│                      LIBS                            │
│  - Pure technical operations                         │
│  - NO config access                                  │
│  - NO business logic                                 │
│  - Stateless functions                               │
│  - Accept config values as parameters                │
└─────────────────────────────────────────────────────┘
```

---

## Import Rules

### ✅ DO

```typescript
// Commands import from managers
import { reapAgent, buildAgentSpawnPrompt } from '../lib/managers/index.js';

// Or specific manager
import { composeContext } from '../lib/managers/compose-manager.js';

// Managers import from libs (for pure operations)
import { getBranchName, worktreeExists } from '../worktree.js';

// Managers import config
import { getAgentConfig } from '../config.js';
```

### ❌ DON'T

```typescript
// Commands should NOT import config-dependent functions from libs
import { buildAgentSpawnPrompt } from '../lib/compose.js';  // ❌ Wrong

// Libs should NOT import config
import { getAgentConfig } from './config.js';  // ❌ Wrong in lib
```

---

## Manager Contracts

### `agent-manager`
**Domain**: Agent lifecycle
**Config**: `getAgentConfig()` (merge_strategy)

| Function | Purpose |
|----------|---------|
| `reapAgent(taskId, options)` | Wait, merge, update status |
| `waitForAgent(taskId, timeout)` | Wait for completion |
| `killAgent(taskId)` | Terminate process |
| `rejectAgent(taskId, reason)` | Discard work |
| `clearAgent(taskId)` | Remove from state |
| `mergeAgentWork(taskId, strategy)` | Merge to main |
| `checkMergeConflicts(taskId)` | Check for conflicts |
| `autoCommitChanges(taskId)` | Commit uncommitted |

### `compose-manager`
**Domain**: Prompt/context composition
**Config**: `getAgentConfig()` (use_subprocess, use_worktrees, sandbox)

| Function | Purpose |
|----------|---------|
| `composeContext(options)` | Build context for operation |
| `composeAgentContext(operation)` | Agent role context |
| `buildAgentSpawnPrompt(taskId)` | Full spawn prompt |
| `getExecMode()` | 'inline' or 'subprocess' |

### `worktree-manager`
**Domain**: Git worktree operations
**Config**: `getGitConfig()` (main_branch), `getConfigValue()` (sync_before_spawn)

| Function | Purpose |
|----------|---------|
| `getMainBranch()` | Configured main branch |
| `createWorktree(taskId)` | Create isolated worktree |
| `removeWorktree(taskId)` | Remove worktree |
| `cleanupWorktree(taskId)` | Full cleanup (+ branches) |
| `syncParentBranch(context)` | Sync before spawn |
| `getParentBranch(taskId, context)` | Get parent for branching |

### `pr-manager`
**Domain**: PR/MR operations
**Config**: `getAgentConfig()` (pr_provider)

| Function | Purpose |
|----------|---------|
| `getProvider(cwd)` | Configured or detected provider |
| `create(taskId, options)` | Create PR |
| `getStatus(branch, cwd)` | Get PR status |
| `isMerged(branch, cwd)` | Check if merged |

### `config-manager`
**Domain**: Configuration semantic accessors
**Config**: `loadConfig()` from lib/config.ts

| Function | Purpose |
|----------|---------|
| `getAgentConfig()` | Get agent section |
| `getGitConfig()` | Get git section |
| `getIdsConfig()` | Get IDs section |
| `getConfigValue(key)` | Get arbitrary config value |
| `formatId(prefix, num)` | Format ID with configured digits |
| `validateConfigCoherence()` | Validate config coherence |
| `getConfigDisplay()` | Get config for display |

### `status-manager`
**Domain**: Status transition orchestration
**Config**: None (uses lib functions)

| Function | Purpose |
|----------|---------|
| `escalateOnTaskStart(taskData)` | Auto-escalate Epic/PRD when task starts |
| `cascadeTaskCompletion(taskId, taskData)` | Cascade Done → Epic Auto-Done → PRD Auto-Done |
| `escalateEpicToInProgress(epicId)` | Escalate single Epic |
| `escalatePrdToInProgress(parent)` | Escalate single PRD |
| `checkAndUpdateEpicAutoDone(epicId)` | Check if Epic should be Auto-Done |
| `checkAndUpdatePrdAutoDone(parent)` | Check if PRD should be Auto-Done |

### `memory-manager`
**Domain**: Memory and log operations
**Config**: None (uses lib/memory.ts)

| Function | Purpose |
|----------|---------|
| `checkPendingMemory(epicId?)` | Check for logs needing consolidation |
| `mergeEpicTaskLogs(epicId, options)` | Merge task logs into epic log |
| `countTaskTips(taskId)` | Count TIP entries in task log |
| `getLogStats(id)` | Get log statistics |
| `deleteEpicLog(epicId)` | Delete epic log file |
| `getEpicLogContent(epicId)` | Get epic log content |

---

## Lib Contracts (Pure Functions)

### `lib/artefacts.ts` ⚠️ CRITICAL - SINGLE ENTRY POINT
**NO config access** - Pure indexing and lookup library

```typescript
// ⚠️ MANDATORY CONTRACT:
// This is the ONLY authorized way to access tasks, epics, PRDs.
// DO NOT use findFiles() or direct filesystem access for artefacts.

import { getTask, getEpic, getPrd } from './artefacts.js';

// Build indexes (cached)
buildTaskIndex()              // → Map<string, TaskIndexEntry>
buildEpicIndex()              // → Map<string, EpicIndexEntry>
buildPrdIndex()               // → Map<number, PrdIndexEntry>
buildMemoryIndex()            // → Map<string, MemoryEntry>

// Lookup functions (format-agnostic: T39, T039, T00039 all work)
getTask(taskId)               // → TaskIndexEntry | null
getEpic(epicId)               // → EpicIndexEntry | null
getPrd(prdId)                 // → PrdIndexEntry | null

// Parent lookups
getTaskEpic(taskId)           // → { epicId, epicKey, title } | null
getEpicPrd(epicId)            // → { prdId, prdNum } | null

// Full entity loading
getFullPrd(prdId)             // → FullPrd with epics & tasks
getAllFullPrds()              // → FullPrd[]

// Cache management
clearIndexCache()             // Invalidate all caches
```

**⚠️ VIOLATIONS TO FIX** (code that bypasses artefacts.ts):
- `findFiles(tasksDir)` → use `buildTaskIndex()` or add `getAllTasks()`
- `findFiles(epicsDir)` → use `buildEpicIndex()` or add `getAllEpics()`
- Direct `fs.readdirSync()` on tasks/epics directories

**Changes require careful testing across the codebase.**

### `lib/worktree.ts`
**NO config access** - accepts `mainBranch` via `context.mainBranch`

```typescript
// Pure functions - use directly
getBranchName(taskId)           // → 'task/T001'
getWorktreePath(taskId)         // → '/path/to/worktrees/T001'
worktreeExists(taskId)          // → boolean
branchExists(branchName)        // → boolean
listWorktrees()                 // → WorktreeInfo[]
```

### `lib/compose.ts`
**NO config access** - uses `composeContextCore()` with explicit params

```typescript
// Core functions - called by manager
composeContextCore(options)     // options.mode, options.useWorktrees required
buildPromptCore(taskId, opts)   // opts.useWorktree, opts.sandbox required
resolveInject(roleDef, mode, useWorktrees)  // explicit param
```

### `lib/git-forge.ts`
**NO config access** - uses `detectProvider()` for auto-detection

```typescript
// Pure functions
detectProvider(cwd)             // Auto-detect from git remote
checkCli(provider)              // Check if gh/glab available
getStatus(branch, cwd, provider)// Get PR status
create(taskId, { provider })    // Create PR (provider optional)
```

---

## Adding a New Manager

1. Create `lib/managers/<domain>-manager.ts`
2. Move config-dependent logic from lib to manager
3. Refactor lib to accept config as parameters
4. Update lib header: "Config-dependent logic is in managers/..."
5. Export from `managers/index.ts`
6. Update imports in commands

---

## Testing Contracts

```bash
# Check for config access in libs (should return ONLY managers)
grep -r "getAgentConfig\|getGitConfig" cli/lib/*.ts | grep -v config.ts
# Expected: empty (all config in managers now)

# Verify managers have config access
grep -r "getAgentConfig\|getGitConfig" cli/lib/managers/*.ts
# Expected: agent-manager, compose-manager, worktree-manager, pr-manager
```

---

## Lib Contracts (Pure Functions)

### `lib/claude.ts`
**NO config access** - accepts config values as explicit parameters

```typescript
// spawnClaude requires config values to be passed explicitly
spawnClaude({
  prompt, cwd, logFile,
  riskyMode: config.risky_mode,      // ← from caller
  sandbox: config.sandbox,            // ← from caller
  maxBudgetUsd: config.max_budget_usd,
  watchdogTimeout: config.watchdog_timeout
})
```

### `lib/git.ts`
**NO config access** - pure simple-git wrapper

```typescript
// getMainBranch() removed - use worktree-manager instead
import { getMainBranch } from './managers/worktree-manager.js';
```

### `lib/config.ts`
**Technical layer** - load, parse, validate, schema

```typescript
// Technical operations only
loadConfig()                    // Load and cache config
CONFIG_SCHEMA                   // Schema definition
validateConfig()                // Internal validation
getSchema()                     // Get schema for tooling
getDefaults()                   // Get default values
clearConfigCache()              // Clear cache
parseConfigOverride()           // Parse CLI override

// Re-exports from config-manager (backward compat)
// Commands should prefer importing from managers/config-manager.ts
```
