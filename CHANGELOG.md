# Sailing Changelog

All notable changes to the Sailing Framework will be documented in this file.

<!-- NOTE: This is a USER changelog, not a commit log. Focus on user-visible features and benefits, not implementation details. -->

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
