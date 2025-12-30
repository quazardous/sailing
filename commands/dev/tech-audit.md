---
description: Audit tech opportunities in existing code (2 passes)
argument-hint: <path/or/pattern> ["axis: perf|security|bundle|dx|maintenance"]
allowed-tools: Read, Glob, Grep, Task, WebSearch, WebFetch
---

# Tech Audit Agent

**Purpose:** Identify technical improvement opportunities in existing code, aligned with optional focus axes.

> Two-pass workflow: analysis → research/recommendation

---

## Pre-flight

```bash
rudder core:show agent    # Constitutional rules, CLI contract
```

---

## Usage Examples

```bash
/dev:tech-audit src/api/auth
/dev:tech-audit src/workers "axis: perf"
/dev:tech-audit "**/*.vue" "axis: dx"
```

---

## Axes (optional)

| Axis | Focus |
|------|-------|
| `perf` | Performance, speed, caching |
| `security` | Vulnerabilities, best practices |
| `bundle` | Bundle size, tree-shaking |
| `dx` | Developer experience, simpler APIs |
| `maintenance` | Deprecated libs, alternatives |

---

## Pass 1: Code Analysis

**Target:** `{path_or_pattern}`

1. **Read context**
   - DEV.md / DEVELOPMENT.md (sub-project or root)
   - Note documented stack, conventions, patterns

2. **Inspect code**
   - Libraries used (name, version, purpose)
   - Code patterns observed
   - Complexity or pain points
   - Suspected outdated or anti-patterns

3. **DEV.md drift**
   - Compare reality vs documentation
   - Flag obsolete sections

**Output:** Findings Report (FR)
- Library usage & versions
- Pain points / complexity
- DEV.md drift
- **No web search yet**

→ Main thread confirms which items to research in Pass 2

---

## Pass 2: Research & Recommendation

**Input:** Confirmed items from Pass 1
**Axis:** `{axis or "general"}`

For each item:

1. **Web research**
   - Modern alternatives
   - Compare: API, performance, maintenance, popularity
   - Migration effort / breaking changes

2. **Document opportunities**
   - **Current → Proposed**: what changes
   - **Why**: benefit (aligned with axis)
   - **Effort**: Low / Medium / High
   - **Links**: docs, migration guides

3. **Prioritization**
   - Quick wins first
   - High-impact but complex items flagged separately

**Output:** Opportunity Report
- List of changes with justification
- Effort estimates
- DEV.md drift (if any)

---

## Non-Goals

This command does **NOT**:

- Modify code during audit
- Make final decisions (user validates)
- Implement changes (separate task)
- Skip user confirmation between passes

---

## Failure Philosophy

- If code purpose is unclear → escalate, don't assume
- If no good alternative exists → say so explicitly
- **When in doubt: stop, log, escalate — never guess**
