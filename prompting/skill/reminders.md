# Task Execution Checklist

## BEFORE Spawning Agent

```json
// MCP: memory_sync
{}
```

### If memory_sync shows "⚠ PENDING LOGS":

**You MUST consolidate before continuing.**

`memory_sync {}` (no scope) returns a **lightweight summary** — epic IDs, counts, levels. No parsed entries.

**Consolidation flow per epic:**

1. **Get entries** for the pending epic:
   ```json
   // MCP: memory_sync
   { "scope": "E001" }
   ```
   Returns full `parsedEntries` for that epic only.

2. **Synthesize** into the right sections. Distribute content by type:

   | Section | What goes here |
   |---------|---------------|
   | `Key Files` | File paths + roles (one line each) |
   | `Gotchas` | Traps discovered + solutions |
   | `Decisions` | Non-obvious choices + rationale |
   | `Cross-refs` | Links to other epics |
   | `Escalation` | Unresolved issues [TNNN] |
   | `Changelog` | What was built (summary, not logs) |

3. **Write** each section:
   ```json
   // MCP: memory_consolidate
   { "level": "epic", "target_id": "E001", "section": "Gotchas", "content": "- INSERT IGNORE swallows CHECK constraint errors → use ON DUPLICATE KEY UPDATE" }
   ```
   This **replaces** the section, **auto-flushes** logs, and **creates** the memory file if needed.

4. **Escalate** cross-epic patterns to PRD level:
   ```json
   // MCP: memory_consolidate
   { "level": "prd", "target_id": "PRD-001", "section": "Cross-Epic Patterns", "content": "- Claim endpoint is integration point between E0099, E0100, E0102" }
   ```

5. **Repeat** for each pending epic.

6. **Re-run** `memory_sync {}` to confirm "✓ No pending logs".

### Consolidation Quality Rules

**Memory = only what was DISCOVERED, not what was KNOWN.**

- If it's in the epic definition → it doesn't belong in memory
- No epic summaries — the epic file already says what the epic is
- Gotchas and file paths have the highest value-per-byte
- One concrete gotcha > three paragraphs of context
- Cross-refs are critical for multi-epic coordination — always capture them

⚠️ **Do NOT spawn agent until memory_sync shows "✓ No pending logs".**

### Then continue preflight:

```json
// MCP: deps_show
{ "id": "TNNN" }
```

## DURING Agent Execution

Agent must call:
```json
// MCP: context_load
{ "task_id": "TNNN", "role": "agent" }
```

This gives agent the accumulated knowledge from previous tasks.

## AFTER Agent Returns

```json
// 1. Verify logs (must have ≥2 entries, at least 1 TIP)
// MCP: task_log
{ "task_id": "TNNN", "list": true }

// 2. If missing logs → reject or add manually
// MCP: task_log
{ "task_id": "TNNN", "message": "Notable insight from this task", "level": "tip" }

// 3. Release task (consolidates logs)
// MCP: assign_release
{ "task_id": "TNNN" }
```

**Hard gate:** Agent work with <2 logs or 0 TIPs = rejected. Missing logs means lost knowledge.

## Authority

| Who | Does |
|-----|------|
| Skill | Decisions, memory consolidation |
| Agents | Execution only |
| MCP tools | State management |
