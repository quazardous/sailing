---
name: sailing
description: Project governance via PRD → Epic → Task workflow.
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash
---

# Sailing

Refs: `rudder paths roadmap`, **`.claude/TOOLSET.md`** (optional, user-created)

---

## Pre-flight: Context Loading (MANDATORY)

Before ANY command execution:

```bash
# Skill (main thread) loads its context:
rudder context:skill <command>

# Before spawning agent, provide agent context:
rudder context:agent <command>
```

| Who | Command | When |
|-----|---------|------|
| **Skill** | `rudder context:skill task-start` | Before orchestrating task-start |
| **Agent** | `rudder context:agent task-start` | Injected by skill when spawning |

**This is not optional.** Context contains:
- Constitutional rules
- CLI contract
- Logging requirements
- Stop conditions
- Memory sync protocol

Without context, agents forget critical rules (e.g., minimum 2 log entries).

---

## Constitutional Layer (Tier 0)

These invariants are immutable. Everything else submits to them.

```
1. Rudder is the single source of truth for state.
2. Main thread makes all decisions.
3. Agents execute and return output. They never chain, infer, or decide.
4. When in doubt: stop, log, escalate. Never guess.
5. Memory that is not consolidated before execution is considered lost. Lost memory is a system failure.
6. Use rudder commands for metadata queries. Never grep/search task files directly.
```

### Authority Model

| Component | Authority |
|-----------|-----------|
| **Main thread** | Decisions, sequencing, orchestration |
| **Agents/Commands** | Execution only, return output |
| **Rudder CLI** | State mutations (status, versions, deps) |
| **User** | Git commits, approvals, final decisions |

### Rudder as Single Source of Truth

During task execution phases, **rudder CLI is the ONLY authority** for:

