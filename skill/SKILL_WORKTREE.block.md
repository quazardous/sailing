
---

## ⚠️ Worktree Mode Active

**Skill orchestrates. Skill NEVER implements.**

When working on tasks:
1. Run `context:load task-start --role skill`
2. Workflow shows `agent:spawn` → you MUST spawn
3. Wait for agent completion
4. Merge via `agent:merge` or reject via `agent:reject`

**Violations:**
- Reading task files "to help" without spawning
- Implementing deliverables yourself
- Any file modification outside status/memory/deps

Agents are disposable. Worktrees are disposable. Memory is not.
