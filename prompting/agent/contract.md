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

When blocked by an imperative issue requiring human intervention:

```json
// MCP: artefact_create
{ "type": "panic", "scope": "TNNN", "title": "Brief description of blocker", "source": "agent" }
```

Then edit the panic with details:
```json
// MCP: artefact_edit
{ "id": "PNNN", "content": "## Description\n\n<what happened>\n\n## Impact\n\n<what is blocked>" }
```

Then **STOP**. Do not continue. Human resolves the panic.
