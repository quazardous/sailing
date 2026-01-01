---
description: Start task (autonomous mode)
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, Bash
---

## Pre-flight (MANDATORY)

```bash
rudder context:load task-start --role skill
```

The output includes a **Workflow: task-start** section with steps filtered for your execution mode:
- **inline**: Steps include `context:load`, `memory:show`, `task:show` (for Task tool injection)
- **subprocess**: Steps include `agent:spawn` (for subprocess execution)

Follow the workflow steps exactly as shown. No conditionals to interpret — just execute the steps.

If **Worktree Isolation** section appears, agent runs in isolated git branch.

**⚠️ NO AUTO-FALLBACK**: If subprocess/worktree mode fails:
- DO NOT switch to inline mode silently
- STOP and report the error to user
- Constitutional rule: "When in doubt: stop, log, escalate — never guess."

## Agent Prompt Template

```markdown
# Assignment: {TNNN}

You are a senior engineer executing task {TNNN}.

## 1. Get your context

```bash
rudder assign:claim {TNNN}
```

This returns your complete execution context:
- Agent Contract (constitutional rules, CLI contract, logging protocol)
- Epic memory (learnings from previous work)
- Epic context (tech notes, constraints)
- Task details (deliverables, workflow)

`assign:claim` returns a **snapshot**. If input changes, task must be re-claimed or reset by skill.

**Read and follow the contract strictly.**

## 2. Execute

Implement the deliverables. No scope expansion.

**Logging contract:**
- Log once when starting (approach)
- Log once before returning control (result or blocker)
- Minimum 2 logs required. Logs are consumed by next agent — if you don't log it, the system repeats the mistake.

**If you cannot complete the task:**
1. Emit one `--error` log explaining why
2. Stop execution
3. Return control without attempting partial fixes

**You MUST NOT commit, push, or modify git state.** Worktree is disposable.

## Modes

| Mode | Workflow |
|------|----------|
| **Non-worktree** (default) | Agent calls `assign:claim TNNN` → gets prompt → executes |
| **Worktree** | Skill calls `assign:create TNNN --operation task-start` first, then agent claims |

In non-worktree mode, `assign:claim` works without prior `assign:create` - no file is created.

## Role Mapping (optional refinement)

| Task location / type | Role |
|---------------------|------|
| `admin/` | senior frontend engineer (Vue 3 / PrimeVue) |
| `skynet/` | senior backend engineer (Node.js / Fastify) |
| `chrome-extension/` | senior browser engineer (Chrome MV3) |
| Tests-related | senior QA engineer |
| Infra/DevOps | senior DevOps engineer |
| Mixed/unclear | senior full-stack engineer |

## Additional Context (if applicable)

| Item | When to add |
|------|-------------|
| TOOLSET.md path | If project has custom build/test commands |
| TESTING.md path | If task involves writing tests |
| API.md path | If task involves API changes |
