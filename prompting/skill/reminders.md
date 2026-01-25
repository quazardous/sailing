# Task Execution Checklist

## BEFORE Spawning Agent

```json
// MCP: memory_sync
{}
```

### If memory_sync shows "⚠ PENDING LOGS":

**You MUST consolidate before continuing:**

1. **Review** pending logs with `memory_pending_logs { "epic_id": "E001" }`
2. **Synthesize** insights (tips, gotchas, patterns) from the log entries
3. **Write** synthesized content to memory sections:
   ```json
   // MCP: memory_consolidate
   { "level": "epic", "target_id": "E001", "section": "Agent Context", "content": "- Key insight from logs..." }
   ```
4. **Escalate** important patterns to PRD level if cross-epic:
   ```json
   // MCP: memory_consolidate
   { "level": "prd", "target_id": "PRD-001", "section": "Cross-Epic Patterns", "content": "..." }
   ```
5. **Flush** logs once all relevant content is consolidated:
   ```json
   // MCP: memory_flush_logs
   { "epic_id": "E001" }
   ```
6. **Re-run** `memory_sync {}` to confirm "✓ No pending logs"

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

## Authority

| Who | Does |
|-----|------|
| Skill | Decisions, memory consolidation |
| Agents | Execution only |
| MCP tools | State management |
