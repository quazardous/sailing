# Task State Machine

## Allowed Transitions

```
Not Started → In Progress
In Progress → Blocked
In Progress → Done
In Progress → Aborted
Blocked → In Progress
Blocked → Aborted
```

## Forbidden Transitions

```
Not Started → Done       ← STOP
Not Started → Blocked    ← STOP
Blocked → Done           ← STOP
Done → *                 ← STOP
Aborted → *              ← STOP
Cancelled → *            ← STOP
```

**If forbidden transition is even considered → STOP.**

## Pre-Conditions

| Transition | Requires |
|------------|----------|
| → In Progress | All blockers Done |
| → Done | Deliverables verified by skill |
| → Blocked | Log with --error exists |
| → Aborted | Log with --error + cannot proceed |

## Aborted (Legitimate Exit)

Use Aborted when task **cannot be completed as specified**:
- Requirements are contradictory
- Implementation impossible with given constraints
- Spec missing critical decision

**Aborted is not failure. It's correct behavior.**

```bash
rudder task:log TNNN "ABORT: <reason>" --error
rudder task:update TNNN --status Aborted
```

Then STOP. Do not attempt workarounds.
