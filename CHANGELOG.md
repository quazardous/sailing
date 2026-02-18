# Sailing Changelog

All notable changes to the Sailing Framework will be documented in this file.

<!-- NOTE: This is a USER changelog, not a commit log. Focus on user-visible features and benefits, not implementation details. -->

## [1.21.0] - 2026-02-18

### Added
- **Dashboard Manage panel**: new "Manage" tab in the artefacts activity for management actions
- **Dashboard status update**: change artefact status (PRD/Epic/Task) directly from the Manage panel with validated dropdown
- **Dashboard PRD archive**: archive completed PRDs from the UI with safety confirmation (retype PRD ref)
- **API `POST /api/v2/artefact/:id/status`**: update artefact status with lexicon validation
- **API `GET /api/v2/statuses`**: retrieve valid status values per entity type
- **API `POST /api/v2/archive/:id`**: archive a PRD via the dashboard API
- **Archive manager** (`archive-manager.ts`): extracted archive logic from CLI command into a reusable manager
- **Server POST support**: `parseBody()` helper and method-aware route matching in dashboard server

### Changed
- `cli/commands/archive.ts` is now a thin wrapper calling `archive-manager`
- Nunjucks template engine for merge, task-start, and tasks-batch commands

### Fixed
- `devinstall.sh` symlink updates and `.gitignore` management
- Dead `.base.md` skip removed from devinstall command loop

## [1.20.0] - 2026-02-18

### Added
- **MCP `artefact_update`**: dedicated `milestone` parameter for epics
- **MCP `artefact_list`**: `milestone` and `tags` filters for epics/tasks
- **MCP `artefact_edit`**: richer return with section name and line count per edited section
- **MCP `artefact_edit`**: patch mode (`old_string`/`new_string`) for precise in-section edits
- **MCP `artefact_show`**: `section` filter to return a single section's content
- **MCP `artefact_create`**: custom `created_at` parameter support
- Artefacts now track `created_at` / `updated_at` timestamps automatically
- `buildIdResolver()` utility for format-agnostic ID resolution (T001 = T0001 = T00001)
- Dashboard: clickable task IDs and bars in Gantt chart (navigate to task detail)

### Fixed
- **ID normalization across the board**: dependency graph, Gantt, DAG, validator, and deps commands now resolve IDs through `buildIdResolver` instead of fixed-width `normalizeId` — eliminates false `missing_ref` errors when project digit config differs from default
- `deps:add` no longer stores short IDs (T457) when project uses padded format (T00457)
- `resolveArtefact()` uses index entry IDs instead of re-normalizing with wrong digit count
- Backfill `created_at` from file mtime on existing artefacts
- Memory/log file paths now use project digit config

### Changed
- Breakdown command prompts now include explicit "After Completion" guidance to prevent conductor from suggesting reviews after breakdown (reviews happen before, not after)
- Install scripts use inline `SAILING_SOURCE` patching instead of external config file

## [1.19.0] - 2026-01-27

### Added
- MCP stdio mode (`rdrmcp`) for non-worktree setups
- Install command auto-detects worktree vs inline mode

## [1.18.1] - 2026-01-26

### Added
- ADR `introduced_in` field to track component/version when decision was introduced (e.g., `core/1.18.0`)

### Fixed
- Restored distribution templates (ROADMAP, POSTIT, MEMORY) to `disttpl/` folder
- Fixed `publish-dist.sh` to copy templates from `disttpl/` instead of `dist/`

## [1.18.0] - 2026-01-26

### Added
- **ADR (Architecture Decision Records)**: New artifact type for documenting architectural decisions
  - CLI commands: `rudder adr:create`, `adr:list`, `adr:show`, `adr:accept`, `adr:deprecate`, `adr:wizard`
  - MCP conductor tools: `adr_list`, `adr_show`, `adr_create`, `adr_accept`, `adr_deprecate`, `adr_context`
  - MCP agent tools (read-only): `adr_list`, `adr_show`, `adr_context`
  - `/dev:adr-scan` command for scanning codebase and proposing ADRs
- ADR integration in workflow: PRD review, epic review, and breakdown commands now check ADR compliance
- Agent prompts now include `adr_context` tool for accessing architectural decisions

### Changed
- MCP agent README updated with current tool documentation

## [1.17.1] - 2026-01-25

### Changed
- Dashboard: PRD Overview Gantt simplified (span bar with status color, progress fills box)

## [1.17.0] - 2026-01-25

### Added
- Dashboard: URL routing with pushState for deep linking (`/artefacts/T001`, `/agents/T002`)
- Dashboard: Browser back/forward navigation support
- Dashboard: Effort gauge in PRD overview Gantt (span + effort + progress)
- Dashboard: Status symbols with tooltips in explorer tree
- Dashboard: "New" indicator system based on file timestamps (createdAt/modifiedAt vs viewedAt)
- Dashboard: Project-scoped localStorage (storage keys use hash of project path)
- Dashboard: Tree state persistence (expanded/collapsed state survives refresh)
- Dashboard: Critical path propagation to parent nodes

