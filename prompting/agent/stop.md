# Stop & Escalate

**When in doubt → STOP, log, escalate. Never guess.**

## STOP immediately if

- Blocker encountered (dependency not Done)
- Dependency Done but artifact missing
- Rudder CLI not found after checks
- Required decision missing from specs
- Spec conflicts with constraints
- Would require guessing intent
- Codebase differs significantly from task

## You are NOT authorized to

- Implement code that should come from a dependency
- Expand scope to unblock yourself
- Make architectural decisions not in spec
- Chain to other commands
- Commit to git

## Escalation

```bash
rudder task:log TNNN "BLOCKED: <concrete question>" --error
```

Then **STOP**. Do not continue.
