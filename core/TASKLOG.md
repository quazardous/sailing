# Task Logging

Agent → Epic memory communication via `rudder task:log`. Logs must be **actionable**.

## Why Log?

Logs exist so that:
- The next agent on this epic avoids the same pitfalls
- Architectural or technical decisions are not rediscovered

## Minimum Expectation

- At least **2 log entries per task**
- Typical tasks produce **2–5 entries**

## Triggers — You MUST log when:

- At task start (execution intent)
- After each significant deliverable is completed
- When discovering a constraint, workaround, or non-obvious insight
- Before marking the task as Done

## Granularity

Do NOT log trivial steps. Log only information useful to:
- Another agent working on the same epic
- Yourself if resuming this task in 2 weeks

| Log | Don't log |
|-----|-----------|
| Discovered useful pattern | Each file you read |
| Found issue or workaround | Every small step |
| Useful command to remember | "Started working on X" |
| Blocker or significant error | Obvious progress |

## Command

```bash
rudder task:log TNNN "message" --level [-f file] [-c cmd] [-s snippet]
```

## Levels

| Flag | When |
|------|------|
| `--info` | Progress milestones (default) |
| `--tip` | Learnings, commands, patterns to remember |
| `--warn` | Issues encountered, workarounds applied |
| `--error` | Significant problems requiring review |
| `--critical` | Cannot continue, blocks task |

## Metadata

| Flag | Purpose |
|------|---------|
| `-f, --file <path>` | Related file (repeatable) |
| `-c, --cmd <command>` | Command to run |
| `-s, --snippet <code>` | Code snippet |

## Be Precise

Logs must be **specific and actionable**. Vague logs are useless.

### BAD

```bash
rudder task:log T042 "found edge case" --warn
rudder task:log T042 "refactored code" --info
rudder task:log T042 "useful command" --tip
```

### GOOD

```bash
# What + where + why
rudder task:log T042 "FormBuilder.validate() returns false for empty arrays - should return true per spec" \
  --warn -f admin/src/composables/useFormBuilder.js

# Tip with command
rudder task:log T042 "Run demo with hot reload" --tip -c "make qddemo"

# Progress with file
rudder task:log T042 "Implemented CRUD for BotManager" --info -f admin/src/managers/BotManager.js

# Error with snippet
rudder task:log T042 "EntityManager.getById throws when id contains slash" \
  --error -f packages/qdadm/src/EntityManager.js -s "id.split('/') fails"

# Critical blocker
rudder task:log T042 "Cannot implement: API endpoint /api/bots missing from OpenAPI spec" \
  --critical -f skynet/openapi.yaml
```

## What to Log

| Situation | Level | Include |
|-----------|-------|---------|
| Started major step | `--info` | What you're implementing |
| Found useful pattern | `--tip` | Pattern + where it applies |
| Discovered command | `--tip` | Command with `-c` flag |
| Hit issue, found workaround | `--warn` | Issue + workaround + file |
| Bug in existing code | `--error` | What's wrong + file + snippet |
| Cannot proceed | `--critical` | What's missing + why blocking |

## Escalation

| Level | Action |
|-------|--------|
| `--info`, `--tip`, `--warn` | Continue working |
| `--error` | Pause if no workaround |
| `--critical` | **Stop immediately**, return to main thread |

---

## Related

- **Read memory before work**: `rudder task:show-memory TNNN`
- **Memory consolidation**: See SKILL.md "Epic Memory" section