### Changed
- Dashboard: Monochrome status icons design (simpler, cleaner)
- Dashboard: Orange color for Blocked status (instead of red)
- Dashboard: Light purple for epics in dependency graph
- Dashboard: Gantt charts start at first task hour (with 1h margin)

### Fixed
- Markdown parser now ignores `## Headers` inside HTML comments (prevents artefact corruption)
- Dashboard: Invalid edges filtered in dependency graph (prevents ELK errors)
- Dashboard: Effort text visible in Overview Gantt (increased padding)

## [1.16.0] - 2026-01-25

### Added
- Dashboard: Welcome sidebar with getting started guide and recent activity log
- Dashboard: Dependency graph panel with ELK.js layout (cleaner orthogonal routing)
- Dashboard: Critical path highlighting in dependency graph (red halo on nodes and edges)
- Dashboard: Tree explorer with VS Code-style vertical guide lines

### Changed
- Dashboard: Removed Mermaid dependency for DAG rendering (lighter bundle, better control)
- Dashboard: Unified connector styles in dependency graph (same arrow size for all edge types)

## [1.15.0] - 2026-01-24

### Added
- `agent_reset` MCP tool to reset agent state (kill, discard work, clear db, reset task)
- `normalizeId()` now supports numeric-only input with `defaultType` parameter (e.g., `"1"` → `"T001"` when defaultType is `'task'`)
- `agent_spawn` now validates pending memory logs before spawning (must analyze logs first)
- `devinstall.sh` postflight message for worktree mode (git init instructions)
- Mandatory delegation rules in skill: review/breakdown/merge MUST be delegated to coordinators

### Changed
- MCP documentation split into `mcp_conductor.md` and `mcp_agent.md` for clarity
- `mcp.md` is now an index pointing to conductor/agent docs
- `rudder.md` now indicates CLI is for humans/scripts, agents use MCP tools
- `/dev:*` commands now explicitly state delegation requirement and escalation contract
- Skill rebuilt with "What Skill Does NOT Do" section

### Fixed
- CLI agent commands (`agent:log`, `agent:status`, etc.) now normalize numeric IDs correctly
- Conductor git validation now includes "at least one commit" check

## [1.14.0] - 2026-01-23

### Added
- `epicId` field in task index for direct epic filtering (no more parent string parsing)
- `matchesPrd()` and `matchesEpic()` helper functions in artefacts manager
- `lib/agent-paths.ts` module for agent directory path utilities

### Changed
- Task filtering by epic now uses pre-computed `epicId` instead of parsing `parent` field
- `matchesPrd` moved from lib to manager layer (lib version kept as internal implementation)
- Agent path functions extracted from `normalize.ts` to dedicated `agent-paths.ts`
- `normalize.ts` now focused purely on ID normalization and extraction

### Removed
- Unused `parentContainsEpic` and `parentContainsPrd` functions from normalize.ts

## [1.13.0] - 2026-01-18

### Added
- `gc:agents --days <n>` option to set age threshold for stale db records (default: 30)
- `gc:agents` now cleans up stale database records (terminal status with no directories)
- `permissions:fix` now removes redundant `bin/rudder` and `git` permissions, keeping only broad patterns
- All `git` commands now auto-allowed (broad `git:*` and `git *:*` patterns)
- Common dev tools auto-allowed: `jq`, `yq`, `curl`, `ls`, `tee`, `ps`, `pgrep`, `pkill`, `lsof`, `netstat`, `ss`, `python`, `python3`, `pip install`, `pip3 install`, `WebSearch`
- `artifact:edit --merge-dedup-section` to merge duplicate sections in markdown files

### Changed
- Agent database now uses `taskNum` (number) as primary key instead of `taskId` (string)
- `agent:list` is now an alias of `agent:status` (same features, fewer commands)
- Markdown parsing auto-merges duplicate sections (prevents duplication bugs)
- `bin/rudder` wrapper requires being called from its project directory (security)

### Fixed
- Records with invalid `taskNum` are now filtered out (no more "Tundefined" display)
- `import type` for TypeScript interfaces prevents runtime import errors

## [1.12.0] - 2026-01-16

### Added
- `agent:status --active` flag to show only agents with PID (running or dead)
- `agent:log --events --tail` to follow jsonlog in real-time
- `agent:log --events --raw` for raw JSON lines output (no summarizing)
- `agent:wait` now supports same log options as `agent:log` (`-n`, `-e`, `--raw`)

### Changed
- `agent:spawn --resume` no longer rotates logs (append mode preserves history)

### Fixed
- Sandbox: full `.git/` write access for git commits in worktrees
- Sandbox: `.android/` directory created in sandbox home for Android SDK
- Sandbox: `.gitconfig` copied to sandbox home for git identity

## [1.11.0] - 2026-01-16

