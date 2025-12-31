---
description: Bump version + update changelog
argument-hint: "[component-key] [patch|minor|major] [\"changelog entry\"]"
allowed-tools: Read, Edit, Bash, Grep
---

**Bump component version and maintain changelog.**

> 📖 CLI reference: `bin/rudder -h`

**Arguments:** $ARGUMENTS

---

## Pre-flight (MANDATORY)

```bash
rudder context:skill version-bump   # Execution context
rudder versions                      # List components and current versions
```

---

## Argument Resolution

When arguments are incomplete, resolve interactively:

| Missing | Resolution |
|---------|------------|
| **component** | If only one component exists → use it. Otherwise ask user to choose from `rudder versions` output |
| **bump type** | Ask user: patch (bug fix), minor (feature), or major (breaking)? |
| **changelog** | Ask user what changed. Suggest based on recent git commits if available |

### Discovery Workflow

```bash
# 1. List available components
rudder versions

# 2. Check recent work (optional, for changelog suggestion)
git log --oneline -10

# 3. Check if tasks have target_versions for this component
rudder task:targets <component>
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

---

## Common Scenarios

### User says "bump version" (no details)

1. Run `rudder versions` to list components
2. If single main component → propose it
3. Ask bump type (patch/minor/major)
4. Ask for changelog entry or suggest from recent commits

### User says "bump + changelog" after completing work

1. Run `rudder versions` to identify main component
2. Run `git log --oneline -10` to see recent changes
3. Propose: component, bump type, changelog summary
4. Confirm with user before executing

### After task completion with target_versions

1. Check task's `target_versions` for expected version
2. If current < target → bump to match
3. Use task title/description for changelog entry

---

## Non-Goals

This command does **NOT**:
- Git commit or push (user controls commits)
- Modify task/epic status
- Chain to other commands
