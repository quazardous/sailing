
---

## ⚠️ Worktree Mode Active

**Skill orchestrates. Skill NEVER implements.**

When working on tasks:
1. Run `context:load task-start --role skill`
2. Workflow shows `agent:spawn` → you MUST spawn
3. Reap: `agent:reap TNNN` (waits, merges, cleans up, updates status)
4. If reap fails → follow guidance or reject via `agent:reject`

**Merge = Agent Job (MANDATORY):**
- `agent:reap` handles merge automatically → preferred path
- If reap reports conflicts → **spawn agent with `/dev:merge TNNN`**
- **NEVER merge manually** in the skill session
- Skill orchestrates, agent merges

**Unmerged Worktrees:**
- Check: `agent:status --unmerged`
- Each unmerged worktree needs: `agent:reap TNNN` or `/dev:merge TNNN`
- End of session reminder: "X worktrees unmerged - use `/dev:merge` to complete"

**Violations:**
- Reading task files "to help" without spawning
- Implementing deliverables yourself
- Any file modification outside status/memory/deps
- **Merging or resolving conflicts yourself** (spawn agent with `/dev:merge`)

Agents are disposable. Worktrees are disposable. Memory is not.
