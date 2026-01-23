# Gates (Skill/Coordinator)

## Pre-Task Gates

Before spawning agent, verify ALL:
- [ ] `memory_sync {}` shows no pending
- [ ] `deps_show { "id": "TNNN" }` confirms unblocked
- [ ] Deliverables are explicit text

**Any unchecked → STOP. Do not spawn.**

## Post-Agent Gates

Before marking Done, verify ALL:
- [ ] Agent logs exist (minimum 2)
- [ ] At least 1 TIP log entry
- [ ] Deliverables match task spec
- [ ] No --error logs unresolved

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
