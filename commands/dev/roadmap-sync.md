---
description: Sync ROADMAP with project reality
allowed-tools: Read, Edit, Glob, Grep, Task, mcp
---

**Verify and fix ROADMAP ↔ project sync.**

## Agent prompt

```
Sync ROADMAP.md with current project state.

1. **Read current state**
   ```json
   // MCP: system_status - for PRD/Epic/Task progress
   {}

   // MCP: system_versions - for current component versions
   {}
   ```
   - Read ROADMAP.md

2. **Check milestones table**
   - For each feature/phase in ROADMAP:
     - Is status accurate? (Draft/In Progress/Done)
     - Is version current or target?
   - Flag discrepancies

3. **Check phase checkboxes** (if present)
   - `- [x]` for implemented features
   - `- [ ]` for pending
   - Match with actual task/epic completion

4. **Propose updates**
   - List changes needed
   - User validates before applying

5. **Apply updates**
   - Update ROADMAP.md milestones table
   - Update checkboxes if applicable
```

Report: discrepancies found, updates applied.
