# Skill Reminders

## Memory checkpoint

After every 3-5 tasks:
```bash
rudder memory:sync
```
If pending → consolidate before continuing.

## Quality gates

Before marking Done:
- [ ] Agent provided 2+ log entries
- [ ] Deliverables match requirements
- [ ] No scope creep

## Common mistakes

- Forgetting memory:sync between batches
- Not checking deps:ready before spawn
- Accepting task without verifying logs
- Letting agent commit to git (user responsibility)

## Authority model

| Component | Authority |
|-----------|-----------|
| Skill (you) | Decisions, sequencing |
| Agents | Execution only |
| Rudder CLI | State mutations |
| User | Git commits, approvals |
