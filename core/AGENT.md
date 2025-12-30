# Agent Contract

**All agents MUST read this before execution.**

---

## 1. Constitutional Rules (Tier 0)

These are immutable. Violation = system failure.

```
1. Rudder is the single source of truth for state.
2. Main thread makes all decisions.
3. Agents execute and return output. Never chain, infer, or decide.
4. When in doubt: stop, log, escalate. Never guess.
5. Memory not consolidated before execution is lost.
6. Use rudder commands for metadata. Never grep/search files directly.
```

---

## 2. Memory Sync Protocol

**MANDATORY before any task execution.**

```bash
rudder memory:sync
```

| Output | Action |
|--------|--------|
| `✓ No pending logs` | Proceed |
| `⚠ MEMORY SYNC REQUIRED` | Consolidate logs into ENNN.md, then `rudder epic:clean-logs ENNN` |

**When to run:**
- Before spawning task agents
- Between batches
- When resuming work

**Invariant:** Memory not consolidated = lost. Lost memory = system failure.

---

## 3. CLI Contract

Rudder is the ONLY interface for state operations.

### Queries (read)

| Data | Command | NEVER |
|------|---------|-------|
| Task metadata | `rudder task:show TNNN` | Read .md files |
| Task list | `rudder task:list` | Glob/Grep files |
| Dependencies | `rudder deps:show TNNN` | Parse blocked_by |
| Ready tasks | `rudder deps:ready` | Manual analysis |
| Memory | `rudder task:show-memory TNNN` | Read memory files |
| Versions | `rudder versions` | Parse package.json |

### Mutations (write)

| Action | Command | NEVER |
|--------|---------|-------|
| Create task/epic | `rudder task:create`, `rudder epic:create` | Write tool |
| Update status | `rudder task:update TNNN --status Done` | Edit frontmatter |
| Add dependency | `rudder deps:add TNNN --blocked-by T001` | Edit blocked_by |
| Log progress | `rudder task:log TNNN "msg" --info` | Write .log files |

### Body Content (Edit tool OK)

Edit tool is allowed ONLY for:
- Source code files being implemented
- Body sections of PRD/Epic/Task (Description, Deliverables, Technical Details)

**NEVER edit frontmatter directly.**

### If rudder not found

1. Check `pwd` — may be in subproject
2. Use absolute path: `<project>/bin/rudder`
3. Still not found → **STOP and escalate**

---

## 4. Logging Contract

Logs preserve knowledge across agent boundaries.

### Command

```bash
rudder task:log TNNN "<message>" [--info | --tip | --warn | --error]
```

### When to log

| Trigger | Level |
|---------|-------|
| Task start | `--info` |
| Deliverable completed | `--info` |
| Non-obvious insight | `--tip` |
| Issue or workaround | `--warn` |
| Cannot continue | `--error` |

### Minimum

- **2 log entries per task** (start + insight before Done)
- Only log what helps the next agent

### What NOT to log

Trivial steps, obvious progress.

---

## 5. Stop & Escalate

**When in doubt → stop, log, escalate. Never guess.**

### Stop immediately if:

- Blocker encountered (dependency not Done)
- Dependency Done but artifact missing → **state corruption**
- Rudder CLI not found after checks
- Required decision missing from specs
- Spec conflicts with constraints
- Would require guessing intent
- Codebase differs significantly from task

### You are NOT authorized to:

- Implement code that should come from a dependency
- Expand scope to unblock yourself
- Make architectural decisions not in spec
- Chain to other commands
- Commit to git

### Escalation

```bash
rudder task:log TNNN "BLOCKED: <concrete question>" --error
```

Then **STOP**. Do not continue.

---

## 6. Completion Protocol

Before marking task Done:

```
[ ] All deliverables implemented
[ ] Tests pass (if applicable)
[ ] At least 2 log entries written
[ ] Final log entry added
[ ] Status set via rudder (not frontmatter edit)
```

```bash
rudder task:update TNNN --status Done
```

---

## 7. Authority Model

| Component | Authority |
|-----------|-----------|
| Main thread | Decisions, sequencing |
| Agents | Execution only |
| Rudder CLI | State mutations |
| User | Git commits, approvals |

Agents return output. Main thread decides next action.

---

## Quick Reference

```bash
# Before work
rudder memory:sync

# During work
rudder task:show TNNN
rudder task:show-memory TNNN
rudder task:log TNNN "msg" --info

# Complete work
rudder task:log TNNN "insight" --tip
rudder task:update TNNN --status Done
```
