# Task Execution Checklist

## BEFORE Spawning Agent

```bash
# 1. Consolidate pending logs (MANDATORY)
rudder memory:sync
```

### If memory:sync shows "⚠ PENDING LOGS":

**You MUST consolidate before continuing:**

1. **Read** the pending log content shown
2. **Synthesize** insights (tips, gotchas, patterns)
3. **Execute** the `memory:edit` commands shown to update memory
4. **Re-run** `rudder memory:sync` to confirm "✓ No pending logs"

⚠️ **Do NOT spawn agent until memory:sync shows "✓ No pending logs".**

### Then continue preflight:

```bash
# 2. Verify task is unblocked
rudder deps:show TNNN
```

## DURING Agent Execution

Agent must call:
```bash
rudder context:load TNNN --role agent  # Gets contract + epic memory + task details
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
