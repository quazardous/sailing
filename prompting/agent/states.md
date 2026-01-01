# Task State Machine

## Allowed Transitions

```
Not Started → In Progress
In Progress → Blocked
In Progress → Done
Blocked → In Progress
```

## Forbidden Transitions

```
Not Started → Done       ← STOP
Not Started → Blocked    ← STOP
Blocked → Done           ← STOP
Done → *                 ← STOP
Cancelled → *            ← STOP
```

**If forbidden transition is even considered → STOP.**

## Pre-Conditions

| Transition | Requires |
|------------|----------|
| → In Progress | All blockers Done |
| → Done | Deliverables verified by skill |
| → Blocked | Log with --error exists |
