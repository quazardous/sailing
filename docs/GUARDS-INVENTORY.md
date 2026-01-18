# Guards & Post-Prompts Inventory

Ce document recense les guards existants (logique de prévention) et les post-prompts (recommendations) à migrer vers le système LiquidJS.

## Légende

- **Guard** : Condition qui bloque l'exécution (`process.exit(1)`)
- **Post-prompt** : Message de recommendation après une action
- **Role** : Qui peut exécuter (agent, skill, coordinator)
- **Escalate** : Bloque avec `next_steps[]` pour l'utilisateur

---

## 1. agent:spawn

**Source** : `cli/commands/agent/spawn.ts`

### Guards existants

| ID | Condition | Message | Actions |
|----|-----------|---------|---------|
| `role_denied` | `role === 'agent'` | "agent:spawn cannot be called with --role agent" | - |
| `subprocess_disabled` | `!config.use_subprocess` | "agent:spawn is disabled" | "Use Task tool with context:load" |
| `task_not_found` | `!taskFile` | "Task not found: {taskId}" | - |
| `prd_epic_missing` | `!prdId \|\| !epicId` | "Could not extract PRD/Epic IDs" | - |
| `mcp_not_running` | `!mcpStatus.running` | "MCP server not running" | `bin/rudder-mcp start` |
| `agent_running` | `existingAgent && isRunning` | "Agent {taskId} is still running" | `agent:wait`, `agent:kill`, `agent:reap` |
| `unmerged_work` | `existingAgent && (isDirty \|\| commitsAhead)` | "Agent {taskId} has unmerged work" | `--resume`, `agent:reap`, `agent:reject` |
| `uncommitted_main` | `worktree && !gitStatus.isClean()` | "Working directory has uncommitted changes" | Escalate |
| `no_commits` | `worktree && repoLog.total === 0` | "No commits in repository" | Escalate |
| `not_git_repo` | `worktree && !isRepo` | "use_worktrees requires a git repository" | Escalate |
| `orphaned_worktree` | `worktreeExists && hasWork && !resume` | "Orphaned worktree exists" | `--resume`, `agent:sync`, `agent:reject` |

### Post-prompts existants

| Trigger | Message | Actions |
|---------|---------|---------|
| `exitCode !== 0` | "Next steps:" | `agent:log`, `agent:reject` |
| `reapResult.escalate` | "Reap failed: {reason}" | `agent:reap` |
| `auto_diagnose && errors` | "STOP - Action required" | `agent:log-noise-add-filter`, escalate |

### Variables runtime

```yaml
vars:
  taskId: { type: string, required: true }
  role: { type: string }
  gitClean: { type: boolean }
  hasCommits: { type: boolean }
  isGitRepo: { type: boolean }
  existingAgent: { type: object }
  mcpRunning: { type: boolean }
  worktreeExists: { type: boolean }
  isDirty: { type: boolean }
  commitsAhead: { type: number }
```

---

## 2. worktree:merge

**Source** : `cli/commands/worktree.ts:669-894`

### Guards existants

| ID | Condition | Message | Actions |
|----|-----------|---------|---------|
| `agent_not_found` | `!agentInfo` | "No agent found for task" | - |
| `no_worktree` | `!agentInfo.worktree` | "Task has no worktree" | - |
| `worktree_missing` | `!fs.existsSync(worktreePath)` | "Worktree not found" | - |
| `parent_not_found` | `!branchExists(parentBranch)` | "Parent branch not found" | "Create it first" |
| `uncommitted_changes` | `status !== ''` | "Worktree has uncommitted changes" | "Commit first or agent:reject" |
| `invalid_strategy` | `!validStrategies.includes(strategy)` | "Invalid merge strategy" | List valid strategies |
| `merge_failed` | `merge error` | "Merge failed: {error}" | `/dev:merge skill` |

### Post-prompts existants

| Trigger | Message |
|---------|---------|
| `branching === 'epic'` | "Next: When epic complete, merge epic/{epicId} to prd/{prdId}" |
| `branching === 'prd'` | "Next: When PRD complete, merge prd/{prdId} to main" |

### Variables runtime

```yaml
vars:
  taskId: { type: string, required: true }
  branch: { type: string, required: true }
  parentBranch: { type: string, required: true }
  strategy: { type: string }
  uncommittedCount: { type: number }
  branching: { type: string }  # flat|epic|prd
```

---

## 3. worktree:preflight

**Source** : `cli/commands/worktree.ts:342-457`

### Guards existants (retournés comme blockers)

| ID | Condition | Message |
|----|-----------|---------|
| `uncommitted_main` | `!mainStatus.clean` | "Main branch has N uncommitted changes" |
| `no_commits` | `git rev-parse HEAD fails` | "No commits in repository" |

### Post-prompts (warnings/recommendations)

| Trigger | Message | Action |
|---------|---------|--------|
| `mainStatus.behind > 0` | "Main branch is N commits behind" | `git pull` |
| `pendingMerges.length > 0` | "Pending merges: ..." | `rudder worktree:merge` |
| `conflictMatrix.hasConflicts` | "N potential conflict(s)" | - |

---

