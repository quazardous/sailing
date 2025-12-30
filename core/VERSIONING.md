# Versioning

Per-component version management. Format: [Semver](https://semver.org/) (MAJOR.MINOR.PATCH).

## Core Concept

**Version is always a couple: component/version.** Never manipulate a version alone.

```
core: 0.4.0
api: 0.4.0
cli: 0.2.0
```

## Components

Defined in **`.sailing/components.yaml`**. Edit to add/remove tracked components.

```bash
rudder versions        # Show all components
rudder versions --json
```

## Frontmatter Format

### Task / Epic
```yaml
target_versions: { core: "0.5.0" }
# or multiple:
target_versions: { core: "0.5.0", api: "0.5.0" }
```

### PRD Milestones
```yaml
milestones:
  - id: M1
    versions: { core: "0.5.0", api: "0.5.0" }
```

## CLI Usage

```bash
# Create with target versions
rudder task:create PRD-001/E001 "Title" --target-version=core:0.5.0
rudder task:create PRD-001/E001 "Title" --target-version=core:0.5.0 --target-version=api:0.5.0

rudder epic:create PRD-001 "Title" --target-version=core:0.5.0
```

## Workflow

1. **Task/Epic creation**: Specify `--target-version=component:version` for each affected component
2. **Task completion**: Verify changes match expected bump
3. **Version bump**: `rudder version:bump <component> <patch|minor|major>`
4. **Milestone validation**: Check all component versions match targets

## Semver Rules

| Type | When |
|------|------|
| `patch` | Bug fix, no API change |
| `minor` | New feature, backward compatible |
| `major` | Breaking change |

## Changelog

Each component maintains its own CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/).
