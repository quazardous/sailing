---
description: Start task (autonomous mode)
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, Bash
---

## Pre-flight (MANDATORY)

```bash
rudder context:skill task-start
```

Check the **Execution Mode** section in the output:
- **subprocess**: Use `rudder agent:spawn TNNN`
- **inline**: Use Task tool with agent prompt below

If **Worktree Isolation: enabled**, agent runs in isolated git branch.

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

**Read and follow the contract strictly.**

## 2. Execute

Implement the deliverables. No scope expansion.

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
