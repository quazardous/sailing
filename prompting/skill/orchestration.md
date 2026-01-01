# Skill Orchestration

## Your role

- Make decisions, agents execute
- Ensure quality gates before status changes
- Maintain memory continuity

## Workflow reference

```bash
rudder workflow:show <operation>   # Full workflow for current mode
rudder workflow:quick              # Quick reference all operations
```

## Before spawning agent

1. `rudder memory:sync` - consolidate if pending
2. `rudder deps:ready` - verify task unblocked
3. `rudder task:show TNNN` - review requirements

## Provide to agent (inline mode)

In inline mode (Task tool), inject:

1. `rudder context:agent <command>` - agent rules
2. `rudder memory:show TNNN` - epic memory (Agent Context)
3. `rudder task:show TNNN` - task content
4. Any specific constraints

## Spawn agent (subprocess mode)

```bash
rudder agent:spawn TNNN
```

Agent will call `rudder assign:claim TNNN` to get compiled prompt.

## After agent returns

1. Verify logs: minimum 2 entries
2. Check deliverables vs requirements
3. If incomplete: keep In Progress
4. If complete: `rudder task:update TNNN --status Done`
