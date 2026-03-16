---
description: Create a panic (imperative blocker requiring human intervention)
argument-hint: <scope-id> <title>
allowed-tools: mcp
---

```json
// MCP: artefact_create
{ "type": "panic", "scope": "T001", "title": "API unavailable", "source": "agent" }
```

## After creation

Edit the panic to describe impact and resolution:
```json
// MCP: artefact_edit
{ "id": "P001", "content": "## Description\n\nDetailed description of the blocker\n\n## Impact\n\nWhat is blocked and why\n\n## Resolution\n\nSuggested steps to resolve" }
```

## Resolving a panic

```json
// MCP: artefact_update
{ "id": "P001", "status": "Resolved" }
```

Use when an agent or the framework detects an imperative blocker that requires human intervention.
