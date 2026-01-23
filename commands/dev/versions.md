---
description: Show component versions
allowed-tools: mcp
---

```json
// MCP: system_versions
{}
```

Displays all components from `.sailing/components.yaml`:
- **key**: Component identifier (used in `--target-version=key:x.y.z`)
- **version**: Current version (read via extractor)
- **file**: Where version is stored
- **changelog**: Path to CHANGELOG.md

Use JSON output for machine-readable output with all fields.
