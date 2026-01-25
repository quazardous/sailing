---
name: sailing
description: Project governance via PRD → Epic → Task workflow.
allowed-tools: Read, Write, Edit, Glob, Grep, Task, mcp
---

# Sailing

Refs: `system_paths { "type": "roadmap" }`, **`.claude/TOOLSET.md`** (optional, user-created)

---

## Constitutional Layer (Tier 0)

These invariants are immutable. Everything else submits to them.

```
1. MCP tools are the single source of truth for state.
2. Main thread makes all decisions.
3. Agents execute and return output. They never chain, infer, or decide.
4. NEVER Edit/Write artefacts directly → use MCP tools (artefact_edit, artefact_update).
5. When in doubt: stop, log, escalate. Never guess.
6. Memory that is not consolidated before execution is considered lost.
7. Use MCP tools for metadata queries. Never grep/search task files directly.
```

---

## Authority Model

| Component | Authority |
|-----------|-----------|
| **Main thread (skill)** | Decisions, sequencing, orchestration |
| **Coordinator** | High-level /dev commands, creates artefacts, returns output |
| **Agent** | Pure execution, implements deliverables, returns output |
| **MCP Tools** | State mutations, context guidance, role enforcement |
| **User** | Git commits, approvals, final decisions |

---

## Mandatory Delegation (NON-NEGOTIABLE)

**The skill MUST delegate these operations to coordinator agents. NEVER execute directly.**

| Operation | Delegate To | Why |
|-----------|-------------|-----|
| `/dev:prd-review` | Coordinator | Complex analysis, may escalate questions |
| `/dev:epic-review` | Coordinator | Tech research, web search, may escalate |
| `/dev:prd-breakdown` | Coordinator | Spawns sub-agents, manages parallelism |
| `/dev:epic-breakdown` | Coordinator | Creates tasks, manages dependencies |
| `/dev:merge` | Coordinator | Conflict resolution, git operations |
| `/dev:tasks-batch` | Coordinator | Parallel agent spawning |

**Pattern:**
```
Skill → agent_spawn(coordinator) → Coordinator executes → Returns output → Skill decides
```

**Coordinators ESCALATE, they don't DECIDE:**
- Questions about scope → escalate to skill
- Ambiguous specs → escalate to skill
- Conflicts requiring judgment → escalate to skill
- User approval needed → escalate to skill

**The skill receives escalations and makes decisions. Coordinators are workers, not decision-makers.**

---

## Role Model

| Role | Description | Can Spawn | Can Decide | Sees Memory |
|------|-------------|-----------|------------|-------------|
| **skill** | Main orchestrator | ✓ | ✓ | Full hierarchy (Project→PRD→Epic) |
| **coordinator** | /dev commands | ✓ (batch) | ❌ returns output | Full (`--full`) |
| **agent** | Task execution | ❌ | ❌ | Agent Context only (Epic level) |

**Enforcement**: MCP tools validate role. Wrong role = blocked.

---

## Control Flow

```
Main thread → spawns → Agent/Coordinator
                              ↓
                          executes
                              ↓
                        returns Output
                              ↓
Main thread ← receives ← Output
     ↓
Decision Point (skill only)
     ↓
Main thread → spawns → Next Agent
```

Agents and coordinators NEVER chain. They return output and stop.

---

## Rule Tiers

### Tier 0 — Constitutional (cannot be broken)

- MCP tools are SoT for state
- Agents don't decide, don't chain, don't infer
- Main thread owns all sequencing
- No guessing — escalate instead

### Tier 1 — Safety (must be followed)

- Memory sync before task execution
- Dependency check before parallelization
- No git commit/push by agents
- No direct frontmatter edits — use MCP tools
- Specs locked during implementation

### Tier 2 — Operational (preferred practices)

- Max 6 parallel agents
- Read TOOLSET.md before implementation (if exists)
- Create artefacts via MCP tools (never manually)

