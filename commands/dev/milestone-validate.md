---
description: Validate milestone criteria (2 passes)
argument-hint: <PRD-NNN> <M1|M2|...>
allowed-tools: Read, Glob, Grep, Task, Bash
---

# Milestone Validation Agent

**Purpose:** Validate milestone acceptance criteria and report results to main thread.

> 📖 CLI reference: `.sailing/core/RUDDER.md` or `bin/rudder -h`
> 📖 Full documentation: `.sailing/core/MILESTONE.md`

---

## Pre-flight

```bash
rudder core:show agent    # Constitutional rules, CLI contract
```

---

## Validation Artifacts Location

```
prds/PRD-NNN/milestones/
├── m1-dev-stack/
│   ├── CRITERIA.md       # Acceptance criteria (required)
│   ├── validate.sh       # Validation script (optional)
│   └── fixtures/         # Test data (optional)
├── m2-storage-queues/
└── m3-external-api/
```

---

## Pass 1: Validation

1. **Locate artifacts**
   - Find: `prds/{prd_id}/milestones/m{N}-*/`
   - If missing: create folder + CRITERIA.md from template
   - Template: `.sailing/templates/milestone-criteria.md`

2. **Read CRITERIA.md**
   - List all acceptance criteria
   - Note dependencies and required fixtures

3. **Run validation**
   - **Option A:** Script exists → `./validate.sh`
   - **Option B:** Manual → follow CRITERIA.md "Validation Method"
   - **Option C:** Browser → execute javascript_tool tests

4. **Check versions** (`rudder versions`)
   - Compare current versions vs milestone targets in PRD
   - Flag discrepancies

5. **Output per criterion**
   - ✅ PASS: criterion description
   - ❌ FAIL: criterion description with details

**Summary:** X/Y criteria passed

→ All pass: update CRITERIA.md status
→ Failures: proceed to Pass 2

---

## Pass 2: Diagnosis & Escalation

For each failed criterion:

1. **Diagnose**
   - Regression or never implemented?
   - Which task(s) related?
   - Suspected root cause

2. **Update CRITERIA.md**
   - Mark failed criteria with ❌
   - Add Drift Report section

3. **Produce Escalation Report**

```markdown
## 🚨 Milestone Validation Failed: M{N}

**PRD**: {prd_id}
**Result**: X/Y criteria passed

### Failed Criteria

#### 1. {criterion}
- **Expected**: ...
- **Actual**: ...
- **Diagnosis**: ...
- **Related task**: T0XX

### Proposed Corrective Actions

| # | Action | Target | Urgency |
|---|--------|--------|---------|
| 1 | Reopen task | T0XX | High |

### Awaiting Decision

Please confirm corrective actions or provide alternative direction.
```

⚠️ **Wait for user decision — Do NOT auto-fix**

---

## Output

Returns to main thread:
- Validation summary (pass/fail count)
- Escalation report (if failures)
- Proposed corrective actions (if failures)

**Main thread decides corrective actions.**
This command does not reopen tasks or trigger fixes.

---

## Non-Goals

This command does **NOT**:
- Automatically fix failed criteria
- Reopen tasks or create bugfixes
- Trigger other commands
- Decide next steps

---

## Failure Philosophy

- Report findings accurately
- Propose actions but do not execute
- **When in doubt: stop, log, escalate — never guess**
