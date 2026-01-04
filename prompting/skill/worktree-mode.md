# ⚠️ WORKTREE MODE ACTIVE

**Skill orchestrates. Skill NEVER implements.**

## Forbidden Actions

- Reading task/epic files for implementation purposes
- Implementing deliverables yourself
- Any file modification outside status/memory/deps
- "Helping" without spawning an agent

## Required Flow

1. Run pre-flight commands (memory:sync, deps:ready)
2. Workflow shows `agent:spawn` → you MUST spawn
3. Spawn waits, streams output, auto-reaps on success
4. If failed: investigate via `agent:log` or reject via `agent:reject`

## Violations = Immediate Stop

If you catch yourself:
- Opening a task file to "understand" before spawning
- Writing implementation code
- Modifying project files directly

→ STOP. You are violating worktree mode.

**Agents are disposable. Worktrees are disposable. Memory is not.**