## 4. spawn:preflight (DEPRECATED)

**Source** : `cli/commands/spawn.ts`

### Guards (même logique que agent:spawn)

Déléguer à `agent:spawn` qui gère tout automatiquement.

---

## 5. Context & Role Validation

**Source** : `cli/commands/context.ts`

### Guards existants

| ID | Condition | Message |
|----|-----------|---------|
| `missing_operation` | `!operation` | "missing required argument 'operation'" |
| `missing_role` | `!options.role` | "--role is required" |
| `operation_not_found` | `!result` | "No context defined for operation" |
| `fragment_not_found` | `!content` | "Fragment not found" |

---

## 6. Fragments actuels (Post-prompts embarqués)

### skill/gates.md

**Pre-Task Gates** (STOP si non vérifié) :
- `memory:sync` shows no pending
- `deps:show TNNN` confirms unblocked
- Deliverables are explicit text

**Post-Agent Gates** (Keep In Progress si non vérifié) :
- Agent logs exist (minimum 2)
- At least 1 TIP log entry
- Deliverables match task spec
- No --error logs unresolved

**State Corruption Triggers** (STOP + escalate) :
- `memory:sync` pending when task marked Done
- Dependency Done but artifact missing
- Agent modified frontmatter directly
- Agent committed to git

### agent/states.md

**Forbidden Transitions** (STOP) :
- `Not Started → Done`
- `Not Started → Blocked`
- `Blocked → Done`
- `Done → *`
- `Aborted → *`
- `Cancelled → *`

### skill/orchestration.md

**After Agent Returns** :
| Output | Action |
|--------|--------|
| Complete | `task:update --status Done` |
| Blocked | Keep In Progress, escalate |
| Errors in logs | Investigate first |
| Missing logs (<2) | Reject |

---

## 7. assign:claim / assign:release

**Source** : `cli/commands/assign.ts`

### Guards existants

| ID | Condition | Message | Actions |
|----|-----------|---------|---------|
| `pending_memory` | `memoryCheck.pending && !force` | "STOP: Pending memory consolidation required" | `memory:sync` |
| `no_tip_logs` | `!hasTipLogs` | "⚠ Warning: No TIP logs found" | (warning only) |
| `orphan_run` | `orphaned processes` | "⚠ Cleaned up orphan run" | (auto-cleanup) |

### Post-prompts

| Trigger | Message |
|---------|---------|
| `release success` | "⚠ No TIP logs - consider adding insights for next agent" |

---

## 8. deps:show / deps:ready / deps:validate

**Source** : `cli/commands/deps.ts`

### Guards (validation errors)

| ID | Condition | Message |
|----|-----------|---------|
| `cycle_detected` | `detectCycles()` | "✗ Cycle detected: {path}" |
| `invalid_blocker` | `blocker not found` | "✗ {task}: blocker {id} not found" |
| `self_reference` | `task blocks itself` | "✗ {task}: cannot block itself" |

### Post-prompts

| Trigger | Message |
|---------|---------|
| `epic blocked` | "⚠ Epic blocked - waiting for: {blockers}" |
| `task blocked` | "✗ {task}: needs {waitingFor}" |

---

## 9. memory:sync / memory:consolidate

**Source** : `cli/commands/memory.ts`

### Guards

| ID | Condition | Message |
|----|-----------|---------|
| `pending_logs` | `epicLogs.length > 0` | "⚠ PENDING LOGS: {count} epic(s)" |
| `section_not_found` | `!section` | "⚠ {count} skipped (section not found)" |

---

## 10. task:update / task:log

**Source** : `cli/commands/task.ts`

### Guards (via status-manager)

| ID | Condition | Message |
|----|-----------|---------|
| `forbidden_transition` | `invalid state change` | Via `agent/states.md` fragment |
| `pending_memory` | `task Done but pending logs` | Via `skill/gates.md` |

### Post-prompts (auto-escalation)

| Trigger | Action |
|---------|--------|
| `task → In Progress` | `escalateOnTaskStart()` → Epic/PRD to In Progress |
| `task → Done` | `cascadeTaskCompletion()` → Check epic/PRD completion |

---

## 11. agent:reap / agent:harvest

**Source** : `cli/commands/agent/harvest.ts`

### Guards (escalate pattern)

| ID | Condition | Message | Actions |
|----|-----------|---------|---------|
| `agent_not_found` | `!agentInfo` | "No agent found for task" | `agent:spawn` |
| `agent_running` | `isRunning` | "Agent is still running" | `agent:wait`, `agent:kill` |
| `timeout` | `wait timeout` | "Timeout waiting for agent" | `agent:kill`, `agent:log` |

### Post-prompts

| Trigger | Message | Actions |
|---------|---------|---------|
| `reap failed` | "Reap failed: {reason}" | `agent:reap` manual |
| `merge conflict` | "Conflicts detected" | `/dev:merge` |

---

## 12. agent:monitor / agent:status

**Source** : `cli/commands/agent/monitor.ts`

### Post-prompts (status display)

| Status | Icon | Meaning |
|--------|------|---------|
| `failed` | ✗ | Agent errored |
| `rejected` | ✗ | Work discarded |
| `completed` | ✓ | Success |
| `running` | … | In progress |

