---
description: Start all ready tasks in parallel (project)
argument-hint: "[PRD-NNN] [--limit N]"
allowed-tools: Read, Edit, Glob, Task, mcp
---

# Batch Start Ready Tasks

**Arguments:** $ARGUMENTS

⚠️ **Safety notice**: Without a PRD argument, this command may start tasks across multiple PRDs. Use intentionally.

---

## Purpose

Orchestrate the **parallel start of ready tasks** while strictly preserving project invariants:

* **MCP tools are the single source of truth** for state
* **Agents are authoritative** for execution outcomes
* This command performs **coordination only**, never implementation or inference

The batch runner prepares and launches work, then steps aside.

---

## Pre-flight (MANDATORY)

```json
// MCP: context_load
{ "operation": "tasks-batch", "role": "skill" }
```

This tells you:
- **Execution mode**: subprocess vs inline
- **Worktree isolation**: enabled/disabled
- How to spawn agents (agent_spawn vs Task tool)

**⚠️ NO AUTO-FALLBACK**: If worktree mode is enabled but fails (no git, no commits, spawn error):
- DO NOT switch to inline mode on your own
- STOP and report the error to user
- Constitutional rule: "When in doubt: stop, log, escalate — never guess."

---

## Workflow

1. **Memory Sync (MANDATORY)**

   ```json
   // MCP: memory_sync
   {}
   ```

   | Output | Action |
   |--------|--------|
   | `✓ No pending logs` | Proceed to step 2 |
   | `⚠ MEMORY SYNC REQUIRED` | Consolidate logs, then re-run sync |

   **Invariant**: Memory not consolidated = lost. Lost memory = system failure.

2. **Validate dependencies (MANDATORY)**

   ```json
   // MCP: workflow_validate
   {}
   ```

3. **Find ready tasks**

   ```json
   // If PRD specified (recommended)
   // MCP: workflow_ready
   { "scope": "PRD-005", "limit": 6 }

   // Or filter by epic
   // MCP: workflow_ready
   { "scope": "E048", "limit": 4 }

   // Otherwise, all ready tasks (⚠️ cross-PRD)
   // MCP: workflow_ready
   { "limit": 6 }
   ```

   **CRITICAL**: Tasks from `workflow_ready` are **guaranteed independent** — no manual check needed.

4. **Fail fast**

   * If no ready tasks are found:
     * Print a clear message
     * Exit immediately
     * **Do NOT spawn agents**

5. **Mark tasks In Progress**

   ```json
   // MCP: workflow_start
   { "task_id": "T101", "assignee": "agent" }
   // Repeat for each task
   ```

6. **Spawn parallel agents**

   Check your execution mode from `context_load` output.

   **If spawning fails mid-batch:**
   - Do NOT attempt recovery
   - Report which tasks are already marked In Progress
   - User decides whether to reset them
   - This command is NOT idempotent — re-running may spawn duplicate work

   **Mode: subprocess** (`use_subprocess: true`):
   ```json
   // MCP: agent_spawn
   { "task_id": "T101" }
   // Repeat for each task
   ```

   Each spawn:
   - Streams agent output to console
   - Shows heartbeat every 30s
   - Auto-reaps on completion (merge + cleanup + status update)

   If worktree isolation is enabled, each agent gets its own git worktree.

   **Mode: inline** (`use_subprocess: false`):
   * Spawn agents in a **single message** using multiple `Task` tools
   * Each agent runs `context_load` to get its full context

   ```
   ┌─ Task(T101) ─┐
   ├─ Task(T102) ─┼─► Parallel: each agent runs context_load
   ├─ Task(T103) ─┤
   └─ Task(T104) ─┘
   ```

7. **Results**

   **Mode: subprocess**:

   Results are handled automatically by spawn:
   - Agent output streamed to console
   - Heartbeat shows progress every 30s
   - On completion: auto-merge, cleanup, status update

   **If reap fails (conflicts, errors):**
   - Command outputs next steps
   - Follow the guidance or escalate to user
   - Example: `/dev:merge T042` for conflict resolution

   **Mode: inline**:
   * Wait for Task tool agents to complete
   * Summarize outcomes (Done / Blocked)
   * Report newly unblocked tasks if relevant

8. **Memory Sync AFTER batch (MANDATORY)**

   Before starting another batch or ending the session:

   ```json
   // MCP: memory_sync
   {}
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

## Agent Brief — Inline Mode

For inline agents (Task tool), the prompt is minimal. The agent gets its context via `context_load`:

```markdown
# Assignment: {TNNN}

You are a senior engineer executing task {TNNN}.

## 1. Get your context

```json
// MCP: context_load
{ "operation": "{TNNN}", "role": "agent" }
```

This returns your complete execution context:
- Agent Contract (constitutional rules, CLI contract, logging protocol)
- Epic memory (learnings from previous work)
- Epic context (tech notes, constraints)
- Task details (deliverables, workflow)

**Read and follow the contract strictly.**

## 2. Execute

Implement the deliverables. No scope expansion.

**Logging contract:**
- Log once when starting (approach)
- Log once before returning control (result or blocker)
- Minimum 2 logs required.

**If you cannot complete:** emit `--error` log, stop, return control.

**You MUST NOT commit, push, or modify git state.**

## 3. Complete

Exit normally. The skill will call `assign_release { "task_id": "{TNNN}" }` after you return.

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
