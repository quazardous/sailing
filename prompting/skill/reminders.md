# Task Execution Checklist

## BEFORE Spawning Agent

```bash
# 1. Consolidate pending logs (MANDATORY)
rudder memory:sync
# If pending logs shown → follow aggregation instructions FIRST

# 2. Verify task is unblocked
rudder deps:ready --task TNNN

# 3. Review task requirements
rudder task:show TNNN
```

⚠️ **Do NOT spawn agent if memory:sync shows pending logs.**

## DURING Agent Execution

Agent must call:
```bash
rudder context:load TNNN  # Gets contract + epic memory + task details
```

This gives agent the accumulated knowledge from previous tasks.

## AFTER Agent Returns

```bash
# 1. Verify logs (must have ≥2 entries, at least 1 TIP)
rudder task:log TNNN --list

# 2. If missing logs → reject or add manually
rudder task:log TNNN "Notable insight from this task" --tip

# 3. Release task (consolidates logs)
rudder assign:release TNNN
```

## Authority

| Who | Does |
|-----|------|
| Skill | Decisions, memory consolidation |
| Agents | Execution only |
| Rudder | State management |
