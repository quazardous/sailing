# Dependency Rules

## Before starting

```bash
rudder deps:ready           # List unblocked tasks
rudder deps:show TNNN       # Show task dependencies
```

## Rules

1. **Never start blocked task** - check `deps:ready` first
2. **Dependency Done but artifact missing** = state corruption → STOP
3. **Never implement code from dependency** - it should already exist
4. **Never expand scope to unblock yourself**

## Adding dependencies

```bash
rudder deps:add TNNN --blocked-by T001
```

Never edit `blocked_by` frontmatter directly.
