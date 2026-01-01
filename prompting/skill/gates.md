# Gates (Skill/Coordinator)

## Pre-Task Gates

Before spawning agent, verify ALL:
- [ ] `memory:sync` shows no pending
- [ ] `deps:ready` confirms unblocked
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
- `memory:sync` pending when task marked Done
- Dependency Done but artifact missing
- Agent modified frontmatter directly
- Agent committed to git

**State corruption = system failure. No recovery without user.**

## Forbidden Edits

Never edit (use rudder CLI):
- Frontmatter (status, blocked_by, etc.)
- PRD milestone assignments
- Dependency graph

Allowed edits (Edit tool):
- Source code under project paths
- Task body: Description, Deliverables, Technical Details