---

## Memory Philosophy

**Memory = institutional knowledge. Logs = raw observations.**

```
Agents PRODUCE logs → task_log MCP tool (NOT files)
Skill CONSOLIDATES logs → memory files
Memory GUIDES future agents
```

⚠️ **NEVER create log files directly** (no `.tip-log.txt`, no `*.log` files).
Always use: `task_log { "task_id": "TNNN", "message": "...", "level": "tip" }`

Memory not consolidated before execution is considered **lost**.
Lost memory is a **system failure**.

---

## Memory Hierarchy

```
MEMORY.md (project)      ← Universal patterns, architecture decisions
    └── PRD-NNN.md       ← Cross-epic patterns for this PRD
        └── ENNN.md      ← Epic-specific agent context
            └── TNNN.log ← Raw task logs (temporary)
```

| Action | MCP Tool |
|--------|----------|
| Read | `memory_read { "scope": "ENNN" }` or `memory_read { "scope": "PROJECT" }` |
| Consolidate | `memory_sync {}` (shows pending + edit hints) |
| Agent view | `artefact_show { "id": "TNNN" }` + `memory_read { "scope": "TNNN" }` |

---

## Artefact Hierarchy

```
ROADMAP.md          Vision, versions, milestones
    └── PRD-NNN     Product requirements
        ├── Stories     Narrative context (passive)
        └── E-NNN       Epics (technical scope)
            └── T-NNN   Tasks (implementation units)
```

Each level has one abstraction. Don't mix.

---

## Context Loading

Before ANY /dev command: `context_load { "operation": "<operation>", "role": "<role>" }`

The MCP tool provides:
- Role-appropriate context (what you need to know)
- Workflow steps (what you need to do)
- Guidance (how to handle edge cases)

**No conditionals in output** — pre-filtered for your role.

---

## What Agents Do NOT Do

- **Chain** to other commands
- **Decide** next steps
- **Commit** to git
- **Modify** scope beyond mandate
- **Guess** when specs unclear

If blocked → log, return output, let skill handle.

---

## What Skill Does NOT Do (Directly)

**The skill orchestrates but NEVER implements these operations directly:**

| Forbidden Action | Must Delegate To |
|------------------|------------------|
| Review PRD/Epic content | Coordinator (`/dev:prd-review`, `/dev:epic-review`) |
| Create epics from PRD | Coordinator (`/dev:prd-breakdown`) |
| Create tasks from Epic | Coordinator (`/dev:epic-breakdown`) |
| Merge agent work | Coordinator (`/dev:merge`) |
| Resolve git conflicts | Coordinator (`/dev:merge`) |
| Batch task execution | Coordinator (`/dev:tasks-batch`) |

**Why?** These operations are complex, require context loading, and may produce escalations. The skill must remain a decision-maker, not an executor.

**If the skill tries to execute directly:**
1. Context is incomplete (no `context_load`)
2. Escalations are lost (no structured output)
3. State tracking breaks (no proper MCP flow)

**Correct pattern:**
```
❌ Skill reads PRD, analyzes, decides (WRONG)
✅ Skill spawns coordinator → coordinator analyzes → returns output → skill decides (CORRECT)
```

---

## Git Rules

| Action | skill | coordinator | agent |
|--------|-------|-------------|-------|
| Read (`status`, `diff`, `log`) | ✓ | ✓ | ✓ |
| File modification | ✓ | ✓ | ✓ |
| `git add` | ✓ explicit | ❌ | ❌ |
| `git commit/push` | ❌ | ❌ | ❌ |

User controls all commits.

---

## Escalation Pattern

When uncertain:

1. **Do what's possible** — partial progress is valuable
2. **Log the issue** — `task_log { ..., "level": "error" }` or `"critical"`
3. **Stop cleanly** — return output describing the block
4. **Never force** — don't push through misaligned specs

The skill decides how to proceed.
