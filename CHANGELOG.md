# Sailing Changelog

All notable changes to the Sailing Framework will be documented in this file.

## [1.2.0] - 2025-12-31

### Added
- `assign:claim` / `assign:release` lifecycle for agent work
  - Orphan run detection via sentinel files
  - Pending memory sync check before claim
  - Auto-logging on claim/release
  - TIP log validation on release
- Haven-based path overrides: agents, runs, assignments, worktrees

### Fixed
- Path system: `%haven%` now correctly resolves to `~/.sailing/havens/<hash>/`
- Path shortcuts: `~/` and `^/` work consistently
- Worktree path no longer duplicates project hash

### Changed
- Agent workflow simplified: claim → work (log TIPs) → release
- Prompting fragment `workflow.md` updated for release flow

## [1.1.0] - 2024-12-31

### Added
- `assign` command group for skill → agent prompt composition
  - `assign:claim TNNN` - get compiled prompt without prior create
  - `assign:create/show/list/complete/delete` - full lifecycle
  - `--debug` mode shows source file per section
  - `--sources` shows fragment summary
- `agent` command group for worktree-based agent lifecycle
- `gc` command for orphaned resource cleanup
- `tag` command for git tag operations

### Optimized
- Prompting fragments reduced from 7 to 4 files (~50% smaller)
  - `contract.md` - merged rules-core + stop conditions
  - `cli.md` - condensed CLI reference
  - `deps.md` - condensed dependency rules
  - `workflow.md` - merged logging + completion
- Context composition now ~90 lines vs ~187 previously

### Changed
- `task-start.md` simplified to use `assign:claim`
- `tasks-batch.md` updated for new assign flow
- Templates now include `created_by` field

## [1.0.0] - 2024-12-30

### Added
- Initial release of Sailing governance framework
- PRD → Epic → Task workflow
- Skill definition with constitutional rules
- Slash commands for Claude Code (`/dev:*`)
- Prompting fragments system for optimized context
- Templates for PRD, Epic, Task, Story, Memory
- devinstall.sh for development mode
- install.sh for production installs

### Skill Features
- Agent delegation with clear boundaries
- Memory consolidation across sessions
- Milestone validation
- Version tracking with semver

### Governance
- Human-in-the-loop validation at key steps
- Structured artefact management
- State management via Rudder CLI
- Context loading via `rudder context:agent` / `rudder context:skill`

### Documentation
- README.md with quick start
- docs/advanced.md for custom paths
- docs/folders.md for structure reference
- docs/rudder.md for CLI usage
- docs/version_tracking.md for versioning
