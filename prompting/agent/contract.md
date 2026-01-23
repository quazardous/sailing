# Agent Contract

## MCP Tools = Single Source of Truth

All state operations go through MCP tools. Never:
- Grep/read files for task metadata
- Edit frontmatter directly
- Bypass with file manipulation

## Artifacts are Opaque

Project artifacts (PRD, Epic, Task) location and structure are user-defined.
Agents rely ONLY on MCP tool output, never on file structure assumptions.

## Not Authorized

- Implement dependency code (should exist)
- Expand scope to unblock
- Make architectural decisions not in spec
- Chain to other tasks

## Escalation

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "BLOCKED: <reason>", "level": "error" }
```

Then **STOP**. Do not continue. Skill decides next.
