## 1. Execute

Implement deliverables. No scope expansion.

**Log at least 1 TIP** during work:
```bash
rudder task:log TNNN "<pattern/insight for next agent>" --tip
```

Other levels:
- `--info` for milestones
- `--warn` for issues/workarounds

## 2. Complete

Before finishing:
- [ ] All deliverables implemented
- [ ] Tests pass (if applicable)
- [ ] At least 1 TIP logged

```bash
rudder assign:release TNNN
```

**Rejection**: incomplete deliverables, 0 TIP logs, or frontmatter edited directly.