### Warnings

| Condition | Message |
|-----------|---------|
| `orphan_agent_dirs` | "⚠ Orphan agent dirs (not in db)" |
| `orphan_worktree_dirs` | "⚠ Orphan worktree dirs (not in db)" |
| `ghost_agents` | "⚠ Ghost agents (in db, no dir)" |
| `terminal_with_worktree` | "⚠ Terminal agents with worktree (should clean)" |

---

## 13. gc:* (garbage collection)

**Source** : `cli/commands/gc.ts`

### Warnings

| Condition | Message |
|-----------|---------|
| `unsafe_orphans` | "⚠ Unsafe ({count}): would delete unmerged work" |

---

## 14. archive:prd

**Source** : `cli/commands/archive.ts`

### Guards

| ID | Condition | Message |
|----|-----------|---------|
| `prd_not_found` | `!prd` | "✗ PRD not found" |
| `prd_not_done` | `status !== Done` | "✗ PRD is not done" |
| `dest_exists` | `archivePath exists` | "✗ Archive destination already exists" |
| `all_force_conflict` | `--all && --force` | "✗ --all and --force are incompatible" |

---

## 15. story:validate

**Source** : `cli/commands/story.ts`

### Warnings

| Condition | Message |
|-----------|---------|
| `orphan_stories` | "⚠️ {count} orphan stories (not referenced)" |
| `unlinked_stories` | "⚠️ {count} unlinked stories" |

---

## 16. renumber:check

**Source** : `cli/commands/renumber.ts`

### Warnings

| Condition | Message |
|-----------|---------|
| `duplicate_epics` | "⚠ {count} duplicate epic ID(s)" |
| `duplicate_tasks` | "⚠ {count} duplicate task ID(s)" |
| `keep_invalid` | "✗ --keep invalide" |

---

## 17. util:config / util:init

**Source** : `cli/commands/util/*.ts`

### Status symbols

| Status | Symbol |
|--------|--------|
| `ok` | ✓ |
| `warn` | ⚠ |
| `error` | ✗ |

### Post-prompts

| Trigger | Message |
|---------|---------|
| `file exists` | "⚠ Exists (skipped): use -y to overwrite" |
| `template not found` | "⚠ Template not found" |

---

## Templates à créer

### Phase 1 : Guards CLI critiques

```
prompting/guards/
├── agent-spawn.yaml       # Guards pour agent:spawn
├── worktree-merge.yaml    # Guards pour worktree:merge
├── worktree-preflight.yaml # Guards pour worktree:preflight
└── context-load.yaml      # Guards pour context:load
```

### Phase 2 : Post-prompts workflow

```
prompting/posts/
├── task-start.yaml        # Recommendations après spawn
├── task-done.yaml         # Recommendations après completion
├── merge-success.yaml     # Recommendations après merge
└── merge-conflict.yaml    # Recommendations si conflit
```

### Phase 3 : Gates (skill/coordinator)

```
prompting/gates/
├── pre-task.yaml          # Checks avant spawn
├── post-agent.yaml        # Checks après agent return
└── state-transitions.yaml # Validations de transitions
```

---

## Mapping fragments → templates

| Fragment actuel | Template cible | Type |
|-----------------|----------------|------|
| `skill/gates.md` Pre-Task | `gates/pre-task.yaml` | guard |
| `skill/gates.md` Post-Agent | `gates/post-agent.yaml` | guard |
| `skill/gates.md` Corruption | `gates/state-corruption.yaml` | guard |
| `agent/states.md` Forbidden | `gates/state-transitions.yaml` | guard |
| `skill/orchestration.md` After | `posts/task-done.yaml` | post |
| spawn.ts `escalate()` | `guards/agent-spawn.yaml` | guard |
| worktree.ts merge hints | `posts/merge-success.yaml` | post |

---

## Structure template proposée

```yaml
# prompting/guards/agent-spawn.yaml

# Variables déclarées (runtime, pas config)
vars:
  taskId: { type: string, required: true }
  gitClean: { type: boolean, required: true }
  # ...

# Checks évalués dans l'ordre
checks:
  - id: role_denied
    when: "{{ role == 'agent' }}"
    level: error
    message: |
      ⚠ Agents cannot spawn other agents
      Role '{{ role }}' is not allowed for agent:spawn
    hint: "Only skill or coordinator can spawn agents"
    exit: 1

  - id: mcp_not_running
    when: "{{ mcpRunning == false }}"
    level: error
    message: |
      ⚠ MCP server not running
      Agent sandbox requires MCP server
    actions:
      - { cmd: "bin/rudder-mcp start", label: "Start MCP server" }
      - { cmd: "bin/rudder-mcp status", label: "Check server status" }
    exit: 1
```

---

## Prochaines étapes

1. **Installer liquidjs** : `npm install liquidjs`
2. **Créer `cli/lib/guards.ts`** : Engine d'évaluation
3. **Migrer agent:spawn** : Premier use case complet
4. **Tester** : Vérifier tous les cas de blocage
5. **Migrer les autres commandes** : worktree:merge, etc.
