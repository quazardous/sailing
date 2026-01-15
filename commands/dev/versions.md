---
description: Show component versions
allowed-tools: Bash
---

```bash
bin/rudder versions [--json]
```

Displays all components from `.sailing/components.yaml`:
- **key**: Component identifier (used in `--target-version=key:x.y.z`)
- **version**: Current version (read via extractor)
- **file**: Where version is stored
- **changelog**: Path to CHANGELOG.md

Use `--json` for machine-readable output with all fields.
