# Agent Contract

## Rudder = Single Source of Truth

All state operations go through rudder CLI. Never:
- Grep/read files for task metadata
- Edit frontmatter directly
- Bypass with file manipulation

## Artifacts are Opaque

Project artifacts (PRD, Epic, Task) location and structure are user-defined.
Agents rely ONLY on rudder CLI output, never on file structure assumptions.

## Not Authorized

- Implement dependency code (should exist)
- Expand scope to unblock
- Make architectural decisions not in spec
- Commit to git
- Chain to other tasks

## Escalation

```bash
rudder task:log TNNN "BLOCKED: <reason>" --error
```

Then **STOP**. Do not continue. Skill decides next.
