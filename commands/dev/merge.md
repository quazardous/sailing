# Merge Agent

**Purpose:** Merge agent work from a PR/worktree branch into main, handling conflicts with full context.

> 📖 CLI reference: `bin/rudder -h`

---

## Pre-flight

```bash
rudder context:load merge --role coordinator
rudder worktree:status --json                 # Current worktree state
rudder worktree:preflight --json              # Blockers, merge order
```

## Prerequisites

Before running this command:

1. Task agent has completed (status: completed)
2. PR exists (if using PR workflow) OR worktree has commits
3. No uncommitted changes on main branch

---

## Arguments

```bash
/dev:merge T042           # Merge specific task
/dev:merge --all          # Merge all ready tasks (in order)
/dev:merge --pr 123       # Merge by PR number
```

---

## Workflow

### 1. Assess Merge State

```bash
# Get task/PR info
rudder task:show TNNN
rudder worktree:status --json

# Check for conflicts
git fetch origin
git merge-tree $(git merge-base main origin/agent/TNNN) main origin/agent/TNNN
```

### 2. If No Conflicts → Fast Merge

```bash
# Via GitHub CLI (preferred)
gh pr merge <pr-number> --merge  # or --squash, --rebase

# Or local merge
git checkout main
git pull origin main
git merge origin/agent/TNNN --no-edit
git push origin main

# Cleanup
rudder worktree:cleanup TNNN
```

### 3. If Conflicts → Resolve with Context

Load context for intelligent resolution:

```bash
# Get epic memory (patterns, decisions)
rudder epic:show-memory ENNN --full

# Get task details (what was intended)
rudder task:show TNNN

# Get modified files
git diff main...origin/agent/TNNN --name-only
```

#### Resolution Strategy

1. **Understand the conflict**:
   - What did the agent change?
   - What changed on main since agent started?
   - Are changes complementary or contradictory?

2. **Resolve by type**:
   - **Additive**: Both added code → merge both
   - **Modify same logic**: Understand intent → combine
   - **Delete vs modify**: Keep the intended behavior
   - **Config/version**: Usually take newer

3. **Apply resolution**:
   ```bash
   git checkout main
   git merge origin/agent/TNNN --no-commit
   # ... resolve conflicts ...
   git add -A
   git commit -m "merge: T042 (resolved conflicts)"
   git push origin main
   ```

4. **Cleanup**:
   ```bash
   rudder worktree:cleanup TNNN
   ```

---

## Context for Resolution

When resolving conflicts, the agent has access to:

| Context | Source | Purpose |
|---------|--------|---------|
| Task description | `rudder task:show TNNN` | What was the agent trying to do |
| Epic memory | `rudder epic:show-memory ENNN` | Patterns, tips, prior decisions |
| Main changes | `git log main --since="agent start"` | What changed on main |
| Conflict details | `git diff --check` | Exact conflict locations |
| DEV.md | Project root | Tech stack, conventions |

---

## Output

Returns to main thread:

- Merge status (success, conflicts resolved, failed)
- Files merged/resolved
- Conflicts encountered (if any)
- Cleanup status

**Main thread decides next action.** This command handles one merge at a time.

---

## Multi-Agent Merge (--all)

When merging multiple tasks:

```bash
rudder worktree:preflight --json
# Returns: merge_order: [T042, T043, T044]
```

1. Merge in suggested order (minimizes conflicts)
2. After each merge, re-check remaining tasks
3. Stop on unresolvable conflict → escalate

---

## Constraints

- Never force-push to main
- Always pull before merge
- Log all conflict resolutions
- Escalate if:
  - Conflict affects core architecture
  - Resolution is ambiguous
  - Test failures after merge

---

## Logging

```bash
rudder task:log TNNN "Merged to main" --info
rudder task:log TNNN "Resolved conflict in src/foo.js: combined both changes" --tip
rudder task:log TNNN "Conflict resolution: kept agent's version (newer API)" --info
```

---

## Non-Goals

This command does **NOT**:

- Make architectural decisions
- Modify task scope
- Skip conflict resolution
- Auto-merge without understanding

