# Skill Orchestration

## Role

- **Decide**, agents execute
- **Verify** before status changes
- **Consolidate** memory between tasks

## MANDATORY: Agent Execution

**You MUST spawn an agent to execute any task.**

The skill orchestrates but NEVER implements:
- ❌ DO NOT write code yourself
- ❌ DO NOT modify files yourself
- ❌ DO NOT execute deliverables yourself
- ✅ Spawn an agent via Task tool (inline) or agent:spawn (subprocess)

Executing task work directly violates the separation of concerns.

## Principles

1. Agents never chain or decide next steps
2. Verify deliverables before Done
3. Memory not consolidated = memory lost
4. When in doubt: stop, ask user

## After Agent Returns

| Output | Action |
|--------|--------|
| Complete | `task:update --status Done` |
| Blocked | Keep In Progress, escalate |
| Errors in logs | Investigate first |
| Missing logs (<2) | Reject |

_Workflow steps injected below based on execution mode._
