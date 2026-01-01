---
description: Start all ready tasks in parallel (project)
argument-hint: "[PRD-NNN] [--limit N]"
allowed-tools: Read, Edit, Glob, Task, Bash
---

# Batch Start Ready Tasks

> 📖 CLI reference: `bin/rudder -h`

**Arguments:** $ARGUMENTS

⚠️ **Safety notice**: Without a PRD argument, this command may start tasks across multiple PRDs. Use intentionally.

---

## Purpose

Orchestrate the **parallel start of ready tasks** while strictly preserving project invariants:

* **Rudder is the single source of truth** for state
* **Agents are authoritative** for execution outcomes
* This command performs **coordination only**, never implementation or inference

The batch runner prepares and launches work, then steps aside.

---

## Pre-flight (MANDATORY)

```bash
rudder context:load tasks-batch --role skill
```

This tells you:
- **Execution mode**: subprocess vs inline
- **Worktree isolation**: enabled/disabled
- How to spawn agents (agent:spawn vs Task tool)

**⚠️ NO AUTO-FALLBACK**: If worktree mode is enabled but fails (no git, no commits, spawn error):
- DO NOT switch to inline mode on your own
- STOP and report the error to user
- Constitutional rule: "When in doubt: stop, log, escalate — never guess."

---

## Workflow

1. **Memory Sync (MANDATORY)**

   ```bash
   rudder memory:sync
   ```

   | Output | Action |
   |--------|--------|
   | `✓ No pending logs` | Proceed to step 2 |
   | `⚠ MEMORY SYNC REQUIRED` | Consolidate logs, run `epic:clean-logs`, then re-run sync |

   **Invariant**: Memory not consolidated = lost. Lost memory = system failure.

2. **Validate dependencies (MANDATORY)**

   ```bash
   rudder deps:validate --fix
   ```

3. **Find ready tasks**

   ```bash
   # If PRD specified (recommended)
   rudder deps:ready --prd PRD-005 [--tag <tag>] --limit 6

   # Or filter by epic
   rudder deps:ready --epic E048 --limit 4

   # Otherwise, all ready tasks (⚠️ cross-PRD)
   rudder deps:ready --limit 6
   ```

   **CRITICAL**: Tasks from `deps:ready` are **guaranteed independent** — no manual check needed.

4. **Fail fast**

   * If no ready tasks are found:
     * Print a clear message
     * Exit immediately
     * **Do NOT spawn agents**

5. **Mark tasks In Progress**

   ```bash
   for task in T101 T102 T103; do
     rudder task:update $task --status "In Progress" --assignee agent
   done
   ```

6. **Spawn parallel agents**

   Check your execution mode from `rudder context:load tasks-batch` output.

   **If spawning fails mid-batch:**
   - Do NOT attempt recovery
   - Report which tasks are already marked In Progress
   - User decides whether to reset them
   - This command is NOT idempotent — re-running may spawn duplicate work

   **Mode: subprocess** (`use_subprocess: true`):
   ```bash
   # Spawn each task as a separate Claude process
   rudder agent:spawn T101 &
   rudder agent:spawn T102 &
   rudder agent:spawn T103 &
   wait  # Wait for all agents
   ```
   If worktree isolation is enabled, each agent gets its own git worktree.

   **Mode: inline** (`use_subprocess: false`):
   * Spawn agents in a **single message** using multiple `Task` tools
   * Each agent runs `assign:claim TNNN` to get its full context

   ```
   ┌─ Task(T101) ─┐
   ├─ Task(T102) ─┼─► Parallel: each agent runs `assign:claim TNNN`
   ├─ Task(T103) ─┤
   └─ Task(T104) ─┘
   ```

7. **Collect results**

   **Mode: subprocess + worktree**:
   ```bash
   # Check agent status
   rudder agent:status

   # Check for conflicts between agents
   rudder agent:conflicts

   # Merge each completed agent
   rudder agent:merge T101
   rudder agent:merge T102
   # Or reject failed work: rudder agent:reject T103
   ```

   **If conflicts exist:**
   - STOP
   - Report conflicts to user
   - Do NOT attempt reordering or partial merges
   - User decides merge order or resolution

   **Mode: inline**:
   * Wait for Task tool agents to complete
   * Summarize outcomes (Done / Blocked)
   * Report newly unblocked tasks if relevant

8. **Memory Sync AFTER batch (MANDATORY)**

   Before starting another batch or ending the session:

   ```bash
   rudder memory:sync
   ```

   Consolidate any pending logs before spawning new agents.

---

## Authority Model

* The **batch runner NEVER changes task status after spawn**
* Each **agent is authoritative** for its task and must:
  * Set status to `Done` or `Blocked`
  * Log reasons when blocked

The orchestrator observes and reports — it does not correct or override.

---

## Agent Brief — Minimal Prompt with assign:claim

Each spawned agent receives a **minimal prompt** and claims its assignment:

```markdown
# Assignment: {TNNN}

You are a senior engineer executing task {TNNN}.

## 1. Claim your assignment

```bash
rudder assign:claim {TNNN}
```

This returns your complete execution context. Read and follow strictly.

## 2. Execute

Implement the deliverables. No scope expansion.

**Logging contract:**
- Log once when starting (approach)
- Log once before returning control (result or blocker)
- Minimum 2 logs required.

**If you cannot complete:** emit `--error` log, stop, return control.

**You MUST NOT commit, push, or modify git state.**

## 3. Complete

```bash
rudder assign:release {TNNN}
```

`assign:release` releases the assignment. Task status update is done separately via `task:update`.

The `assign:claim` command returns the compiled context:
- Agent Contract (constitutional rules, CLI contract, logging protocol)
- Epic memory (learnings from previous work)
- Epic context (tech notes, constraints)
- Task details (deliverables, workflow)

---

## Non-Goals (Explicit)

This command does **NOT**:

* Interpret or modify task scope
* Resolve ambiguities or make design decisions
* Retry, reassign, or recover failed tasks
* Change task or epic status after agents are spawned
* Perform implementation or validation work

Any uncertainty is delegated to agents, who must stop and escalate.

---

## Limits

* **Max 6 agents per batch** (context & performance)
* If more than 6 tasks ready → run multiple batches sequentially
* Parallelization allowed **only if tasks are dependency-independent**
* If internal dependencies exist → run tasks **sequentially**, not in batch
