---
description: Merge agent work into target branch
argument-hint: <TNNN>
allowed-tools: mcp, Bash
---
<!-- DO NOT EDIT DIRECTLY - generated from merge.md.njk -->

# Merge Agent

> **DELEGATION REQUIRED**: This command MUST be executed by a coordinator agent.
> The skill NEVER executes merge operations directly. Use native Task() tool.

**Purpose:** Merge agent work into the target branch, handling conflicts with full context.

**Escalation Contract:** This coordinator handles git merge and conflict resolution.
- Simple merges: completed automatically
- Conflicts: resolved with context, logged
- Ambiguous conflicts: ESCALATE to skill (do not guess)
- Architectural conflicts: ESCALATE to skill (require decision)

**Authority:** This command is executed by authorized coordinator. It MUST NOT be invoked by task agents.

---

## Pre-flight

```json
// MCP: context_load
{ "operation": "merge", "role": "coordinator" }

// MCP: artefact_show
{ "id": "TNNN" }
```

---

## Arguments

```bash
/dev:merge T042           # Merge specific task
/dev:merge --all          # Merge all ready tasks (in order)
```

---

# Standard Workflow

Agent work is on feature branches or direct commits.

## 1. Locate Changes

```bash
# Check task status
# MCP: artefact_show { "id": "TNNN" }

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
git branch -d task/TNNN
```

Mark task done:
```json
// MCP: artefact_update
{ "id": "TNNN", "status": "Done" }
```

---

## Context for Resolution

When resolving conflicts, the coordinator has access to:

| Context | Source | Purpose |
|---------|--------|---------|
| Task description | `artefact_show { "id": "TNNN" }` | What was the agent trying to do |
| Epic memory | `memory_read { "scope": "ENNN", "full": true }` | Patterns, tips, prior decisions |
| Main changes | `git log main --since="agent start"` | What changed on main |
| Conflict details | `git diff --check` | Exact conflict locations |
| DEV.md | Project root | Tech stack, conventions |

---

## Multi-Task Merge (--all)

When merging multiple tasks:

```bash
# Merge by commit order
git log --oneline --grep="T0" main | head -10
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

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "Merged to main", "level": "info" }

// MCP: task_log
{ "task_id": "TNNN", "message": "Resolved conflict in src/foo.js: combined both changes", "level": "tip" }

// MCP: task_log
{ "task_id": "TNNN", "message": "Conflict resolution: kept agent's version (newer API)", "level": "info" }
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
