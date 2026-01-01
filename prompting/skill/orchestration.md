# Skill Orchestration

## Role

- **Decide**, agents execute
- **Verify** before status changes
- **Consolidate** memory between tasks

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
