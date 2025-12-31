# Rudder CLI Changelog

All notable changes to the Rudder CLI will be documented in this file.

## [1.3.0] - 2025-12-31

### Added
- Epic-to-epic dependencies: `deps:add ENNN --blocked-by E001`
- `deps:ready` now checks both task and epic blockers
- `deps:show ENNN` displays epic blockers
- `deps:validate` detects epic dependency cycles
- `versions` command now displays as table with changelog paths

### Changed
- README rewritten with quick start approach

## [1.2.0] - 2025-12-31

### Added
- `config:init` command generates config.yaml from schema (replaces config.yaml-dist)
- Configurable ID digits: `ids.prd_digits`, `ids.epic_digits`, `ids.task_digits`, `ids.story_digits`
- New agent configs: `agent.model`, `agent.max_parallel`, `agent.auto_merge`
- New output configs: `output.color`, `output.verbose`
- New logging config: `logging.level`
- Config descriptions displayed with `rudder config`
- Path type metadata (dir/file) in DEFAULT_PATHS

### Changed
- `config` command output now uses YAML format with comments
- Centralized `formatId()` function for consistent ID formatting
- Haven paths (agents, worktrees, runs, assignments) now in DEFAULT_PATHS
- `loadConfig` renamed to `loadPathsConfig` in core.js (avoids collision)
- `assign.js` now uses centralized `getRunsDir()` and `getAssignmentsDir()`
- `config:check --fix` uses `config:init` instead of copying dist file

### Removed
- `dist/config.yaml-dist` (replaced by schema-driven generation)

## [1.1.0] - 2025-12-31

### Added
- `assign:claim TNNN` - claim task and get compiled prompt
- `assign:release TNNN` - complete work with auto-logging
- Run file sentinel for orphan detection
- Pending memory check before claim
- `paths` command improvements:
  - `--placeholders` flag to show unresolved templates
  - Haven-based paths: agents, runs, assignments, worktrees
  - All haven paths overridable via paths.yaml

### Fixed
- `%haven%` now resolves to `~/.sailing/havens/<hash>/` (was `~/.sailing`)
- Removed unused `%sibling%` placeholder
- Worktree path no longer duplicates project hash

### Changed
- Path shortcuts: `~/` → `%home%/`, `^/` → `%project%/`
- `agent` commands use centralized `getAgentDir()` helper

## [1.0.0] - 2024-12-30

### Added
- Initial release
- PRD/Epic/Task/Story management commands
- State management (counters)
- Component version tracking with git tag support
- Context system for agent/skill prompting
- Memory operations (sync, logs)
- Dependency graph operations
- Permissions management for Claude Code
- Feedback logging system

### Features
- `prd:*` - PRD operations
- `epic:*` - Epic operations
- `task:*` - Task operations
- `story:*` - Story operations
- `memory:*` - Memory consolidation
- `context:*` - Prompting context for agents/skill
- `deps:*` - Dependency graph
- `state:*` - ID counters
- `feedback:*` - Agent feedback logging
- `versions` - Component version display
- `paths` - Path resolution for agents
- `config` - Configuration display
- `permissions:*` - Claude Code permissions
