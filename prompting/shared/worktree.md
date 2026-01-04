## Worktree Isolation

Agents run in isolated git worktrees (separate branches).

### Default Workflow

`agent:spawn` handles everything automatically:

```
agent:spawn TNNN
       ↓
  [streams output + heartbeat]
       ↓
  ┌────┴────┐
  ↓         ↓
exit 0    exit ≠ 0
  ↓              ↓
auto-reap    manual: agent:reject or investigate
  ↓
  ├─ no conflicts → ✓ merged + cleaned
  └─ conflicts → escalate to /dev:merge TNNN
```

### Commands

| Command | Purpose |
|---------|---------|
| `agent:spawn TNNN` | Spawn, wait, stream output, auto-reap |
| `agent:spawn TNNN --resume` | Resume in existing worktree |
| `agent:wait TNNN` | Reattach to background agent |
| `agent:status [TNNN]` | Check agent state |
| `agent:conflicts` | Show file overlap between parallel agents |
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
