# Breakdown Guidelines

## Effort Estimation (AI-calibrated)

Tasks have an `effort` field in hours. **Calibration is for AI agents, not humans.**

| Effort | Description | Examples |
|--------|-------------|----------|
| **30min** | Trivial change | Fix typo, rename variable, add comment |
| **1h** | Standard task (baseline) | Add simple function, fix bug, update config |
| **2h** | Complex task | New feature with tests, refactor module |
| **4h** | Large task | Multi-file feature, significant refactoring |
| **8h+** | Should be split | Too big → break down further |

## Task Granularity

**Target: 1-2h per task** (AI can complete in one session without losing context)

Signs a task is too big:
- Multiple unrelated deliverables
- Touches 5+ files in different domains
- Has "and" connecting different concerns
- Would take human 1+ day

## Epic Breakdown → Tasks

When decomposing an epic:
1. Identify independent work units
2. Each task = one clear objective
3. Estimate effort based on AI capabilities
4. If effort > 4h → split further
5. Order tasks by dependencies

## PRD Breakdown → Epics

When decomposing a PRD:
1. Group by feature/domain
2. Each epic = shippable increment
3. Consider milestone boundaries
4. 3-7 tasks per epic (guideline)
