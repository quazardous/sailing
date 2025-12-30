---
description: Audit test quality and structure (2 passes)
argument-hint: [path/to/tests]
allowed-tools: Read, Glob, Grep, Task
---

**Audit test quality: cheater tests + structure compliance.**

## Pre-flight

```bash
rudder core:show agent    # Constitutional rules, CLI contract
```

## Pass 1: Analysis (agent)

```
1. **Find and read TESTING.md**
   - Look for TESTING.md relative to target path (sub-project may have its own)
   - Fallback to root TESTING.md if none found
   - Extract: structure, tools, conventions

2. **Scan test files**
   - Location vs expected structure
   - Naming conventions

3. **Analyze test quality** - flag:

   Cheater patterns:
   - No real assertions (or trivial like `toBe(true)`)
   - Excessive mocking (mocks the thing being tested)
   - Async without await (test ends before execution)
   - Try/catch swallowing errors
   - Empty catch blocks
   - Tests that can never fail
   - Snapshot without meaningful checks

   Structure issues:
   - Wrong folder (unit in integration, etc.)
   - Wrong naming pattern
   - Missing test types per TESTING.md
   - Wrong tools used

Output:
- TESTING.md summary (expected structure)
- Issues found per file
- Cheater tests identified (with reason)
- Structure violations
```

→ User reviews findings, confirms what to fix

## Pass 2: Recommendations (agent)

```
For confirmed issues, propose fixes:

Per cheater test:
- What's wrong (pattern identified)
- What should be tested instead
- Pseudo-code for real assertion

Per structure issue:
- Current location/name
- Expected location/name
- Migration suggestion

NO CODE - describe what assertions should verify, not how to write them.
```

Report: cheater tests found, structure violations, fix recommendations.
