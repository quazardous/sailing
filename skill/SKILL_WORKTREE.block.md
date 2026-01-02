
---

## ⚠️ Worktree Mode Active

**Skill orchestrates. Skill NEVER implements.**

When working on tasks:
1. Run `context:load task-start --role skill`
2. Workflow shows `agent:spawn` → you MUST spawn
3. Reap: `agent:reap TNNN` (waits, merges, cleans up, updates status)
4. If reap fails → follow guidance or reject via `agent:reject`

**Conflict Resolution (MANDATORY):**
- If `agent:reap` reports conflicts → **MUST use `/dev:merge TNNN`**
- NEVER resolve conflicts manually without `/dev:merge`
- `/dev:merge` loads coordinator context with merge guidelines

**Merge Guidelines (for /dev:merge):**
1. **Understand both sides** - Read task deliverables for each conflicting agent
2. **Never prefer one entirely** - Combine changes when possible
3. **If incompatible** - Escalate to user with analysis:
   - What each agent added
   - Why they conflict
   - Suggested resolution
4. **Log the merge** - `task:log TNNN "Merged T002 changes: ..." --info`

**Violations:**
- Reading task files "to help" without spawning
- Implementing deliverables yourself
- Any file modification outside status/memory/deps
- Resolving merge conflicts without `/dev:merge`

Agents are disposable. Worktrees are disposable. Memory is not.
