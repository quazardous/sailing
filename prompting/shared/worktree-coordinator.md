## Worktree Mode (Coordinator)

Agent work is isolated in git worktrees with dedicated branches.

### Branch Structure

| Type | Pattern | Example |
|------|---------|---------|
| Agent | `agent/<task-id>` | `agent/T042` |
| Task | `task/<id>` | `task/T042` |
| Epic | `epic/<id>` | `epic/E001` |
| Merge | `merge/<source>-to-<target>` | `merge/T042-to-E001` |

### Worktree Commands

| Command | Purpose |
|---------|---------|
| `worktree:status --json` | All worktrees state |
| `worktree:preflight --json` | Blockers, merge order |
| `worktree:merge <task-id>` | Merge task to parent |
| `worktree:cleanup <task-id>` | Remove worktree + branch |
| `worktree:reconcile` | Diagnose branch state |

### Merge Workflow

1. Check status: `worktree:status --json`
2. Check conflicts: `git merge-tree $(git merge-base main origin/agent/TNNN) main origin/agent/TNNN`
3. If clean: `worktree:merge TNNN`
4. If conflicts: Create merge branch, resolve, fast-forward

### Conflict Resolution

When conflicts exist:
```bash
git checkout -b merge/T042-to-main main
git merge agent/T042 --no-commit
# ... resolve ...
git commit -m "merge(T042): resolved conflicts"
git checkout main && git merge merge/T042-to-main --ff-only
git branch -d merge/T042-to-main
```

Context for resolution:
- `rudder memory:show ENNN --full` (epic patterns)
- `rudder task:show TNNN` (task intent)
- `git diff main...agent/TNNN --name-only` (changed files)
