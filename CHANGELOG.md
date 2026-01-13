# Sailing Changelog

All notable changes to the Sailing Framework will be documented in this file.

## [1.7.2] - 2026-01-13

### Changed
- File path abstraction: CLI commands no longer show file paths by default
  - Added `--path` flag (discouraged) to show paths when needed
  - Applies to: prd, epic, task, story list/show/create commands
  - Agent guidance: use `task:show --raw` instead of file paths
- PRD template: `branching` field removed (only relevant with `agent.use_worktrees`)
- `db:agent` output: renamed `Log:` to `Run Log:` for clarity

### Fixed
- Curl install: `dist/cli/` now committed to repo (was in .gitignore)

## [1.7.1] - 2026-01-06

### Fixed
- `epic:patch` was passing object instead of file path to editArtifact

## [1.7.0] - 2026-01-06

### Added
- `rudder archive` command for archiving completed PRDs:
  - Moves PRD folder to `archive/prds/`
  - Moves related memory files (E*.md, E*.log, T*.log, PRD-*.md) to `archive/memory/PRD-NNN/`
  - Uses reverse indexing (findEpicPrd, findTaskEpic) to find related memory
  - Adds `archived_at` timestamp to prd.md frontmatter
  - `--list` to show Done PRDs (default without args)
  - `--all` to archive all Done PRDs
  - `--dry-run` to preview without changes
  - `--force` to archive non-Done PRDs
- `rudder renumber` command for fixing duplicate epic/task IDs across PRDs
- `archive` path in paths.yaml for archived PRDs and memory
- Artefact index library (`cli/lib/index.js`) for format-agnostic ID lookup (E1, E001, E0001 all match)
- `task:next` shows preflight reminder (memory:sync, deps:ready) and checks pending memory

### Changed
- Agent spawn: quiet mode is now default (use `--verbose` for old behavior)
- Worktree mode: agents must commit before release, inline mode unchanged
- Memory consolidation: clearer BEFORE/DURING/AFTER checklist for skill task execution

### Fixed
- `prd.md` filename now lowercase consistently in index and archive
- `memory:sync` no longer crashes on missing memory files
- `memory:edit` warns instead of failing for missing sections
- Heartbeat timer uses interval instead of polling every 2s
- Orphan `.run` files auto-cleaned instead of blocking

### Documentation
- `worktree_folders.md`: explains worktree mode and folder profiles
- Updated README with install options and sandbox docs

## [1.6.4] - 2026-01-04

### Added
- `agent-cli.md` skill documentation: spawn, monitor, wait, reap commands
- Spawn behavior documentation: BLOCKING nature, parallel tool calls pattern

### Changed
- `mcp_mode: socket` required for Linux sandbox (TCP blocked by bubblewrap)
- Bootstrap prompt simplified: auto-release on exit 0, no manual `assign:release`
- Agent monitoring: use `agent:log`, `agent:status`, not `sleep && tail`

### Fixed
- MCP socket bind-mounted into sandbox for socat access
- Skill parallel spawning: use Claude tool calls, not bash `&`

### Performance
- Skill context reduced 40% (814→489 lines): split law/agent-rules, remove roadmap/postit, dedupe worktree docs

## [1.6.3] - 2026-01-04

### Added
- `task:show-memory` command: agent-focused view with memory + tech notes + dependencies
- Claude process management options:
  - `agent.max_budget_usd`: budget cap per agent (-1 = unlimited)
  - `agent.watchdog_timeout`: kill stalled agents (no output for N seconds)
  - `--no-session-persistence` by default (lighter weight agents)
- Watchdog detects stalled Claude processes and kills them
- `relative-integer` config type for values that can be negative

### Changed
- Memory commands documentation unified across all prompts/skills
- Spawn box now shows Budget and Watchdog status
- `memory:sync` runs before each task/batch start (not "every 3-5 tasks")

### Fixed
- Updated obsolete `epic:show-memory` references to `memory:show`
- Skill files now include memory command reference table

## [1.6.2] - 2026-01-04

### Added
- Entity-specific `:edit` commands: `prd:edit`, `epic:edit`, `task:edit`, `story:edit`
- Multi-section edit with operations: `[replace]`, `[append]`, `[prepend]`, `[delete]`, `[sed]`, `[check]`, `[uncheck]`, `[toggle]`, `[patch]`
- `stripComments()` function in core.js for filtering template comments
- `:show --raw` strips comments by default, use `--comments` to include them
- `:create --path` flag to optionally show file path

