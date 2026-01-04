# Reminders

## Memory Commands

| Purpose | Command |
|---------|---------|
| Consolidate logs | `memory:sync` |
| Read memory | `memory:show ENNN [--full]` |
| Edit memory | `memory:edit ENNN --section "Tips"` |
| Agent context | `task:show-memory TNNN` |

**Before each task/batch start**: `rudder memory:sync`

If pending → consolidate before spawning agents.

## Common Mistakes

- Forgetting memory:sync between batches
- Not checking deps:ready before spawn
- Accepting task with <2 logs
- Letting agent commit (user responsibility)

## Authority

| Who | Does |
|-----|------|
| Skill | Decisions |
| Agents | Execution |
| Rudder | State |
| User | Git commits |
