## 1. Start

```bash
rudder task:log TNNN "Starting: <approach>" --info
```

## 2. Execute

Implement deliverables. No scope expansion.

Log insights as you go:
- `--info` for milestones
- `--tip` for non-obvious patterns
- `--warn` for issues/workarounds

## 3. Complete

Before marking Done:
- [ ] All deliverables implemented
- [ ] Tests pass (if applicable)
- [ ] At least 2 log entries (start + final tip)

```bash
rudder task:log TNNN "<key insight for next agent>" --tip
rudder task:update TNNN --status Done
```

**Rejection**: incomplete deliverables, <2 logs, or frontmatter edited directly.
