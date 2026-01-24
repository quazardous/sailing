# Architecture Contracts

**For AI Agents: These contracts are NON-NEGOTIABLE.**

---

## ALWAYS RULES (covers 80% of issues)

1. **ALWAYS** use `import` (ES modules), **NEVER** `require()`
2. **ALWAYS** add `.js` extension on local imports
3. **ALWAYS** use `lib/git.ts` or `lib/worktree.ts` for git operations
4. **ALWAYS** use `execa` (via `lib/invoke.ts`) for shell commands, **NEVER** `child_process.execSync`
5. **ALWAYS** use `db-manager.ts` for agent CRUD operations (taskNum-based)
6. **ALWAYS** use `artefacts-manager.ts` to access tasks/epics/PRDs
7. **ALWAYS** inject config as params in libs, **NEVER** import config in libs
8. **ALWAYS** run `npx tsc --noEmit` before commit
9. **ALWAYS** fix lint errors you introduce + 10% of existing errors
10. **ALWAYS** import from managers in commands, **NEVER** from libs for config-dependent operations

---

## ANTI-PATTERNS (one-liner)

| Anti-Pattern | Why it's bad |
|--------------|--------------|
| `require('child_process')` | CommonJS forbidden, use import |
| `execSync('git ...')` | Use `getGit()` or `WorktreeOps` |
| `execSync('npm ...')` | Use `execa` with `reject: false` |
| `import from '../lib/...'` without `.js` | Extension required for ESM |
| Config in lib (`getAgentConfig()`) | Libs must be pure, inject via params |
| `fs.readFileSync('agents.json')` | Use `db-manager` (taskNum-based CRUD) |
| `fs.readdirSync(tasksDir)` | Use `artefacts-manager` (cached indexes) |
| Business logic in commands | Move to manager |
| God manager (10+ functions) | Split by domain |

---

## CREDO: SEPARATION OF CONCERNS

> **Impurity flows upward, never downward.**

- **Libs are pure**: testable, reusable, no hidden side-effects
- **Managers are impure**: they know the context (config, paths, state)
- **Commands are pure**: CLI parsing + display, zero business logic

**Why?**
- A pure lib can be tested without mocking config
- A manager can change strategy without touching libs
- A command can change UX without touching logic

**The litmus test**: if you need to mock `getConfig()` to test a lib → it's a violation.

---

## LAYER ARCHITECTURE

```
Commands → Managers → Libs
  (pure)    (impure)   (pure)
```

| Layer | Responsibility | Config | Examples |
|-------|----------------|--------|----------|
| **Commands** | CLI parsing, output, UX | ❌ NO | `commands/*.ts` |
| **Managers** | Business logic, orchestration | ✅ YES | `managers/*.ts` |
| **Libs** | Pure technical operations | ❌ NO | `lib/*.ts` |

---

## MANAGER DOMAINS

| Manager | Domain |
|---------|--------|
| `agent-manager` | Agent lifecycle (reap, kill, merge, wait) |
| `artefacts-manager` | Tasks, epics, PRDs access (index, lookup, matchesPrd, matchesEpic) |
| `compose-manager` | Prompt/context composition |
| `conductor-manager` | Orchestration of agents and MCP conductor |
| `config-manager` | Config semantic accessors |
| `conflict-manager` | Git conflict detection and resolution |
| `core-manager` | Project root, paths, placeholders, path overrides |
| `db-manager` | Agent CRUD (taskNum-based, replaces state.agents) |
| `diagnose-manager` | Log analysis, noise filters |
| `discovery-manager` | Project discovery and context loading |
| `fileio-manager` | File read/write operations |
| `graph-manager` | Dependency graph operations |
| `info-manager` | Project info and status display |
| `mcp-manager` | MCP server lifecycle |
| `memory-manager` | Memory/logs operations |
| `pr-manager` | PR/MR operations (GitHub, GitLab) |
| `reconciliation-manager` | State reconciliation |
| `service-manager` | Background service management |
| `state-manager` | State persistence (counters) |
| `status-manager` | Status transitions cascade |
| `template-manager` | Template loading and rendering |
| `version-manager` | Component version bumping |
| `worktree-manager` | Git worktree operations |

---

## LIBS & EXTERNAL DEPS

| Lib/Package | Usage |
|-------------|-------|
| `lib/git.ts` | Simple-git wrapper (`getGit(cwd)`) |
| `lib/worktree.ts` | `WorktreeOps` class (branch, worktree ops) |
| `lib/invoke.ts` | Shell exec via `execa` |
| `lib/artefacts.ts` | Index building (called by manager) |
| `execa` | Shell commands with `reject: false` |
| `simple-git` | Async git operations |
| `gray-matter` | Markdown frontmatter parsing |
| `js-yaml` | YAML parsing |

---

## VERIFICATION

```bash
npx tsc --noEmit && npm run lint && npm run build
```
