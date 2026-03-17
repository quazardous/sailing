# Developing Sailing

This document is the cold-start entry point for any agent or developer working on the sailing codebase itself. It explains what sailing is, how it is structured, and how to work on it. For using sailing in a client project, see [README.md](README.md).

> **Important caveat:** Sailing does not use itself. The governance framework (PRD, epics, tasks, skill, MCP tools) applies to client projects that install sailing — not to the sailing repository. When you develop sailing, you work with standard git, npm, and TypeScript tooling. Agents often confuse this: the rules in `prompting/`, `skill/`, and `.claude/CLAUDE.md` describe what sailing enforces in client projects, not how to develop sailing.

---

## What Is Sailing

Sailing is an AI-assisted project governance framework. It gives Claude Code a structured workflow for managing software projects: PRD (Product Requirements Document) decomposition into epics, epics into tasks, with persistent memory that survives across sessions. The framework is composed of three pieces that work together:

- **`rudder`**, a TypeScript CLI that manages project state (artefacts, dependencies, memory, agent lifecycle).
- **A Claude Code skill** (installed into `.claude/skills/sailing/`) that teaches Claude the governance rules and orchestration workflow.
- **An MCP server** that exposes rudder commands as tools Claude can call programmatically.

The core idea is that Claude never operates from memory alone. Every decision is grounded in artefacts managed by rudder, every agent follows constitutional rules, and every session's learnings are consolidated into persistent memory for the next agent.

---

## The Two Execution Modes

Sailing supports two fundamentally different ways of running agents, and this duality permeates the entire codebase. Understanding it is essential before touching any code.

**Inline mode** is the default. The skill spawns agents using Claude Code's built-in Task tool. The agent runs in the main repository directory, communicates with rudder via a stdio MCP server (`bin/rdrmcp`), and does not commit — the coordinator handles git. No daemon, no worktrees, no isolation beyond what Claude Code provides.

**Worktree mode** (subprocess) isolates each agent in a dedicated git worktree with its own branch (`task/T001`). The agent is a subprocess spawned by `rudder agent:spawn`, communicates via a socket/TCP MCP server started with `bin/rdrctl start`, and must commit before exiting. After completion, changes are merged back to the parent branch. This enables true parallel execution but requires more infrastructure (daemon, sandbox, folder profiles).

The mode is chosen at install time (`--use-worktree` flag) and affects templates, prompts, commands, and MCP transport. There is a strict anti-fallback rule: the system never silently switches from one mode to the other. If a project is configured for inline, worktree commands are not available, and vice versa.

For the full technical breakdown, see [docs/execution-modes.md](docs/execution-modes.md).

---

## Code Architecture

The TypeScript source lives in `cli/` (a npm workspace). The entry points are `cli/rudder.ts` (CLI), `cli/rdrctl.ts` (service manager), and `cli/conductor/mcp-conductor.ts` (MCP server).

The architecture follows a strict three-layer separation described in [docs/CONTRACTS.md](docs/CONTRACTS.md):

**Commands** (`cli/commands/`) parse CLI arguments, format output, and call managers. They contain zero business logic and do not access configuration directly.

**Managers** (`cli/lib/managers/`) are the orchestration layer. They read configuration, coordinate between libs, and implement business decisions. This is where "impurity" lives — config access, state mutations, side effects. There are 20+ managers organized by domain (agent-manager, worktree-manager, compose-manager, pr-manager, etc.).

**Libs** (`cli/lib/`) are pure technical operations. They accept everything they need as parameters and never import config. A lib can be tested without mocking configuration — that is the litmus test.

The credo is **"impurity flows upward, never downward."** Libs are pure, managers are impure, commands are thin wrappers. When writing code: commands import from managers, managers import from libs, libs never import from managers or config.

---

## The Prompting System

Sailing constructs contextual prompts for agents dynamically. The single source of truth is `prompting/workflows.yaml`, which defines five sections:

1. **Roles** — three actor types (agent, coordinator, skill) with their base fragment sets and inject rules.
2. **Sets** — reusable bundles of prompt fragments, role-filtered.
3. **Operations** — metadata per operation (task-start, epic-breakdown, merge, etc.).
4. **Matrix** — which additional sets each operation needs beyond the role's base.
5. **Orchestration** — step-by-step workflow commands with mode markers (`inline`, `subprocess`, `both`).

The fragments themselves live in `prompting/` as markdown files, organized by audience: `core/` (constitutional law), `agent/` (execution rules), `skill/` (orchestration rules), `shared/` (cross-role content like worktree instructions).

When `context:load <operation> --role <role>` runs, it resolves the role's base sets, adds operation-specific sets from the matrix, injects project files according to the mode, and optionally appends orchestration steps. The result is a self-contained prompt that gives the agent everything it needs.