### Added
- `agent:status --git` flag to show worktree details (branch, ahead/behind, dirty, last commit)
- `agent:status` now shows last activity time for each agent
- Dead agent detection: agents with non-existent PID shown with ✖ icon and "dead" status

### Changed
- `agent:status` list redesigned with file explorer style and colors
- `agent:status` sorted by last activity (most recent at bottom)
- `worktree:status` redesigned with colors and single-line format per worktree
- `worktree:status` now shows branch name, ahead/behind indicators, last commit time
- `worktree:status` header clarifies to use `agent:status` for agent monitoring

## [1.10.0] - 2026-01-16

### Added
- `paths --show-defaults` flag to compare with default values
- `agent:status --all` and `--since <duration>` for filtering agent list
- `agent:gc` command to garbage collect old agents (TTL-based)
- `docs/CONTRACTS.md` - Architecture contracts for AI agents

### Changed
- `agent:status` shows only "interesting" agents by default (use `--all` for full list)
- `agent:status` displays PID and process state for active agents
- Non-default paths highlighted in yellow

## [1.9.0] - 2026-01-15

### Added
- `config:set` and `config:get` commands for easy configuration management
- `rudder-mcp restart` command to apply config changes
- Linux sandbox: full MCP connectivity via `allowAllUnixSockets` and socat bridge

### Fixed
- Sandbox agents can now connect to MCP server on Linux (both socket and port modes)

## [1.8.0] - 2026-01-14

### Added
- Dashboard: interactive Gantt chart with critical path highlighting
- Dashboard: data caching for faster navigation (5min default, configurable via `--cache`)

## [1.7.4] - 2026-01-13

### Changed
- Simplified README install instructions, worktree mode marked experimental

## [1.7.3] - 2026-01-13

### Improved
- Install script auto-updates `.gitignore` with framework files
- Better guidance when installing in non-git directories

## [1.7.2] - 2026-01-13

### Changed
- CLI commands hide file paths by default (cleaner output, agent-friendly)
- Use `--path` flag when you need to see paths

### Fixed
- Curl install now works out of the box

## [1.7.1] - 2026-01-06

### Fixed
- `epic:patch` command was broken

## [1.7.0] - 2026-01-06

### Added
- `rudder archive` to archive completed PRDs and their memory
- `rudder renumber` to fix duplicate IDs across PRDs
- `task:next` shows preflight checklist before starting work

### Improved
- Agent spawn quieter by default (use `--verbose` for details)
- Memory consolidation guidance clearer

## [1.6.4] - 2026-01-04

### Improved
- Agent documentation with spawn, monitor, wait, reap commands
- Linux sandbox support via MCP socket mode
- Skill context 40% smaller (faster loading)

## [1.6.3] - 2026-01-04

### Added
- `task:show-memory` for agent-focused view with all context
- Budget cap per agent (`agent.max_budget_usd`)
- Watchdog kills stalled agents (`agent.watchdog_timeout`)

## [1.6.2] - 2026-01-04

### Added
- Entity edit commands: `prd:edit`, `epic:edit`, `task:edit`, `story:edit`
- Multi-section editing with operations: replace, append, prepend, delete, sed, check/uncheck

### Improved
- Templates now directive with REQUIRED/OPTIONAL markers

## [1.6.1] - 2026-01-03

### Fixed
- Consistent artefact editing: always use `:patch` commands, never Edit tool

## [1.6.0] - 2026-01-03

### Added
- Hierarchical memory: Task → Epic → PRD → Project
- `memory:sync` auto-creates missing memory files
- Install scripts support `--dry-run`

### Fixed
- Worktree handling of orphaned branches

## [1.5.0] - 2026-01-03

### Added
- `db:` command group for agent database management
- `agent:sync` to recover ghost agents

### Fixed
- Parallel agent spawns no longer corrupt state

## [1.4.0] - 2025-12-31

### Added
- `fix:chmod` to fix file permissions
- Project files: TOOLSET.md, STACK.md, ROADMAP.md, POSTIT.md

### Changed
- Subprocess features gated behind `use_subprocess` config

## [1.3.0] - 2025-12-31

### Added
- Epic-to-epic dependencies (`deps:add ENNN --blocked-by E001`)
- Cycle detection in `deps:validate`

## [1.2.0] - 2025-12-31

### Added
- Agent claim/release workflow (`assign:claim`, `assign:release`)
- Haven-based path overrides for multi-project setups

## [1.1.0] - 2024-12-31

### Added
- `assign` command group for skill → agent composition
- `agent` command group for worktree-based agents
- `gc` and `tag` commands

### Improved
- Prompting fragments 50% smaller

## [1.0.0] - 2024-12-30

### Added
- Initial release of Sailing governance framework
- PRD → Epic → Task workflow
- Skill system with constitutional rules
- `/dev:*` slash commands for Claude Code
- Templates for PRD, Epic, Task, Story, Memory
- Memory consolidation across sessions
- Version tracking with semver