| Data | Authoritative Command | NEVER use |
|------|----------------------|-----------|
| Task metadata | `rudder task:show TNNN` | Grep/Read on .md files |
| Task list/status | `rudder task:list` | Search/Glob for task files |
| Dependencies | `rudder deps:show TNNN` | Grep for `blocked_by` |
| Ready tasks | `rudder deps:ready` | Manual dependency analysis |
| Target versions | `rudder task:targets <comp>` | Grep for `target_versions` |
| Epic/PRD status | `rudder status` | File reads + status parsing |
| PRD milestones | `rudder prd:milestone PRD M1 --add-epic ENNN` | Edit PRD frontmatter |
| Versions | `rudder versions` | JSON parsing of package.json |
| Memory pending | `rudder memory:sync` | Glob for .log files |
| Epic memory | `rudder epic:show-memory ENNN` | Read .sailing/memory/*.md |
| Paths | `rudder paths <key>` | Hardcoded paths |

**Why**: Rudder handles path resolution, status normalization, dependency graph, and state consistency. Direct file access bypasses these guarantees.

**If rudder is not found**:
1. Check your working directory (`pwd`) — you may be in a subproject
2. Use absolute path: `<project_root>/bin/rudder`
3. If still not found → **STOP and escalate**. NEVER bypass by editing files directly.

Editing task/epic/PRD files to change status or milestones is a **Constitutional violation**.

### Control Flow

```
Main thread → spawns → Agent
                         ↓
                     executes
                         ↓
                     returns Output
                         ↓
Main thread ← receives ← Output
     ↓
Decision Point
     ↓
Main thread → spawns → Next Agent
```

---

## Rule Tiers

### Tier 0 — Constitutional (cannot be broken)

- Rudder is SoT for state
- Agents don't decide, don't chain, don't infer
- Main thread owns all sequencing
- No guessing — escalate instead

### Tier 1 — Safety (must be followed)

- **Memory Sync before any task execution** (see Memory Sync section)
- Dependency check before parallelization
- No git commit/push by agents
- No direct frontmatter edits — use Rudder
- Specs locked during implementation — ask only if blocked

### Tier 2 — Operational (preferred practices)

- Max 6 parallel agents
- Read TOOLSET.md before implementation (if exists)
- Create PRD/Epic/Task via `rudder` CLI (never manually)
- Keep docs at one abstraction level per section

---

## Documentation Structure

| File | Abstraction | Content |
|------|-------------|---------|
| **ROADMAP.md** | Vision | Features, versions, milestones, backlog |
| **POSTIT.md** | Triage | User scratch pad → Backlog or Task |
| **prompting/** | Agent context | Optimized fragments for agents/skill |

**Context commands replace documentation reading:**
- `rudder context:agent <cmd>` → agent execution rules
- `rudder context:skill <cmd>` → skill orchestration rules
- `rudder --help` → CLI mechanics

**Rule**: One doc = one abstraction level. Don't mix vision with mechanics.

---

## Dependency Rules

### Sequential Only (arrows = dependency)

```
prd-review ──────► prd-story (if needed) ──► prd-breakdown
prd-breakdown ───► epic-review ───► epic-breakdown
epic-breakdown ──► prd-story-finalize (if orphan stories) ──► task-start
test-audit ──────► test-debug
tech-audit ──────► tasks-rewrite
milestone-validate ► roadmap-sync
```

If user requests both sides of an arrow → **sequential, not parallel**.

### Parallel OK

- Same command, different independent targets
- Different commands with no arrow between them
- Tasks with no `blocked_by` relationship
- Use `/dev:tasks-batch` for parallel task execution

### Selecting Tasks for Batch Execution

```bash
# Get ready tasks for a PRD, sorted by impact
rudder deps:ready --prd PRD-006 --limit 6

# Or filter by epic
rudder deps:ready --epic E048 --limit 4
```

**CRITICAL**: Tasks returned by `deps:ready` are **guaranteed independent**.
- A task is "ready" only if ALL its blockers are "Done"
- Therefore, two ready tasks cannot block each other
- NO manual inter-dependency check needed

### Before Spawning Multiple Agents

1. Use `rudder deps:ready` output — tasks are pre-validated
2. Validate no structural issues: `rudder deps:validate`

---

## Memory Sync (MANDATORY)

**No task may be spawned until previous logs are consolidated.**

This applies BEFORE any task execution, regardless of context:
- First task of an epic? → Memory Sync (previous epic work may exist)
- Resuming a blocked task? → Memory Sync (previous attempt may have logged)
- Continuing after task completion? → Memory Sync

### Command

```bash
rudder memory:sync [ID]          # Merge task→epic logs, show pending content, create .md
```

- `ID` optional: `ENNN` or `TNNN` (resolves to parent epic)
- Auto-creates missing `ENNN.md` files from template
- `--no-create` to skip .md creation

### Workflow

```bash
# 1. Run memory:sync (merges TNNN.log → ENNN.log, shows content)
rudder memory:sync

# If "No pending logs" → proceed to task execution

# If "MEMORY SYNC REQUIRED":
#   - Logs are displayed in the output — DO NOT read .md files separately
#   - Consolidate displayed content into ENNN.md (see Level Mapping)
#   - Clean up:
rudder epic:clean-logs ENNN
```

### Level Mapping (automatic)

| Log Level | → Memory Section |
|-----------|------------------|
| `[TIP]` | Agent Context |
| `[ERROR]`, `[CRITICAL]` | Escalation |
| `[INFO]`, `[WARN]` | Changelog |

### Skill Responsibility

```
Agents PRODUCE logs (via task:log).
Agents DO NOT interpret or consolidate logs.

The skill MUST:
1. Run memory:sync before any task execution
2. If logs pending → consolidate manually into ENNN.md
3. Run epic:clean-logs ENNN after consolidation
4. Re-run memory:sync → must show "No pending logs"
```

**CRITICAL**: `memory:sync` output is the ONLY source for consolidation work:
- It lists which ENNN need consolidation (by epic ID)
- It displays the log CONTENT inline — no need to read files
- NEVER use Search/Glob to find memory files — use `memory:sync` output

### Invariant

Memory that is not consolidated before execution is considered lost.
Lost memory is a system failure.

---

## Decision Points

Main thread receives output, then decides next action.

Format: `Output received → Decision → Next command`

### After memory:sync (run BEFORE any work)
| Output | → Next |
|--------|--------|
| `✓ No pending logs` | Proceed with planned work |
| `⚠ MEMORY SYNC REQUIRED` + log content | Consolidate displayed content into ENNN.md, then `rudder epic:clean-logs ENNN` |

> **Key**: The epic IDs and log content are IN the output. Do NOT search for files.

### After PRD review
| Output | → Next |
|--------|--------|
| ROADMAP misaligned | `/dev:roadmap-sync` |
| Stories needed | `/dev:prd-story` |
| Stories not needed, versions defined | `/dev:prd-breakdown` |

### After PRD story
| Output | → Next |
|--------|--------|
| Stories created | `/dev:prd-breakdown` |

### After PRD breakdown
| Output | → Next |
|--------|--------|
| Epic needs tech choices | `/dev:epic-review` (recommended) |
| Epic has Technical Notes | `/dev:epic-breakdown` |

> **Why epic-review matters**: Tasks inherit decisions, not questions. Review once at epic level so tasks execute without thinking.

### After epic breakdown
| Output | → Next |
|--------|--------|
| Tasks ready, orphan stories | `/dev:prd-story-finalize` (fix before implementation) |
| Tasks ready, no orphans | `/dev:task-start` or `/dev:tasks-batch` |
| More epics pending | `/dev:epic-breakdown` (next epic) |

> **Orphan check**: Run `rudder story:validate PRD-NNN` after epic-breakdown.

### After task completion
| Output | → Next |
|--------|--------|
| Task has `target_versions` | `/dev:version-bump` |
| All epic tasks done | Epic auto-marked Done |
| All milestone tasks done | `/dev:milestone-validate` |

### After milestone validation
| Output | → Next |
|--------|--------|
| All criteria pass | `/dev:roadmap-sync` |
| Failures found | Reopen tasks or create bugfix |

### After tech-audit
| Output | → Next |
|--------|--------|
| Major refactor needed | New PRD |
| Existing tasks affected | `/dev:tasks-rewrite` |

### After test-audit
| Output | → Next |
|--------|--------|
| Issues found | Create tasks or fix directly |

---

## Agent Delegation

Commands spawn agents. Agents return output. Main thread decides next.

### Planning Commands
| Command | Returns |
|---------|---------|
| `/dev:prd-review` | Improvements, version recommendations, stories recommendation |
| `/dev:prd-story` | Created stories (when stories needed) |
| `/dev:prd-breakdown` | Created epics, escalated questions |
| `/dev:epic-review` | Tech recommendations, risks |
| `/dev:epic-breakdown` | Created tasks, dependency graph, story validation status |
| `/dev:prd-story-finalize` | Fixed orphan stories (when orphans exist) |

### Implementation Commands
| Command | Returns |
|---------|---------|
| `/dev:task-start` | Implementation result, blockers encountered |
| `/dev:tasks-batch` | Multiple task results |
| `/dev:task-done` | Cascade status (epic/PRD completion) |

### Audit Commands
| Command | Returns |
|---------|---------|
| `/dev:milestone-validate` | Pass/fail per criterion, escalation report |
| `/dev:tech-audit` | Opportunities, recommendations |
| `/dev:test-audit` | Cheater tests, structure violations |
| `/dev:test-debug` | Fixed tests, escalated issues |

---

## What Commands Do NOT Do

Commands are scoped. They do NOT:

- **Chain** to other commands
- **Decide** next steps (main thread decides)
- **Commit** to git
- **Modify** scope beyond their mandate
- **Guess** when specs are unclear

If a command needs something outside its scope → return output, let main thread handle.

---

## Git Rules

| Action | Allowed? |
|--------|----------|
| `git status`, `git diff`, `git log` | ✅ Read-only |
| File creation/modification | ✅ Via Write/Edit |
| `git add` | ⚠️ Only if explicitly requested |
| `git commit`, `git push` | ❌ Never |

User controls all commits. Agent work = uncommitted changes for review.

---

## Rudder CLI

Authoritative state management tool. Run `bin/rudder -h` for full reference.

### Core Commands (illustrative)

```bash
# These examples show typical usage. Always verify with rudder -h.
rudder task:next              # Find ready task
rudder task:start T042        # Set In Progress
rudder task:done T042 -m "x"  # Set Done + log
rudder deps:show T042         # Check blockers
rudder deps:validate --fix    # Fix issues
```

### Rules

1. **Create files via Rudder** — Never create PRD/Epic/Task/Story files manually
   ```bash
   rudder prd:create "Title"           # Creates PRD with template
   rudder story:create PRD-001 "Title" --type user  # Creates Story
   rudder epic:create PRD-001 "Title"  # Creates Epic with template
   rudder task:create PRD-001/E001 "Title"  # Creates Task with template
   ```

2. **Update state via Rudder** — Never edit frontmatter directly
   ```bash
   rudder task:update T042 --status wip --priority high
   ```

3. **Edit body via Edit tool** — Description, Deliverables, Technical Details
   - Use `Edit` to modify specific sections, don't rewrite entire file

---

## Valid Statuses

| Entity | Flow |
|--------|------|
| **PRD** | Draft → In Review → Approved → In Progress → Done |
| **Epic** | Not Started → In Progress → Done |
| **Task** | Not Started → In Progress → Blocked → Done → Cancelled |

---

## Stories

Stories provide narrative context. They are **passive** (no status tracking).

### Types

| Type | Format | Subject |
|------|--------|---------|
| `user` | As/I want/So that | User personas |
| `technical` | Subject/Must/Benefit | Pages, services, components |
| `api` | Endpoint/Consumer/Contract | API endpoints |

### Rules

- Every story MUST be referenced by at least one task
- Not every task needs stories
- Stories don't have status (narrative only)
- Use `rudder story:validate` to check for orphans

### CLI

```bash
rudder story:create PRD-001 "Title" --type user
rudder story:list PRD-001
rudder story:validate PRD-001     # Check for orphans
rudder story:orphans PRD-001      # List orphan stories
```

---

## Code in Specs

Code snippets become obsolete. Describe WHAT, not HOW.

| Level | Code? |
|-------|-------|
| PRD | Never |
| Epic | Rare (pseudo-code only) |
| Task | Exceptional (workflow description preferred) |

---

## Task vs Codebase Drift

Task descriptions may drift from codebase reality.

1. **Assess**: Blocking or minor?
2. **Understand**: Is codebase evolution justified or a bug?
3. **Never force**: Don't push through a task that doesn't fit

In doubt → Do what's possible → Stop → Escalate.

---

## Task Logging

Logging rules are in `rudder context:agent <cmd>` (section: Logging Contract).

```bash
rudder task:log TNNN "message" --level [-f file] [-c cmd] [-s snippet]
```

| Level | When |
|-------|------|
| `--info` | Progress milestones |
| `--tip` | Patterns, commands to remember |
| `--warn` | Issues, workarounds |
| `--error` | Significant problems |
| `--critical` | Cannot continue |

**Granularity**: Don't log everything. Only patterns, issues, commands worth remembering.

Systemic issues → `rudder feedback add "..." --task TNNN`

---

## Epic Memory

Memory files are managed by rudder (`memory:sync`, `epic:show-memory`, `epic:ensure-memory`).

| Section | Content | Audience |
|---------|---------|----------|
| **Agent Context** | Tips, commands, patterns | Task agents |
| **Escalation** | Errors, critical issues | Review/breakdown |
| **Changelog** | What was done, by which tasks | Review/breakdown |

**Rule**: Consolidation = compilation, NOT copy-paste of raw logs.

### Reading Memory

| Command | Shows | Used by |
|---------|-------|---------|
| `task:show-memory TNNN` | Agent Context only | Task agents |
| `epic:show-memory ENNN` | Agent Context only | Task agents |
| `epic:show-memory ENNN --full` | All sections | Review/breakdown agents |

**NEVER** use `Read` tool on `.sailing/memory/*.md` files directly. Always use the commands above.

**Rule**: Task agents see Agent Context only. High-level agents (epic-review, epic-breakdown) use `--full` to see escalations and full context.

### Writing Memory

**Skill responsibility**: Before launching epic work, consolidate previous logs.

```bash
# 1. Sync (merges TNNN.log → ENNN.log, shows content, creates .md if missing)
rudder memory:sync

# 2. If logs pending: COMPILE into ENNN.md (not copy!)
#   - [TIP] entries → Agent Context (strip prefix, keep actionable tip)
#   - [ERROR/CRITICAL] → Escalation (keep [TNNN] for traceability)
#   - [INFO/WARN] → Changelog (chronological, with [TNNN] refs)

# 3. Clean up
rudder epic:clean-logs ENNN      # Delete ENNN.log
```

**Consolidation = Compilation, NOT copy-paste.**

### During Task (agent)

```bash
rudder task:show-memory TNNN     # Read Agent Context (auto-resolves parent)
rudder task:log TNNN "..." --level  # Log during work
```

### Flow

```
[Previous work]
     ↓
memory:sync → ENNN.log displayed → consolidate into ENNN.md → epic:clean-logs
     ↓
[New work]
     ↓
task:show-memory (read Agent Context) → task:log → TNNN.log
     ↓
[Next cycle...]
```
