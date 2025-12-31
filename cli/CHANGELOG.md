# Rudder CLI Changelog

All notable changes to the Rudder CLI will be documented in this file.

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
