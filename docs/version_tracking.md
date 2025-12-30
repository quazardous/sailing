# Version Tracking

Sailing tracks versions of your project components using `.sailing/components.yaml`.

## Core Concept

**Version is always a couple: component + version.** Never manipulate a version alone.

```
core: 0.4.0
api: 0.4.0
cli: 0.2.0
```

## components.yaml

Define your tracked components in `.sailing/components.yaml`:

```yaml
components:
  core:
    version: "0.1.0"
    file: package.json
    extractor: json
    path: version
    changelog: CHANGELOG.md

  api:
    version: "0.1.0"
    file: api/package.json
    extractor: json
    path: version
    changelog: api/CHANGELOG.md

  cli:
    version: "0.1.0"
    file: cli/version.txt
    extractor: text
    changelog: cli/CHANGELOG.md
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Current version (semver) |
| `file` | Yes | File containing the version |
| `extractor` | Yes | How to read/write version: `json`, `yaml`, `text` |
| `path` | For json/yaml | Dot-notation path to version field |
| `changelog` | No | Path to component's CHANGELOG.md |

### Extractors

| Extractor | File Type | Example |
|-----------|-----------|---------|
| `json` | package.json, etc. | `{"version": "1.0.0"}` |
| `yaml` | config.yaml, etc. | `version: 1.0.0` |
| `text` | version.txt | `1.0.0` (file contains only version) |

## CLI Commands

```bash
# Show all component versions
bin/rudder versions
bin/rudder versions --json

# Bump a version
bin/rudder version:bump <component> <patch|minor|major> ["changelog entry"]
```

## Target Versions

Tasks and Epics can specify target versions:

```yaml
# In task frontmatter
target_versions:
  core: "0.5.0"
  api: "0.5.0"
```

### CLI Usage

```bash
# Create task with target version
bin/rudder task:create PRD-001/E001 "Add feature" --target-version=core:0.5.0

# Multiple targets
bin/rudder task:create PRD-001/E001 "Add feature" \
  --target-version=core:0.5.0 \
  --target-version=api:0.5.0
```

## Semver Rules

| Type | When | Example |
|------|------|---------|
| `patch` | Bug fix, no API change | 0.4.0 → 0.4.1 |
| `minor` | New feature, backward compatible | 0.4.0 → 0.5.0 |
| `major` | Breaking change | 0.4.0 → 1.0.0 |

## Changelog

Each component can maintain its own CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/).

When bumping:
```bash
bin/rudder version:bump core minor "Added user authentication"
```

This:
1. Updates version in `package.json` (or configured file)
2. Adds entry to `CHANGELOG.md`
3. Updates `components.yaml`

## Workflow

1. **Task/Epic creation**: Specify `--target-version` for affected components
2. **Implementation**: Complete the work
3. **Task completion**: Verify changes match expected bump
4. **Version bump**: `bin/rudder version:bump <component> <type>`
5. **Milestone validation**: Check all versions match targets

## Milestones

PRDs can define milestone versions:

```yaml
# In PRD frontmatter
milestones:
  - id: M1
    name: "MVP"
    versions:
      core: "0.5.0"
      api: "0.5.0"
  - id: M2
    name: "Beta"
    versions:
      core: "1.0.0"
```

Use `/dev:milestone-validate` to check if all target versions are reached.

## Skill Workflow Integration

Versions flow through the sailing workflow at key decision points:

### 1. PRD Review (`/dev:prd-review`)

The skill:
- Runs `rudder versions` to get current component versions
- Reviews proposed milestones
- Suggests target versions for each milestone based on scope
- Example: "M1 adds auth feature → core: 0.5.0 (minor bump)"

### 2. Task Creation

When creating tasks, specify which versions they contribute to:
```bash
bin/rudder task:create PRD-001/E001 "Add login API" \
  --target-version=core:0.5.0 \
  --target-version=api:0.5.0
```

### 3. Task Completion

After `/dev:task-done`, the skill checks for `target_versions` in the task frontmatter.

**Decision point** (from SKILL.md):
```
| Output | → Next |
|--------|--------|
| Task has target_versions | /dev:version-bump |
```

### 4. Version Bump (`/dev:version-bump`)

The skill:
1. Reads `components.yaml` for component config
2. Reads current version from configured file
3. **Obsolescence check**: If current version ≥ target version → warns user
4. Increments version (patch/minor/major)
5. Updates CHANGELOG.md (Keep a Changelog format)
6. Reports: old → new version

```bash
bin/rudder version:bump core minor "Added user authentication"
```

### 5. Milestone Validation

After all tasks complete:
```bash
/dev:milestone-validate
```

Checks all target versions against actual versions.

## Version Flow Diagram

```
PRD Review                    Task Creation           Task Completion
    │                              │                        │
    ▼                              ▼                        ▼
suggest milestone        set target_versions         check target_versions
    versions                   in task                      │
    │                              │                        ▼
    ▼                              ▼                  /dev:version-bump
update PRD               frontmatter saved                  │
milestones[]                                               ▼
                                                    bump + changelog
                                                           │
                                                           ▼
                                                   milestone-validate
```

## Changelog Format

Sailing uses [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [Unreleased]

## [0.5.0] - 2024-01-15

### Added
- User authentication system
- Login/logout API endpoints

### Changed
- Session handling improved

## [0.4.0] - 2024-01-10
...
```

Each component can have its own CHANGELOG.md at the path defined in `components.yaml`.

## Obsolescence Detection

When bumping, the skill checks if any task/epic still references an older target:

```
Current: core=0.5.0
Task T042 has: target_versions: { core: "0.4.0" }
→ WARN: Target is obsolete, update task spec?
```

This prevents specs from drifting behind reality.
