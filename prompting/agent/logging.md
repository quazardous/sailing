# Logging Contract

Logs preserve knowledge across agent boundaries.

## Command

```bash
rudder task:log TNNN "<message>" [--info | --tip | --warn | --error]
```

## When to log

| Trigger | Level |
|---------|-------|
| Task start | `--info` |
| Deliverable completed | `--info` |
| Non-obvious insight | `--tip` |
| Issue or workaround | `--warn` |
| Cannot continue | `--error` |

## Minimum requirement

**At least 2 log entries per task:**
1. At start: `--info` "Starting: <goal>"
2. Before done: `--tip` "<key insight for next agent>"

## What NOT to log

Trivial steps, obvious progress, redundant info.
