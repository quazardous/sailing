# Completion Protocol

Before marking task Done:

## Checklist

- [ ] All deliverables implemented
- [ ] Tests pass (if applicable)
- [ ] At least 2 log entries written
- [ ] Final insight logged (`--tip`)
- [ ] Status set via rudder (not frontmatter edit)

## Command

```bash
rudder task:update TNNN --status Done
```

## Rejection criteria

Task will be rejected if:
- Deliverables incomplete
- < 2 log entries
- Frontmatter edited directly