---

## The Template System

Several files need mode-specific variants (inline vs worktree content). Rather than maintaining two copies, sailing uses [Nunjucks](https://mozilla.github.io/nunjucks/) templates (`.njk` files) with a `mode` variable that controls conditional blocks.

The main skill file `skill/SKILL.md.njk` generates `SKILL_INLINE.md` and `SKILL_WORKTREE.md`. Similarly, command templates in `commands/dev/*.md.njk` generate `.inline.md` and `.worktree.md` variants. The install scripts then pick the right variant based on the project's configured mode.

To regenerate after editing a template: `npm run build:skill` (requires `npm run build` first, since the render command is part of the compiled CLI). See [skill/BUILD_SKILL.md](skill/BUILD_SKILL.md) for details.

---

## Installation Wrappers

Sailing installs into client projects via shell scripts that place wrappers, prompts, templates, and artefact scaffolding. There are two install paths:

**`install.sh`** is the production installer. It downloads compiled files from the `dist` branch and copies them into the project. The rudder source goes into `.sailing/rudder/`, and wrappers point there.

**`devinstall.sh`** is for developing sailing. It creates symlinks from the client project back to the sailing repo, so changes to sailing source are reflected immediately. It also patches the `SAILING_SOURCE` variable in wrappers to point to the sailing repo.

Both installers create three wrapper scripts in the client project's `bin/`:

| Wrapper | Purpose | Used by |
|---------|---------|---------|
| `bin/rudder` | CLI entry point for all rudder commands | Developer, skill, agents |
| `bin/rdrctl` | Service manager (start/stop MCP daemon, dashboard) | Developer (worktree mode) |
| `bin/rdrmcp` | Stdio MCP conductor — Claude Code launches this on demand | Claude Code (inline mode) |

In inline mode, `bin/rdrmcp` is declared in `.mcp.json` as a stdio server and Claude Code manages its lifecycle. No daemon needed.

In worktree mode, `bin/rdrctl start conductor` launches a persistent MCP server on a Unix socket or TCP port. Agents connect to it from their sandboxed worktrees.

---

## Developing Locally

### Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/quazardous/sailing.git
cd sailing
npm install
```

### Build

```bash
npm run build          # TypeScript compilation (tsc)
npm run build:skill    # Render Nunjucks templates (requires build first)
```

### Dev mode

```bash
npm run dev            # Watch mode (tsx) — recompiles on change
```

### Test

```bash
npm test               # Build + run tests (node --test)
npm run test:watch     # Watch mode
```

### Lint

```bash
npm run lint           # ESLint
npx tsc --noEmit       # Type checking without emitting
```

### Testing in a client project

Use `devinstall.sh` to install sailing into a test project with symlinks:

```bash
cd /path/to/test-project
/path/to/sailing/devinstall.sh
```

The wrappers will be patched to point at the sailing repo. If a `SAILING_DIST` file containing `dev` exists at the project root, wrappers use `npx tsx` with source `.ts` files directly (live changes, no build needed). Otherwise they use compiled `.js` from `dist/`.

### Self-install

For testing sailing's own install on the sailing repo:

```bash
./devinstall.sh --self-install
```

---

## Scripts

| Script | Usage |
|--------|-------|
| `dev/mcp-dev.mjs` | MCP stdio server exposing dev tools (tsc_check, lint_report, lint_file, lint_count, lint_rule_breakdown). Copy `.mcp.json-dist` to `.mcp.json` to enable. |

---

## Pointers

| Topic | Document |
|-------|----------|
| Architecture contracts (layers, anti-patterns) | [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| Folder structure in client projects | [docs/folders.md](docs/folders.md) |
| Inline vs worktree modes (detailed) | [docs/execution-modes.md](docs/execution-modes.md) |
| Worktree folder profiles | [docs/worktree_folders.md](docs/worktree_folders.md) |
| MCP server overview | [docs/mcp.md](docs/mcp.md) |
| MCP tools for conductors | [docs/mcp_conductor.md](docs/mcp_conductor.md) |
| MCP tools for agents | [docs/mcp_agent.md](docs/mcp_agent.md) |
| Agent protocol (mission/result schema) | [docs/agent-protocol.md](docs/agent-protocol.md) |
| Sandbox setup (srt) | [docs/sandbox.md](docs/sandbox.md) |
| CLI reference | [docs/rudder.md](docs/rudder.md) |
| Template system | [skill/BUILD_SKILL.md](skill/BUILD_SKILL.md) |
| Advanced configuration | [docs/advanced.md](docs/advanced.md) |
