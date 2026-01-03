---
name: sailing
description: Project governance via PRD → Epic → Task workflow.
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash
---

# Sailing

Refs: `rudder paths roadmap`, **`.claude/TOOLSET.md`** (optional, user-created)

---

## Constitutional Layer (Tier 0)

These invariants are immutable. Everything else submits to them.

```
1. Rudder is the single source of truth for state.
2. Main thread makes all decisions.
3. Agents execute and return output. They never chain, infer, or decide.
4. When in doubt: stop, log, escalate. Never guess.
5. Memory that is not consolidated before execution is considered lost.
6. Use rudder commands for metadata queries. Never grep/search task files directly.
```

---

## Authority Model

| Component | Authority |
|-----------|-----------|
| **Main thread (skill)** | Decisions, sequencing, orchestration |
| **Coordinator** | High-level /dev commands, creates artefacts, returns output |
| **Agent** | Pure execution, implements deliverables, returns output |
| **Rudder CLI** | State mutations, context guidance, role enforcement |
| **User** | Git commits, approvals, final decisions |

---

## Role Model

| Role | Description | Can Spawn | Can Decide | Sees Memory |
|------|-------------|-----------|------------|-------------|
| **skill** | Main orchestrator | ✓ | ✓ | Full hierarchy (Project→PRD→Epic) |
| **coordinator** | /dev commands | ✓ (batch) | ❌ returns output | Full (`--full`) |
| **agent** | Task execution | ❌ | ❌ | Agent Context only (Epic level) |

**Enforcement**: CLI commands validate role. Wrong role = blocked.

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

- Rudder is SoT for state
- Agents don't decide, don't chain, don't infer
- Main thread owns all sequencing
- No guessing — escalate instead

### Tier 1 — Safety (must be followed)

- Memory sync before task execution
- Dependency check before parallelization
- No git commit/push by agents
- No direct frontmatter edits — use Rudder
- Specs locked during implementation

### Tier 2 — Operational (preferred practices)

- Max 6 parallel agents
- Read TOOLSET.md before implementation (if exists)
- Create artefacts via `rudder` CLI (never manually)

---

## Memory Philosophy

**Memory = institutional knowledge. Logs = raw observations.**

```
Agents PRODUCE logs → task:log
Skill CONSOLIDATES logs → memory files
Memory GUIDES future agents
```

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

Run `rudder memory:sync` — it provides contextual escalation guidance.

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

Before ANY /dev command: `rudder context:load <operation> --role <role>`

The CLI provides:
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
2. **Log the issue** — `task:log --error` or `--critical`
3. **Stop cleanly** — return output describing the block
4. **Never force** — don't push through misaligned specs

The skill decides how to proceed.
