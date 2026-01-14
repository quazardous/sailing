# Sailing

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-blueviolet)](https://code.claude.com/docs/en/skills)

**AI-assisted project governance** that actually remembers what it learns.

> Stop losing context. Start building with memory.

## Your First PRD in 5 Minutes

### 1. Install (30 seconds)

```bash
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash
```

**Worktree mode** (experimental):
```bash
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash -s -- --use-worktree --folders-profile=haven
```
> ⚠️ **Experimental**: Worktree mode enables git worktree isolation for parallel agent execution. Each agent works in its own branch. Requires [sandbox-runtime (srt)](https://github.com/anthropic-experimental/sandbox-runtime) for OS-level isolation. The installer will guide you through the setup.

### 2. Create a PRD (1 minute)

Talk to Claude naturally — just mention "sailing" to activate the skill:

**You:** "With sailing, create a PRD for a user authentication system"

**Claude:** "I've created PRD-001. The spec includes OAuth2, JWT tokens, and password recovery. Would you like me to review it for completeness?"

### 3. Follow the Guided Flow (3 minutes)

**You:** "Yes, review it"

**Claude:** "Review complete. I recommend adding target versions for milestone M1. Ready to break this down into epics?"

**You:** "Go ahead"

**Claude:** "Created 3 epics:
- E001: OAuth2 Integration
- E002: JWT Token Management
- E003: Password Recovery

I recommend reviewing E001's technical approach before breaking it into tasks. Should I proceed with `/dev:epic-review E001`?"

**You:** "Yes"

**Claude:** "Epic reviewed. Added technical notes on token storage strategy. Ready to create tasks with `/dev:epic-breakdown E001`?"

**You:** "Do it"

**Claude:** "Created 5 tasks for E001. T001 is ready to start. Run `/dev:task-start T001` when you're ready."

**That's it. From idea to actionable tasks in 5 minutes.**

## What You Get

| Feature | Description |
|---------|-------------|
| **Memory That Persists** | Claude consolidates learnings into epic memory — next agent picks up where you left off |
| **Guided Workflow** | Claude suggests next steps at every decision point |
| **Structured Governance** | PRD → Epic → Task hierarchy keeps work organized |
| **Constitutional Rules** | Prevents scope creep, lost context, and agent guessing |

## Everyday Usage

### Natural Language (Recommended)

Just talk to Claude. Mention "sailing" to activate:

```
"With sailing, what should I work on next?"
"Using sailing, show me the project status"
"With the sailing skill, I finished T005 — mark it done"
"Sailing: this task is blocked, log the issue"
```

Claude guides you through the workflow — you don't need to memorize commands.

### Slash Commands

For direct control:

| Command | Description |
|---------|-------------|
| `/dev:status` | Project overview |
| `/dev:next` | Get next ready task |
| `/dev:task-start T001` | Start a task |
| `/dev:task-done T001` | Complete a task |
| `/dev:prd-review PRD-001` | Review a PRD |
| `/dev:epic-breakdown E001` | Break epic into tasks |
| `/dev:versions` | Show component versions |

[Full command reference →](docs/rudder.md)

## How It Works

### Constitutional Layer

These rules keep Claude reliable:

| Rule | Why It Matters |
|------|----------------|
| **Rudder is single source of truth** | No manual file editing = no state corruption |
| **Main thread decides** | Agents execute only, never chain or infer |
| **Memory before execution** | Context survives across sessions |
| **When in doubt, escalate** | No guessing = no surprises |

### Guided Decision Points

| You Just... | Claude Suggests... |
|-------------|-------------------|
| Created a PRD | Review → Stories (optional) → Breakdown |
| Created epics | Epic review → Task breakdown |
| Broke down tasks | Start first ready task |
| Completed a task | Version bump (if needed) → Next task |
| Finished milestone | Validate → Sync roadmap |

## Project Structure

```
your-project/
├── bin/rudder              # CLI for state management
├── .claude/
│   ├── skills/sailing/     # Skill definition (auto-loaded)
│   └── commands/dev/       # /dev:* slash commands
└── .sailing/
    ├── artefacts/          # ROADMAP, PRDs, Epics, Tasks
    ├── memory/             # Epic memory (persists learnings)
    ├── prompting/          # Agent context fragments
    │   └── workflows.yaml  # ⭐ Central config (contexts + orchestration)
    └── templates/          # Entity templates
```

> **Key file:** [`prompting/workflows.yaml`](prompting/workflows.yaml) — Single source of truth for context generation and workflow orchestration. Defines fragment sets, operation metadata, and mode-filtered workflow steps (inline vs subprocess).

[Detailed structure →](docs/folders.md)

## Why Sailing?

**Problem:** AI assistants lose context between sessions. You repeat the same explanations, watch agents make the same mistakes, lose architectural decisions.

**Solution:** Sailing provides structure + memory. Each task logs learnings. Memory consolidates into epics. Next agent reads that memory and builds on it.

**Result:**
- Agents get smarter as your project grows
- Context survives across sessions
- Work stays organized and traceable
- You stop repeating yourself

## Documentation

| Topic | Link |
|-------|------|
| CLI Reference | [docs/rudder.md](docs/rudder.md) |
| Folder Structure | [docs/folders.md](docs/folders.md) |
| Worktree Mode | [docs/worktree_folders.md](docs/worktree_folders.md) |
| Version Tracking | [docs/version_tracking.md](docs/version_tracking.md) |
| Advanced Config | [docs/advanced.md](docs/advanced.md) |
| Sandbox (srt) | [docs/sandbox.md](docs/sandbox.md) |
| MCP Server | [docs/mcp.md](docs/mcp.md) |

## Bonus

A fun dashboard to visualize your project (Gantt, etc):

```bash
bin/rudder dashboard
```

## Requirements

- Claude Code CLI
- Node.js 18+
- Git

## License

MIT
