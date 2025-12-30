---
description: Bump version + update changelog
argument-hint: <component-key> <patch|minor|major> ["changelog entry"]
allowed-tools: Read, Edit, Bash, Grep
---

**Bump component version and maintain changelog.**

> 📖 CLI reference: `bin/rudder -h`

## Pre-check

```bash
rudder versions   # List all components and current versions
```

## Components

Defined in `.sailing/components.yaml`.

## Usage

```
/dev:version-bump <component-key> minor "New task scheduler"
/dev:version-bump <component-key> patch "Add /users endpoint"
```

Use `bin/rudder versions` to list available component keys from `.sailing/components.yaml`.

## Agent workflow

1. **Read** `.sailing/components.yaml` to get component config (file, extractor, path, changelog)
2. **Read current version** using the appropriate extractor
3. **Obsolescence check**:
   - Search `target_versions` in tasks/epics for this component
   - If current version >= any target version: **WARN** user that target may be stale
   - Example: current=0.5.0, target=0.4.0 → target is obsolete
4. **Increment** semver in version file
5. **Update CHANGELOG** at path from `changelog` field (create if missing):
   - Format: [Keep a Changelog](https://keepachangelog.com/)
   - Add entry under `## [Unreleased]` or create new version section
6. **Report** old → new version

## Obsolescence detection

```bash
# Find tasks/epics targeting this component
bin/rudder task:targets <component>
```

If target_versions references a version lower than current:
- **Ask user**: Update the task's target_version, or proceed anyway?
- This prevents specs from drifting behind reality.

## Semver rules

| Type | When |
|------|------|
| `patch` | Bug fix, no API change |
| `minor` | New feature, backward compatible |
| `major` | Breaking change (ask user first) |
