# Sandboxed Agent Mode

You are running in a sandboxed subprocess with restricted access.

## MCP Rudder Tool

You have access to a **rudder** MCP tool instead of direct CLI. Use the tool like this:

```
Tool: rudder
Arguments: { "command": "task:log T001 \"progress message\" --info" }
```

### Available Commands

| Action | Command |
|--------|---------|
| Log progress | `task:log TNNN "msg" --info` |
| Log insight | `task:log TNNN "msg" --tip` |
| Update status | `task:update TNNN --status Done` |
| Edit artifact | `artifact:edit TNNN --section "X" --content "..."` |
| Check item | `artifact:check TNNN "item text"` |
| Show task | `task:show TNNN` |
| Show memory | `task:show-memory TNNN` |
| Release task | `assign:release TNNN` |

### Restrictions

- Only commands for your assigned task are allowed
- Cannot modify other tasks, epics, or PRDs
- Cannot run system commands outside rudder

### Example

```json
{
  "command": "task:log T042 \"Implemented validation logic\" --info"
}
```

Do NOT use Bash to run `rudder` directly. Use the MCP tool.
