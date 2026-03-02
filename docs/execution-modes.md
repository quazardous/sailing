# Execution Modes: Inline vs Worktree

Sailing supports two execution modes that affect how agents are spawned, how they communicate with rudder, and how their work is integrated. The mode is chosen at install time and applies project-wide. This document explains why the duality exists and how it impacts the codebase.

---

## Why Two Modes

The fundamental tension is between simplicity and isolation.

When Claude Code runs a single agent via the Task tool, everything happens in the main repository directory. This works well for sequential task execution: one agent finishes, its work is reviewed, the next agent starts. No extra infrastructure, no branch management, no merge conflicts. This is **inline mode**.

But when you want parallel execution — multiple agents working on different tasks simultaneously — sharing a single working directory is a problem. Agent A edits `src/auth.ts` while agent B edits the same file. Uncommitted changes from one agent leak into another's context. Git operations race. The only way to solve this cleanly is to give each agent its own isolated copy of the repository. Git worktrees provide this: same repo, different branch, separate working directory. This is **worktree mode** (also called subprocess mode in the codebase, because agents run as subprocesses rather than Task tool invocations).

The two modes are not a graceful degradation — they represent genuinely different architectures with different trade-offs. Inline is simpler and sufficient for most projects. Worktree enables parallelism but requires a daemon, folder profiles to keep data outside the git tree, and optionally a sandbox runtime for OS-level isolation.

---

## Inline Mode

In inline mode, the skill spawns agents using Claude Code's built-in Task tool. The agent receives its context via `context:load`, works in the main repository directory, and exits when done. The coordinator (skill or human) handles all git operations.

Key characteristics:

- **Spawn mechanism:** Task tool (Claude Code native). The orchestration step in `workflows.yaml` reads `mode: inline` and instructs the skill to use the Task tool with `context:load <task> --role agent`.
- **MCP transport:** Stdio only. `bin/rdrmcp` runs the MCP conductor in stdio mode — Claude Code launches it on demand via `.mcp.json` and manages its lifecycle. No daemon, no socket.
- **Git policy:** Agents do not commit. The coordinator manages the working tree. This avoids partial commits and keeps the agent's role purely about implementation.
- **Isolation:** None beyond what Claude Code's Task tool provides (separate context window). File system is shared.
- **Parallelism:** Not supported. One agent at a time, sequential execution.

The inline agent sees the prompt fragment `prompting/shared/inline-mode.md`, which tells it: you are in the main repository, do not commit, the coordinator handles git.

---

## Worktree Mode (Subprocess)

In worktree mode, agents are subprocesses spawned by `rudder agent:spawn`. Each agent gets a dedicated git worktree with its own branch. The agent must commit before exiting, and its changes are merged back by the reap process.

Key characteristics:

- **Spawn mechanism:** `rudder agent:spawn <task>` creates a worktree, checks out a new branch (`task/T001`), and launches a Claude Code subprocess in that directory.
- **MCP transport:** Socket or TCP. The MCP server must be started beforehand with `bin/rdrctl start conductor`. Agents connect to it from their worktrees. This is necessary because stdio doesn't work across process boundaries when agents are sandboxed subprocesses.
- **Git policy:** Agents must commit with a descriptive message before exiting. Conventional commit format: `feat(T001): description`.
- **Isolation:** Git-level (separate worktree + branch). Optionally OS-level via sandbox runtime (srt) for filesystem and network isolation.
- **Parallelism:** Fully supported. Multiple agents can work simultaneously in separate worktrees.
- **Merge flow:** On agent exit with code 0, `agent:reap` automatically attempts a fast-forward merge. If conflicts exist, the skill escalates to `/dev:merge` which spawns a dedicated merge agent.

The worktree agent sees `prompting/shared/worktree.md`, which explains the commit requirement and the spawn/reap lifecycle. The skill sees `prompting/skill/worktree-mode.md`, which enforces strict delegation: the skill orchestrates but never implements or merges directly.

### Folder Profiles

Worktree mode requires that sailing data (artefacts, memory, state) lives outside the git working tree. Otherwise, every worktree would inherit a copy of `.sailing/` and agents would diverge on state. Three folder profiles solve this:

- **`project`** (default, inline only): Everything in `.sailing/` inside the project. Not compatible with worktrees.
- **`haven`** (recommended for worktree): Data in `~/.sailing/havens/<project-hash>/`. The project stays git-clean, with only a `paths.yaml` pointer and a convenience symlink.
- **`sibling`**: Worktrees in an adjacent `<project>-sailing/` directory. Useful when home directory space is limited.

See [worktree_folders.md](worktree_folders.md) for full details on profiles, path placeholders, and migration.

---

## Impact on the Sailing Codebase

The mode duality touches several layers of the codebase. When working on sailing, you need to know where mode-specific logic lives.

### Nunjucks Templates

The `mode` variable (`inline` or `worktree`) drives conditional content in `.njk` templates:

- `skill/SKILL.md.njk` → generates `SKILL_INLINE.md` and `SKILL_WORKTREE.md`
- `commands/dev/*.md.njk` → generates `.inline.md` and `.worktree.md` variants

The install scripts copy the correct variant as the active file. The `rudder template:render` command handles rendering, reading the mode from project config or accepting `--var mode=xxx`.

### Workflows.yaml

Each orchestration step has a `mode` field: `inline`, `subprocess`, or `both`. When context is composed for a role, steps are filtered by the project's active mode. For example, `agent:spawn` steps are `subprocess` only, while Task tool spawning is `inline` only. Steps marked `both` appear in either mode.

The `inject` section of each role also has mode-conditional entries. In subprocess mode, the agent role gets MCP-specific fragments (`agent/mcp-rudder`) and excludes CLI fragments (`agent/cli`). The `worktrees` / `no_worktrees` sub-sections add mode-specific fragments like `shared/worktree` or `shared/inline-mode`.

### Prompt Fragments

Several fragments are mode-specific:

| Fragment | Audience | Purpose |
|----------|----------|---------|
| `shared/inline-mode.md` | Agent (inline) | "You are in the main repo, do not commit" |
| `shared/worktree.md` | Agent (worktree) | Commit rules, spawn/reap lifecycle |
| `shared/worktree-coordinator.md` | Coordinator (worktree) | Branch structure, merge workflow, MCP tools |
| `skill/worktree-mode.md` | Skill (worktree) | Strict delegation rules, forbidden actions |

### Command Variants

Commands that differ significantly between modes have Nunjucks templates. Currently: `merge`, `task-start`, and `tasks-batch`. The generated variants (`.inline.md`, `.worktree.md`) are installed as the active command file based on mode.

### MCP Transport

In inline mode, the MCP server runs as a stdio process (`bin/rdrmcp`). Claude Code declares it in `.mcp.json` and manages its lifecycle automatically.

In worktree mode, the MCP server is a persistent daemon started with `bin/rdrctl start conductor`. It listens on a Unix socket or TCP port. Agents connect to it from their isolated worktrees. The two audiences (conductor and agent) use different tool sets — see [mcp.md](mcp.md).

---

## The Anti-Fallback Rule

The system never silently switches from one mode to the other. If a project is configured for inline mode, worktree-specific commands (`agent:spawn`, `agent:reap`) are not available. If configured for worktree mode, inline-specific instructions (Task tool spawning) are not injected.

This is deliberate. The two modes have incompatible assumptions about git policy, commit behavior, and MCP transport. Silently falling back would create confusion: an agent expecting to commit in a worktree would instead pollute the main branch, or an inline agent would fail trying to connect to a non-existent socket.

The mode is set at install time via `--use-worktree` and stored in the project's configuration. To switch modes, re-run the installer with the appropriate flag.

---

## Choosing a Mode

For most projects, **inline mode** is the right choice. It is simpler, requires no daemon, and works out of the box. Sequential task execution is sufficient when a human reviews each agent's work before moving on.

**Worktree mode** is for projects that need parallel agent execution or strict isolation. It adds complexity (daemon management, folder profiles, merge workflow) but enables running multiple agents simultaneously on independent tasks.

---

## See Also

- [worktree_folders.md](worktree_folders.md) — Folder profiles and worktree setup
- [mcp.md](mcp.md) — MCP server architecture and transport modes
- [sandbox.md](sandbox.md) — OS-level isolation with sandbox runtime
- [skill/BUILD_SKILL.md](../skill/BUILD_SKILL.md) — Template system for mode variants