### Changed
- Templates now directive with `<!-- REQUIRED: ... -->` and `<!-- OPTIONAL: ... -->`
- Templates include "Edit ALL sections in ONE command" example with heredoc format
- Templates include edit commands in frontmatter comment and body
- `:create` commands display file content after separator (path hidden by default)

### Fixed
- `epic:edit` was passing object instead of file path

## [1.6.1] - 2026-01-03

### Added
- `shared/artefact-editing.md` fragment for CLI editing rules
- `editing` set in workflows.yaml for operations that edit artefacts

### Fixed
- Bootstrap prompt: explicit warning against creating log files (.tip-log.txt)
- Constitutional rule #4: NEVER Edit/Write artefacts directly
- All skills updated to use `:patch` instead of Edit tool
- `skill/gates.md`: removed "Allowed edits (Edit tool)" section
- Consistent messaging across all prompting fragments

### Changed
- Artefact editing pattern: `rudder <entity>:patch` for body, `:update` for frontmatter
- Operations prd-breakdown, epic-breakdown, epic-review, prd-story, prd-story-finalize now include `editing` set

## [1.6.0] - 2026-01-03

### Added
- Hierarchical memory system: Task → Epic → PRD → Project
  - Template-based creation (memory-epic.md, memory-prd.md, memory-dist.md)
  - `memory:sync` auto-creates missing PRD/epic memory files
  - `prd:create` auto-creates PRD memory file
  - Contextual escalation guide in `memory:sync` output
- Install scripts: `--dry-run` support for both devinstall.sh and install.sh

### Fixed
- `listSailingBranches` now strips `+` prefix (git worktree indicator)
- Spawn handles orphaned worktrees intelligently:
  - Clean orphan → auto-cleanup and proceed
  - Dirty/has commits → escalate with recovery options
- Delete orphaned branches (0 commits ahead) and recreate from current parent
  - Ensures worktree starts from latest baseBranch (main, prd/*, epic/*)
- `merge.md` command syntax: `worktree X` not `worktree:X`
- Use `rudder worktree cleanup` for state-aware cleanup

### Changed
- Install scripts refactored with utility functions (do_mkdir, do_cp, do_ln, do_write)
- Protected files pattern for user-editable configs
- MEMORY.md included in haven artefacts

## [1.5.0] - 2026-01-03

### Added
- Custom `jsondb` library for concurrent-safe JSON storage
  - Plain JSON files (human-readable, easy to debug)
  - File-based locking with stale detection (30s timeout)
  - Atomic writes (temp file + rename)
  - MongoDB-like API: find, insert, update, remove
  - Query operators: `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$exists`
  - Update operators: `$set`, `$unset`, `$inc`, `$push`
- `db:` command group for database management
  - `db:status` - show database info and counts
  - `db:agents` - list all agents
  - `db:agent <id>` - show agent details
  - `db:delete/clear` - remove agents
  - `db:runs <id>` - show run history
  - `db:migrate` - migrate from state.json
  - `db:compact` - compact database files
- `agent:sync` command to reconcile state with reality (recover ghosts)
- Configurable `db` path via paths.yaml (default: `%haven%/db`)

### Fixed
- Ghost agents: parallel spawns no longer overwrite each other
  - Atomic state updates with file locking in state.js
- `~/.claude.json` corruption during parallel agent spawns
  - Re-enabled sandboxHome isolation per agent

### Changed
- Agent tracking moved from state.json to jsondb (agents.json, runs.json)
- state.json now only stores counters (prd, epic, task, story)

## [1.4.0] - 2025-12-31

### Added
- `fix:chmod` command to fix 600 permissions caused by Claude Code Write tool
- `use_subprocess` config option as gate for subprocess features
- Execution mode injection in skill context (inline vs subprocess)
- Config hierarchy validation in `config:check`
- Project-centric files: TOOLSET.md, STACK.md, ROADMAP.md, POSTIT.md
  - Auto-injected into context based on execution mode

### Changed
- `agent:spawn` now refuses if `use_subprocess: false` with clear error
- `install.sh --full` enables both `use_subprocess` and `use_worktrees`
- `init` command refactored: correct paths, generates config.yaml from schema

### Fixed
- Init command was using wrong dist directory
- ROADMAP.md/POSTIT.md placed in correct artefacts/ location

## [1.3.0] - 2025-12-31

### Added
- Epic-to-epic dependencies support (`deps:add ENNN --blocked-by E001`)
- Epic cycle detection in `deps:validate`
- `deps:ready` checks epic blockers before returning tasks

### Fixed
- `bin/rudder -V` now shows correct version from Rudder CLI component

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
