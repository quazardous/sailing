---
description: Rewrite tasks after tech/orientation change
argument-hint: <PRD-NNN> "<change description>"
allowed-tools: Read, Edit, Glob, Grep, Task, Bash
---

**Rewrites task descriptions after a tech change or orientation shift.**

> 📖 CLI reference: `.sailing/core/RUDDER.md` or `bin/rudder -h`

## Workflow

1. **Understand the change**: User describes what changed (new lib, pattern shift, API change, etc.)

2. **Identify affected tasks**:
   ```bash
   bin/rudder task:list --prd PRD-NNN --json
   ```
   Analyze each task to find those impacted by the change.

3. **Present affected tasks**: List tasks that need rewriting, explain why each is affected.

4. **User confirms** which tasks to rewrite (may exclude some).

5. **Spawn rewrite agents** (parallel for independent tasks):
   ```
   ┌─ Agent(T001) ─┐
   ├─ Agent(T003) ─┼─► Parallel rewrite
   └─ Agent(T007) ─┘
   ```

## Agent prompt

```
You are rewriting a task description after this change:
"{change_description}"

Task file: {path}

Rules:
- Preserve task ID, title (adjust if needed), parent, effort
- Rewrite Description, Deliverables, Technical Details to align with new approach
- **NO CODE** - use workflow descriptions, pseudo-code at most
- Keep scope similar (don't expand/reduce task)
- If change makes task obsolete, say so clearly
- If change requires NEW tasks, list them (don't create)

Status: Keep current status unchanged.
```

Report: tasks rewritten, new tasks needed (if any), obsolete tasks (if any).

## After rewrite

```bash
# Validate dependencies still make sense
rudder deps:validate

# Check if dependency order needs adjustment
rudder deps:tree TNNN --ancestors  # for rewritten tasks

# Update dependencies if needed
rudder deps:add TNNN --blocked-by T001
rudder task:update TNNN --remove-blocker T002
```
