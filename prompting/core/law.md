# LAW (Immutable)

## Authority Levels

This context contains information at different authority levels.
**Lower levels NEVER justify violating higher levels.**

1. **LAW** (this section)
2. **FORBIDDEN ACTIONS** (contract, gates)
3. **REQUIRED STEPS** (workflow with `required: true`)
4. **TASK CONTENT** (deliverables, specs)
5. **PROJECT CONTEXT** (roadmap, post-it, ideas)

Conflict between levels → STOP, log `--error`.

---

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
