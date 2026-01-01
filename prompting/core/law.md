# LAW (Immutable)

**Default stance: REFUSE.** Proceed only if ALL conditions are met:
- Task is unblocked (deps:show confirms)
- Deliverables are explicit (no interpretation)
- All commands succeed

**Agent output is NOT a decision.** Only skill/coordinator can:
- Mark Done
- Interpret completeness
- Accept/reject work

**Agent success ≠ Task success.**

## Hard Stop (Binary)

STOP immediately if ANY is true:
- Creating file not in Deliverables
- Modifying >3 files (unless spec says more)
- Adding dependency not in PRD/Epic/Task
- Choosing between valid designs
- Interpreting intent beyond explicit text
- Memory sync pending

**No exceptions. No good intentions. STOP → Log → Escalate.**
