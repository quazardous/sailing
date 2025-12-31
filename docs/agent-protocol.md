# Agent Protocol v1

The Agent Protocol defines structured communication between the orchestrator (main thread) and spawned agents.

## Overview

```
Orchestrator ──[Mission]──► Agent
                              │
                              ▼
                         [Execution]
                              │
Orchestrator ◄──[Result]──────┘
```

## Mission Schema (v1)

The mission defines what an agent must accomplish.

```yaml
version: "1"
task_id: "T042"
epic_id: "E005"
prd_id: "PRD-001"

instruction: |
  Implement the user authentication module.

context:
  dev_md: "path/to/DEV.md"
  epic_file: "path/to/epic.md"
  task_file: "path/to/task.md"
  memory: "path/to/memory.md"
  toolset: "path/to/TOOLSET.md"  # optional

constraints:
  max_files: 10          # max files to modify
  no_git_commit: true    # agent must not commit
  no_new_deps: false     # can add dependencies

timeout: 600             # seconds (0 = no timeout)
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Protocol version ("1") |
| `task_id` | string | yes | Task identifier (TNNNNN, e.g. T042) |
| `epic_id` | string | yes | Parent epic (ENNNN, e.g. E005) |
| `prd_id` | string | yes | Parent PRD (PRD-NNN) |
| `instruction` | string | yes | Natural language task description |
| `context` | object | yes | Paths to context files |
| `context.dev_md` | string | no | Path to DEV.md (if exists) |
| `context.epic_file` | string | yes | Path to epic file |
| `context.task_file` | string | yes | Path to task file |
| `context.memory` | string | no | Path to epic memory file |
| `context.toolset` | string | no | Path to TOOLSET.md |
| `constraints` | object | no | Execution constraints |
| `constraints.max_files` | number | no | Max files to modify |
| `constraints.no_git_commit` | boolean | no | Prevent git commits |
| `constraints.no_new_deps` | boolean | no | Prevent new dependencies |
| `timeout` | number | no | Timeout in seconds (0 = none) |

## Result Schema (v1)

The result reports agent execution outcome.

```yaml
version: "1"
task_id: "T042"
status: "completed"  # completed | failed | blocked

files_modified:
  - path: "src/auth/login.js"
    action: "created"
  - path: "src/auth/logout.js"
    action: "modified"

log:
  - level: "info"
    message: "Created authentication module"
    timestamp: "2025-01-15T10:30:00Z"
  - level: "tip"
    message: "Use bcrypt for password hashing"
    timestamp: "2025-01-15T10:35:00Z"

issues: []  # or list of issue objects

completed_at: "2025-01-15T10:45:00Z"
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Protocol version ("1") |
| `task_id` | string | yes | Task identifier (TNNNNN, e.g. T042) |
| `status` | string | yes | Outcome: completed, failed, blocked |
| `files_modified` | array | yes | List of modified files |
| `files_modified[].path` | string | yes | Relative file path |
| `files_modified[].action` | string | yes | created, modified, deleted |
| `log` | array | yes | Log entries (min 2 required) |
| `log[].level` | string | yes | info, tip, warn, error, critical |
| `log[].message` | string | yes | Log message |
| `log[].timestamp` | string | yes | ISO 8601 timestamp |
| `issues` | array | no | Escalated issues |
| `issues[].type` | string | yes | blocker, question, concern |
| `issues[].description` | string | yes | Issue description |
| `completed_at` | string | yes | ISO 8601 completion timestamp |

### Status Values

| Status | Meaning |
|--------|---------|
| `completed` | Task finished successfully |
| `failed` | Task failed (error, cannot proceed) |
| `blocked` | Task blocked by external factor |

### Log Levels

| Level | When to Use |
|-------|-------------|
| `info` | Progress milestones |
| `tip` | Patterns, commands, reusable knowledge |
| `warn` | Issues, workarounds applied |
| `error` | Significant problems |
| `critical` | Cannot continue |

## Validation

Use `cli/lib/agent-schema.js` for validation:

```javascript
import { validateMission, validateResult } from './lib/agent-schema.js';

// Validate mission
const mission = { ... };
const missionErrors = validateMission(mission);
if (missionErrors.length > 0) {
  console.error('Invalid mission:', missionErrors);
}

// Validate result
const result = { ... };
const resultErrors = validateResult(result);
if (resultErrors.length > 0) {
  console.error('Invalid result:', resultErrors);
}
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2025-01 | Initial protocol |
