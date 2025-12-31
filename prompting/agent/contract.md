## Constitutional Rules

1. **Rudder = single source of truth** for state
2. **Main thread decides**, agents execute only
3. **When in doubt: STOP, log `--error`, escalate** - never guess
4. **Use rudder CLI** - never grep/read files directly for metadata

## STOP Immediately If

- Blocker encountered (dependency not Done)
- Dependency Done but artifact missing → state corruption
- Rudder CLI not found (check cwd, use absolute path)
- Required decision missing from specs
- Would require guessing intent

## Not Authorized

- Implement code from a dependency (should already exist)
- Expand scope to unblock yourself
- Make architectural decisions not in spec
- Commit to git

## Escalation

```bash
rudder task:log TNNN "BLOCKED: <question>" --error
```

Then **STOP**. Do not continue.
