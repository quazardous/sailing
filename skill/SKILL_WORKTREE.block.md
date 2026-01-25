
---

## ⚠️ Worktree Mode Active

**Skill orchestrates. Skill NEVER implements.**

When working on tasks:
1. Run `context_load { "operation": "task-start", "role": "skill" }`
2. Workflow shows `agent_spawn` → you MUST spawn
3. Reap: `agent_reap { "task_id": "TNNN" }` (waits, merges, cleans up, updates status)
4. If reap fails → follow guidance or reject via `agent_reject`

**Merge = Agent Job (MANDATORY):**
- `agent_reap` handles merge automatically → preferred path
- If reap reports conflicts → **spawn agent with `/dev:merge TNNN`**
- **NEVER merge manually** in the skill session
- Skill orchestrates, agent merges

**Unmerged Worktrees:**
- Check: `agent_status { "unmerged": true }`
- Each unmerged worktree needs: `agent_reap { "task_id": "TNNN" }` or `/dev:merge TNNN`
- End of session reminder: "X worktrees unmerged - use `/dev:merge` to complete"

**Violations:**
- Reading task files "to help" without spawning
- Implementing deliverables yourself
- Any file modification outside status/memory/deps
- **Merging or resolving conflicts yourself** (spawn agent with `/dev:merge`)

Agents are disposable. Worktrees are disposable. Memory is not.
