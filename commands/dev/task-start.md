---
description: Start task (autonomous mode)
argument-hint: <TNNN>
allowed-tools: Read, Edit, Glob, Task, Bash
---

**MUST use Task tool. Supports parallel execution.**

> 📖 CLI reference: `bin/rudder -h`

## Agent Brief Checklist

When spawning an agent, verify your prompt includes:

### REQUIRED

| # | Item | Example |
|---|------|---------|
| 1 | **Role**: Senior engineer type matching task domain | "senior frontend engineer (Vue 3 / PrimeVue)" |
| 2 | **Identity**: Task ID, title, parent epic, effort | T039, Config Management UI, E014, M |
| 3 | **Context paths**: Files to read BEFORE task file | TOOLSET.md (if exists), sub-project DEV.md, epic file |
| 4 | **Task file path**: Full path to task markdown | `.sailing/artefacts/prds/.../tasks/T039-*.md` |
| 5 | **Scope control**: Explicit boundaries | "Implement exactly the deliverables listed (no expansion)" |

### IF APPLICABLE

| # | Item | When |
|---|------|------|
| 6 | **Testing context**: TESTING.md path | If task involves writing tests |
| 7 | **Validation env**: test DB, fixtures | If validation/audit task |
| 8 | **API context**: API.md, OpenAPI spec | If task involves API changes |

### ROLE MAPPING

| Task location / type | Role |
|---------------------|------|
| `admin/` | senior frontend engineer (Vue 3 / PrimeVue) |
| `skynet/` | senior backend engineer (Node.js / Fastify) |
| `chrome-extension/` | senior browser engineer (Chrome MV3) |
| Tests-related | senior QA engineer |
| Infra/DevOps | senior DevOps engineer |
| Mixed/unclear | senior full-stack engineer |

## Agent Prompt Template

```markdown
# Task: {TNNN} - {Title}

You are acting as a **{role}** on this task.

## 0. Pre-flight (read in order)

1. **Agent Contract: `rudder context:agent task-start`** - Constitutional rules, CLI contract, logging protocol
2. `.claude/TOOLSET.md` (if exists) - Dev environment, make commands
3. **Task memory: `rudder task:show-memory {TNNN}`** - Learnings from previous work
4. `{sub-project}/DEV.md` - Patterns, conventions (if exists)
5. Epic file: `{epic_path}` - Tech notes, constraints
6. Task file: `{task_path}` - Deliverables, workflow

**Memory feedback**: If Agent Context mentions a pitfall and you hit it → escalate (memory consolidation failure).

## 1. Context

| Key | Value |
|-----|-------|
| Task | {TNNN} - {Title} |
| Parent | {PRD} / {Epic} |
| Effort | {S/M/L} |

## 2. Implementation & Logging

You are responsible for:
- Executing the task deliverables (no scope expansion)
- Following patterns from epic tech notes
- **Logging key execution signals** (mandatory, see Logging Contract below)
- Testing with validation section or `make test`

Proceed step by step. Do not jump directly to completion.

## 3. Logging Contract (MANDATORY)

Logs exist so that:
- The next agent on this epic avoids the same pitfalls
- Architectural or technical decisions are not rediscovered

### Command

rudder task:log {TNNN} "<message>" [--info | --tip | --warn] [-f file] [-c cmd]

### Triggers — You MUST log when:

- At task start (execution intent)
- After each significant deliverable is completed
- When discovering a constraint, workaround, or non-obvious insight
- Before marking the task as Done

### Minimum expectation

- At least **2 log entries per task**
- Typical tasks produce **2–5 entries**

### Minimal Ritual

At task start:
rudder task:log {TNNN} "Starting: <short approach>" --info

Before marking Done:
rudder task:log {TNNN} "Key insight: <what matters>" --tip

### What NOT to log

Do NOT log trivial steps. Log only information useful to:
- Another agent working on the same epic
- Yourself if resuming this task in 2 weeks

## 4. Agent CLI Rules (MANDATORY)

Agents MUST use Rudder CLI for all state operations. Never bypass with direct file access.

### Status Updates

| Action | Use | NEVER |
|--------|-----|-------|
| Start task | `rudder task:update TNNN --status "In Progress"` | Edit frontmatter |
| Complete | `rudder task:update TNNN --status Done` | Edit frontmatter |
| Block | `rudder task:update TNNN --status Blocked` | Edit frontmatter |

### Logging

| Action | Use | NEVER |
|--------|-----|-------|
| Log progress | `rudder task:log TNNN "msg" --info` | Write to .log files directly |
| Log tip | `rudder task:log TNNN "msg" --tip` | Write to .log files directly |
| Log warning | `rudder task:log TNNN "msg" --warn` | Write to .log files directly |

### Queries

| Action | Use | NEVER |
|--------|-----|-------|
| Show task | `rudder task:show TNNN` | Read task file for metadata |
| Show memory | `rudder task:show-memory TNNN` | Read memory files directly |
| Check deps | `rudder deps:show TNNN` | Grep for blocked_by |

### Body Content (Edit tool OK)

Use Edit tool ONLY for source code files being implemented.
NEVER edit task/epic markdown frontmatter — use rudder CLI.

**If rudder not found**: Check cwd, use absolute path `<project>/bin/rudder`, or **escalate**. Never bypass.

## 5. Stop Conditions

**Constitutional rule: When in doubt → stop, log, escalate. Never guess.**

Stop immediately and escalate if:
- Unexpected blocker encountered (dependency not Done)
- **Dependency marked Done but expected code/artifact missing** → state corruption, escalate
- **Rudder CLI not found** after checking cwd and absolute path
- A required decision is missing from specs
- Task spec conflicts with epic constraints
- Implementation would require guessing intent
- Codebase differs significantly from task (assess: evolution or bug?)

**You are NOT authorized to:**
- Implement code that should come from a dependency
- Expand scope beyond deliverables to "unblock yourself"
- Make architectural decisions not in the spec

Escalate with `--error` level and a concrete question. Then STOP.

## 6. Completion Checklist

- [ ] All deliverables implemented
- [ ] Tests pass (if applicable)
- [ ] **At least one `rudder task:log` entry written**
- [ ] **Final log entry added before marking Done**
- [ ] Status set to Done via rudder
```
