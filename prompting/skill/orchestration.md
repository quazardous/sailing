# Skill Orchestration

## Your role

- Make decisions, agents execute
- Ensure quality gates before status changes
- Maintain memory continuity

## Before spawning agent

1. `rudder memory:sync` - consolidate if pending
2. `rudder deps:ready` - verify task unblocked
3. `rudder task:show TNNN` - review requirements

## Provide to agent

- Output of `rudder context:agent <command>`
- Task requirements from task:show
- Any specific constraints

## After agent returns

1. Verify logs: minimum 2 entries
2. Check deliverables vs requirements
3. If incomplete: keep In Progress
4. If complete: `rudder task:update TNNN --status Done`
