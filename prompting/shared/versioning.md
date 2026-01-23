# Versioning

## MCP Tools

```json
// MCP: version_list
{}                              // All components
{ "component": "X" }            // Specific
```

## Bump Workflow

1. Identify change type (major/minor/patch)
2. `version_bump { "component": "<component>", "type": "<type>" }`
3. Update changelog
4. User commits

Bumps require user approval.
