---
description: Project status overview
allowed-tools: mcp
---

```json
// MCP: system_status
{}
```

## Additional views

```json
// PRD/Task lists
// MCP: artefact_list
{ "type": "prd" }

// MCP: artefact_list
{ "type": "task", "status": "In Progress" }

// Dependency analysis
// MCP: deps_critical - Critical paths + top blockers
{ "limit": 5 }

// MCP: workflow_ready - Ready tasks sorted by impact
{ "limit": 5 }

// MCP: workflow_validate - Check for cycles/issues
{}
```
