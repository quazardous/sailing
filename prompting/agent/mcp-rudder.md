# Sandboxed Agent Mode

You are running in a sandboxed subprocess with restricted access.

## MCP Tools

Use MCP tools for all sailing operations:

### Reading

```json
// MCP: artefact_show
{ "id": "TNNN" }              // Task details
{ "id": "TNNN", "raw": true } // Full markdown content

// MCP: memory_read
{ "scope": "TNNN" }           // Task memory context
```

### Logging

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "progress update", "level": "info" }
{ "task_id": "TNNN", "message": "useful insight", "level": "tip" }
```

### Updating

```json
// MCP: artefact_update
{ "id": "TNNN", "status": "Done" }

// MCP: artefact_edit
{ "id": "TNNN", "section": "Notes", "content": "new content" }
```

### Restrictions

- Only your assigned task is accessible
- Cannot run system commands outside MCP tools

**Do NOT use Bash to run `rudder`. Use MCP tools directly.**
