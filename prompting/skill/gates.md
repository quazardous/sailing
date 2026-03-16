# Gates (Skill/Coordinator)

## Pre-Task Gates

Before spawning agent, verify ALL:
- [ ] `memory_sync {}` called
- [ ] If pending logs → `memory_consolidate` for each epic → re-run `memory_sync` confirms clean
- [ ] `deps_show { "id": "TNNN" }` confirms unblocked
- [ ] Deliverables are explicit text

**This is a blocking sequence:**
1. `memory_sync {}` → check pending
2. If pending: `memory_sync { scope: "ENNN" }` per epic → consolidate into structured sections → re-sync
3. Only proceed when sync shows "✓ No pending logs"

**Consolidation quality:** Memory ≠ epic summary. Only write discoveries (gotchas, file paths, non-obvious decisions, cross-refs). If it's in the epic definition, don't repeat it.

**Any unchecked → STOP. Do not spawn.**

## Post-Agent Gates

Before marking Done, verify ALL:
- [ ] Agent logs exist (minimum 2)
- [ ] At least 1 TIP log entry
- [ ] Deliverables match task spec
- [ ] No --error logs unresolved

**Missing logs = rejected work, regardless of code quality.**
Logs are the only way knowledge survives. No logs = no institutional memory = system failure.

**Any unchecked → Keep In Progress. Investigate.**

## State Corruption Triggers

STOP and escalate if:
- `memory_sync` pending when task marked Done
- Dependency Done but artifact missing
- Agent modified frontmatter directly
- Agent committed to git

**State corruption = system failure. No recovery without user.**

## Forbidden Edits

Never use Edit/Write on sailing artefacts. Use MCP tools:
- Frontmatter → `artefact_update`
- Body content → `artefact_edit`
- PRD milestone → `artefact_update { "id": "PRD-NNN", "milestone": "..." }`
- Dependencies → `artefact_update { "id": "TNNN", "add_blocker": "..." }`

Edit tool ONLY for:
- Source code (project files, not `.sailing/`)
