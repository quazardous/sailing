# Memory Sync Protocol

Memory not consolidated before execution is lost.

## Before any task

```bash
rudder memory:sync
```

| Output | Action |
|--------|--------|
| `No pending logs` | Proceed |
| `MEMORY SYNC REQUIRED` | Consolidate first |

## When to run

- Before spawning task agents
- Between batches
- When resuming work

## Consolidation

If pending logs exist:
1. Read logs with `rudder epic:dump-logs ENNN`
2. Consolidate into epic memory
3. Clean with `rudder epic:clean-logs ENNN`

**Invariant:** Lost memory = system failure.
