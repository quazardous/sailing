---
description: Start task (autonomous mode)
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, mcp
---
<!-- DO NOT EDIT DIRECTLY - generated from task-start.md.njk -->

## Pre-flight (MANDATORY)

```json
// MCP: context_load
{ "operation": "task-start", "role": "skill" }
```

The output includes a **Workflow: task-start** section with steps filtered for your execution mode:
- **subprocess**: Steps include `agent:spawn` (for subprocess execution)

Follow the workflow steps exactly as shown. No conditionals to interpret — just execute the steps.

If **Worktree Isolation** section appears, agent runs in isolated git branch.

**⚠️ NO AUTO-FALLBACK**: If subprocess/worktree mode fails:
- DO NOT switch to inline mode silently
- STOP and report the error to user
- Constitutional rule: "When in doubt: stop, log, escalate — never guess."

## Lifecycle

| Mode | Workflow |
|------|----------|
| **Subprocess** | `agent_spawn` pre-claims → launches Claude → agent calls `context_load` → auto-release on exit 0 |
| **Worktree** (subprocess+isolation) | Same as subprocess but agent runs in isolated git branch |

- Spawn pre-claims, auto-release on exit code 0

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
| ADR context | If accepted ADRs exist relevant to task domain |

### ADR Integration

If ADRs exist, agent receives them via `context_load`:
```json
// MCP: adr_context - Included automatically if ADRs exist
{ "domain": "<task-domain>" }
```

Agent must respect architectural decisions documented in ADRs.
