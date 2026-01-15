# Merge Agent

**Purpose:** Merge agent work into the target branch, handling conflicts with full context.

> 📖 CLI reference: `bin/rudder -h`

**Authority:** This command is executed by main thread or authorized coordinator. It MUST NOT be invoked by agents.

---

## Pre-flight

```bash
rudder context:load merge --role coordinator
rudder task:show TNNN
```

Check the mode header at context start:
- `worktrees: disabled` → use **Standard Workflow**
- `worktrees: enabled` → use **Worktree Workflow**

---

## Arguments

```bash
/dev:merge T042           # Merge specific task
/dev:merge --all          # Merge all ready tasks (in order)
/dev:merge --pr 123       # Merge by PR number (worktree mode)
```

---

# Standard Workflow (No Worktrees)

Default mode. Agent work is on feature branches or direct commits.

## 1. Locate Changes

```bash
# Check task status
rudder task:show TNNN

# Find commits (convention: feat(TNNN): ...)
git log --oneline --grep="TNNN" main
git log --oneline --author="agent" --since="1 day ago"
```

## 2. Review Changes

```bash
# See what changed
git diff main...HEAD --stat
git log main..HEAD --oneline
```

## 3. Merge

```bash
# Simple fast-forward if possible
git checkout main
git pull origin main
git merge --ff-only feature/TNNN 2>/dev/null || git merge feature/TNNN --no-edit

# Or cherry-pick specific commits
git cherry-pick <commit-sha>
```

## 4. Cleanup

```bash
# If using worktree mode:
rudder worktree cleanup TNNN --force

# If standard mode (no worktree):
git branch -d task/TNNN

# Mark task done
rudder task:update TNNN --status Done
```

---

# Worktree Workflow

When worktrees are enabled, agents work in isolated git worktrees with dedicated branches.

## Pre-flight (Worktree)

```bash
rudder worktree status --json                 # Current worktree state
rudder worktree preflight --json              # Blockers, merge order
```

## 0. Handle Uncommitted Changes

**Before any merge operation**, check if the worktree has uncommitted changes:

```bash
cd <worktree-path>
git status --porcelain
```

If there are uncommitted changes:

1. **Get task title**:
   ```bash
   rudder task:show TNNN --json | jq -r '.title'
   ```

2. **Stage and commit with task title**:
   ```bash
   git add -A
   git commit -m "feat(TNNN): <task-title> [auto]"
   ```

   The `[auto]` flag indicates this was a fallback commit (agent forgot to commit).

3. **Log the auto-commit**:
   ```bash
   rudder task:log TNNN "Agent forgot to commit - auto-committed with task title" --warn
   ```

4. **Warn the user**:
   > ⚠️ Agent forgot to commit. Used task title as fallback.

**Why**: Agents SHOULD commit with descriptive messages. This fallback preserves meaningful history when they forget.

## Merge Mode Resolution

- If `--pr` is provided → **PR workflow** (`gh pr merge`)
- Else if worktree exists → **branch merge** (`origin/agent/TNNN`)

## 1. Assess Merge State

```bash
# Get task/PR info
rudder task:show TNNN
rudder worktree status --json

# Check for conflicts
git fetch origin
git merge-tree $(git merge-base main origin/agent/TNNN) main origin/agent/TNNN
```

## 2. If No Conflicts → Fast Merge

```bash
# Via GitHub CLI (preferred)
gh pr merge <pr-number> --merge  # or --squash, --rebase

# Or local merge
git checkout main
git pull origin main
git merge origin/agent/TNNN --no-edit
git push origin main

# Cleanup
rudder worktree cleanup TNNN
```

## 3. If Conflicts → Resolve with Context

### Create Merge Branch

Use the **merge branch nomenclature** to isolate conflict resolution:

```bash
# Naming: merge/<source>-to-<target>
git checkout -b merge/T042-to-E001 epic/E001   # or main for flat mode

# Attempt merge
git merge task/T042 --no-commit
```

### Load Context for Resolution

```bash
# Get epic memory (patterns, decisions)
rudder memory:show ENNN --full

# Get task details (what was intended)
rudder task:show TNNN

# Get modified files
git diff main...task/TNNN --name-only
```

### Resolution Strategy

1. **Understand the conflict**:
   - What did the agent change?
   - What changed on parent since agent started?
   - Are changes complementary or contradictory?

2. **Resolve by type**:
   - **Additive**: Both added code → merge both
   - **Modify same logic**: Understand intent → combine
   - **Delete vs modify**: Keep the intended behavior
   - **Config/version**: Usually take newer

3. **Apply resolution on merge branch**:
   ```bash
   # Resolve conflicts on merge/T042-to-E001
   # ... resolve conflicts ...
   git add -A
   git commit -m "merge(T042): resolved conflicts with E001"
   ```

4. **Fast-forward parent**:
   ```bash
   git checkout epic/E001    # or main
   git merge merge/T042-to-E001 --ff-only
   git push origin epic/E001
   ```

5. **Cleanup**:
   ```bash
   # Merge branch (temporary)
   git branch -d merge/T042-to-E001
   # Worktree + task branch (via rudder to update state)
   rudder worktree cleanup TNNN --force
   ```

### Branch Nomenclature

| Type | Pattern | Example |
|------|---------|---------|
| Merge | `merge/<source>-to-<target>` | `merge/T042-to-E001` |
| Reconcile | `reconcile/<entity>` | `reconcile/E001` |
| Task | `task/<id>` | `task/T042` |
| Epic | `epic/<id>` | `epic/E001` |
| PRD | `prd/<id>` | `prd/PRD-001` |

---

## Context for Resolution

When resolving conflicts, the coordinator has access to:

| Context | Source | Purpose |
|---------|--------|---------|
| Task description | `rudder task:show TNNN` | What was the agent trying to do |
| Epic memory | `rudder memory:show ENNN --full` | Patterns, tips, prior decisions |
| Main changes | `git log main --since="agent start"` | What changed on main |
| Conflict details | `git diff --check` | Exact conflict locations |
| DEV.md | Project root | Tech stack, conventions |

---

## Multi-Task Merge (--all)

When merging multiple tasks:

```bash
# Standard mode: merge by commit order
git log --oneline --grep="T0" main | head -10

# Worktree mode: use preflight for order
rudder worktree preflight --json
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

## Logging (REQUIRED)

**At least one `--info` log is REQUIRED after successful merge.**
**Conflict resolution MUST emit at least one `--tip` log.**

```bash
rudder task:log TNNN "Merged to main" --info
rudder task:log TNNN "Resolved conflict in src/foo.js: combined both changes" --tip
rudder task:log TNNN "Conflict resolution: kept agent's version (newer API)" --info
```

---

## Output

Returns to main thread:

- Merge status (success, conflicts resolved, failed)
- Files merged/resolved
- Conflicts encountered (if any)
- Cleanup status

**This command does NOT update task status.** Main thread decides whether to mark task Done.

A successful merge does not imply functional correctness. Tests and validation remain user responsibility.

---

## Non-Goals

This command does **NOT**:

- Make architectural decisions
- Modify task scope
- Skip conflict resolution
- Auto-merge without understanding
