## Worktree Mode (Coordinator)

Agent work is isolated in git worktrees with dedicated branches.

### Branch Structure

| Type | Pattern | Example |
|------|---------|---------|
| Agent | `agent/<task-id>` | `agent/T042` |
| Task | `task/<id>` | `task/T042` |
| Epic | `epic/<id>` | `epic/E001` |
| Merge | `merge/<source>-to-<target>` | `merge/T042-to-E001` |

### Worktree MCP Tools

| MCP Tool | Purpose |
|----------|---------|
| `worktree_status {}` | All worktrees state |
| `worktree_preflight {}` | Blockers, merge order |
| `worktree_merge { "task_id": "TNNN" }` | Merge task to parent |
| `worktree_cleanup { "task_id": "TNNN" }` | Remove worktree + branch |
| `worktree_reconcile {}` | Diagnose branch state |

### Merge Workflow

1. Check status: `worktree_status {}`
2. Check conflicts: `git merge-tree $(git merge-base main origin/agent/TNNN) main origin/agent/TNNN`
3. If clean: `worktree_merge { "task_id": "TNNN" }`
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
- `memory_read { "scope": "ENNN", "full": true }` (epic patterns)
- `artefact_show { "id": "TNNN" }` (task intent)
- `git diff main...agent/TNNN --name-only` (changed files)
