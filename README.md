# Sailing 🌊

**AI-assisted project governance** that actually remembers what it learns.

> Stop losing context. Start building with memory.

## Your First PRD in 5 Minutes

### 1. Install (30 seconds)

```bash
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash
```

### 2. Create a PRD (1 minute)

Just talk to Claude naturally:

**You:** "Create a PRD for a user authentication system"

**Claude:** "I've created PRD-001. The spec includes OAuth2, JWT tokens, and password recovery. Would you like me to review it for completeness, or shall we create user stories first?"

### 3. Follow the Flow (3 minutes)

**You:** "Review it"

**Claude:** "Review complete. I recommend adding these target versions:
- auth-service: 1.0.0
- api: 0.3.0

Ready to break this down into epics?"

**You:** "Yes, break it down"

**Claude:** "Created 3 epics:
- E001: OAuth2 Integration
- E002: JWT Token Management  
- E003: Password Recovery

I recommend reviewing E001's technical approach before breaking it into tasks. Should I proceed?"

**You:** "Review E001"

**Claude:** "Epic reviewed. I've added technical decisions on token storage and refresh strategy. Ready to break this into tasks?"

**You:** "Yes"

**Claude:** "Created 5 tasks for E001. All dependencies are clear. Task T001 is ready to start. Should I begin implementation?"

**That's it. From idea to actionable tasks in 5 minutes.**

## What You Get

- 🧠 **Memory That Persists** - Claude remembers what it learned in previous tasks
- 🎯 **Guided Workflow** - Claude suggests next steps at every decision point
- 📊 **Structured Governance** - PRD → Epic → Task hierarchy keeps work organized
- 🔒 **Constitutional Rules** - Prevents common AI pitfalls like scope creep and lost context

## Everyday Usage

### Natural Language (Recommended)

Just talk to Claude. It knows what to do:

```
"What should I work on next?"
"I finished that task, what's next?"
"Show me the project status"
"This task is blocked, log the issue"
"Review the PRD and suggest improvements"
```

**Claude guides you through:**
- When to create stories
- When to review technical decisions
- When to sync memory
- What to work on next
- When milestones are complete

### Slash Commands (Also Available)

For direct control, use commands:

```bash
/dev:next                    # What to work on
/dev:status                  # Project overview
/dev:task-start T005         # Start a task
/dev:task-done T005          # Complete a task
/dev:prd-review PRD-001      # Review a PRD
```

[See all commands in the docs →](docs/rudder.md)

## How It Works

### Constitutional Layer

These rules ensure Claude stays reliable:

| Rule | Why It Matters |
|------|----------------|
| **Rudder is single source of truth** | No manual editing of task files = no state corruption |
| **Main thread makes all decisions** | Agent sub-tasks execute only, never decide next steps |
| **Memory must be consolidated** | Prevents context loss between sessions |
| **When in doubt, escalate** | No guessing = no surprises |

### Guided Decision Points

Claude suggests next steps based on what you just did:

| You Just... | Claude Suggests... |
|-------------|-------------------|
| Created a PRD | "Review it?" → "Create stories?" → "Break into epics?" |
| Created epics | "Review technical approach?" → "Break into tasks?" |
| Created tasks | "Start task T001?" |
| Completed a task | "Version bump needed" → "Next task?" → "Milestone complete?" |
| Finished a milestone | "Validate criteria?" → "Sync roadmap?" |

**You never need to memorize the workflow. Claude knows it.**

## Project Structure

After installation:

```
your-project/
├── bin/rudder              # CLI for state management
├── .claude/
│   ├── skills/sailing/     # Skill definition (auto-loaded)
│   └── commands/dev/       # /dev:* slash commands
└── .sailing/
    ├── artefacts/          # ROADMAP, POSTIT, PRDs, Epics, Tasks
    ├── memory/             # Epic memory (persists learnings)
    ├── prompting/          # Optimized prompt fragments
    └── templates/          # Entity templates
```

[Detailed structure →](docs/folders.md)

## Why Sailing?

**The Problem:**
AI coding assistants lose context between sessions. You explain the same patterns, repeat the same decisions, and watch agents make the same mistakes twice.

**The Solution:**
Sailing provides structure + memory. Claude consolidates learnings from each task into epic memory. The next agent reads that memory and builds on it—no repeated mistakes, no lost patterns.

**The Result:**
- Agents get smarter as your project grows
- You stop repeating yourself
- Context survives across sessions
- Work stays organized and traceable

## Learn More

| Topic | Link |
|-------|------|
| **CLI Reference** | [docs/rudder.md](docs/rudder.md) |
| **Folder Structure** | [docs/folders.md](docs/folders.md) |
| **Version Tracking** | [docs/version_tracking.md](docs/version_tracking.md) |
| **Advanced Config** | [docs/advanced.md](docs/advanced.md) |

## Requirements

- Claude Code (with sailing skill support)
- Node.js 18+
- Git

## License

MIT
