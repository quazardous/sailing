## Worktree Isolation

Agents run in isolated git worktrees (separate branches).

### Post-Agent Workflow

```
agent:status TNNN
       ↓
  ┌────┴────┐
  ↓         ↓
completed  failed/blocked
  ↓              ↓
agent:conflicts  agent:reject TNNN
  ↓
  ├─ no conflicts → agent:reap TNNN
  └─ conflicts → /dev:merge TNNN (manual resolution)
```

### Decision Points

| After | Output | → Action |
|-------|--------|----------|
| `agent:status` | completed | `agent:conflicts` |
| `agent:status` | failed | `agent:reject` or investigate |
| `agent:conflicts` | none | `agent:reap TNNN` |
| `agent:conflicts` | file overlap | `/dev:merge TNNN` |

### Commands

| Command | Purpose |
|---------|---------|
| `agent:spawn TNNN` | Spawn new agent in fresh worktree |
| `agent:spawn TNNN --resume` | Resume agent in existing worktree |
| `agent:status [TNNN]` | Check agent completion state |
| `agent:conflicts` | Show file overlap between parallel agents |
| `agent:reap TNNN` | Wait, merge, cleanup, update status |
| `agent:reject TNNN` | Discard agent work, set task blocked |
| `/dev:merge TNNN` | Merge with conflict resolution context |

### Batch Merge Order

When merging multiple agents:
1. Run `agent:conflicts` first
2. Merge in dependency order (no blockers first)
3. If file conflicts exist, merge one-by-one with `/dev:merge`

### Recovery Rules

An agent worktree can be:
- **Resumed**: reuse worktree, inject new context
- **Reset**: discard work, fresh agent spawned

**Agents MUST NOT attempt recovery by themselves.**

Only skill decides:
- Resume → `agent:spawn TNNN --resume`
- Reset → `agent:reject TNNN` + `agent:spawn TNNN`

Agents are disposable. This is by design.

**Worktrees are disposable. Memory is not.**
