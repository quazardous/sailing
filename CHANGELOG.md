# Sailing Changelog

All notable changes to the Sailing Framework will be documented in this file.

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
