# Milestone Validation

## Structure

Milestones are defined in PRD with criteria:
```yaml
milestones:
  - id: M1
    title: "Milestone title"
    epics: [E001, E002]
```

Criteria file: `<prd-dir>/docs/M1-criteria.md` (use `rudder prd:show PRD-NNN --json` to get paths)

## Validation checklist

- [ ] All milestone epics Done
- [ ] All tasks within epics Done
- [ ] Criteria file requirements met
- [ ] No pending memory consolidation

## Commands

```bash
rudder prd:show PRD-NNN              # View milestones
rudder epic:list --prd PRD-NNN       # Epics status
```

## Approval

Milestone completion requires user approval.
