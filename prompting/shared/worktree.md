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
  ├─ no conflicts → agent:merge TNNN
  └─ conflicts → /dev:merge TNNN (manual resolution)
```

### Decision Points

| After | Output | → Action |
|-------|--------|----------|
| `agent:status` | completed | `agent:conflicts` |
| `agent:status` | failed | `agent:reject` or investigate |
| `agent:conflicts` | none | `agent:merge TNNN` |
| `agent:conflicts` | file overlap | `/dev:merge TNNN` |

### Commands

| Command | Purpose |
|---------|---------|
| `agent:status [TNNN]` | Check agent completion state |
| `agent:conflicts` | Show file overlap between parallel agents |
| `agent:merge TNNN` | Fast merge (no conflicts) |
| `agent:reject TNNN` | Discard agent work, set task blocked |
| `/dev:merge TNNN` | Merge with conflict resolution context |

### Batch Merge Order

When merging multiple agents:
1. Run `agent:conflicts` first
2. Merge in dependency order (no blockers first)
3. If file conflicts exist, merge one-by-one with `/dev:merge`

### Recovery Rules

An agent worktree can be:
- **Resumed**: new input provided, partial work reused
- **Reset**: work discarded, fresh agent spawned

**Agents MUST NOT attempt recovery by themselves.**

Only skill decides:
- Resume → `agent:resume TNNN`
- Reset → `agent:reject TNNN` + respawn

Agents are disposable. This is by design.

**Worktrees are disposable. Memory is not.**
