---
description: Debug failing tests (2-pass, project-aware)
argument-hint: [test-path] [--task TNNN]
allowed-tools: Read, Edit, Glob, Grep, Task, Bash, mcp
---

# Test Debug Agent

**Purpose:** Debug failing tests in a project-aware, 2-pass process without weakening assertions. Supports task context (`--task TNNN`).

---

## Pre-flight

```json
// MCP: context_load
{ "operation": "test-debug", "role": "coordinator" }
```

If `--task TNNN` provided:
```json
// MCP: artefact_show
{ "id": "TNNN" }

// MCP: memory_read - Agent context (memory + tech notes)
{ "scope": "TNNN", "full": true }
```

---

## Pass 1: Capture & Analyze

**Goal:** Identify all failures and build context before fixing.

1. **Run full test suite**
   ```bash
   make test 2>&1 | tee /tmp/test-output.txt
   ```
   Or project-specific command from TESTING.md. Capture full output (stdout + stderr).

2. **Parse failures**
   - Extract failing test names/paths
   - Capture error messages, stack traces
   - Group by type: assertion / runtime / timeout

3. **Gather context**
   - Read TESTING.md for conventions
   - Check `system_status` for project/task state
   - Check `tests/validation/` for audit findings
   - Related task if `--task` provided

4. **Produce Failure Report (FR)**
   - List of failing tests with:
     - Test path
     - Error type
     - Error message (truncated)
     - Audit flags if any
   - Test conventions summary
   - Project context

**Output:** FR passed to Pass 2

---

## Pass 2: Fix Test by Test

**Input:** FR from Pass 1

For each failing test (process **sequentially**):

1. **Run single test**
   - Execute only this test (not full suite)
   - e.g., `npm test -- --testPathPattern="<test-file>"`
   - Or equivalent filtered command

2. **Diagnose**
   - Run linter on test file + source file (syntax, unused vars, types, imports)
   - Determine failure type: test bug / implementation bug / env issue
   - Check FR audit flags

3. **Fix decision**

   | Cause | Action |
   |-------|--------|
   | Lint error | Fix lint issues (often root cause) |
   | Test bug | Fix respecting conventions |
   | Impl bug | **Escalate**; do not hack test |
   | Env issue | Document in `## Log` |
   | Audit flag | Apply audit recommendations |

4. **Verify fix**
   - Re-run only this test
   - Confirm pass before moving to next

5. **Proceed to next failing test**

⚠️ **Never weaken assertions**
⚠️ **Do not re-run full suite between individual fixes**

---

## Final Validation

After all individual fixes:

1. Run full test suite once
2. Confirm no regressions
3. Report:
   - Total tests fixed
   - Issues escalated (implementation bugs)
   - Audit flags applied

## Logging

```json
// MCP: task_log
{ "task_id": "TNNN", "message": "Fixed test: description" }
```

See logging rules in context.

---

## Non-Goals

This command does **NOT**:

- Weaken or skip assertions to make tests pass
- Fix implementation bugs (escalate instead)
- Modify test structure without respecting TESTING.md
- Parallelize individual test fixes
