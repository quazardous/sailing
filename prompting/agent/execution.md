## Execute

Implement deliverables exactly. No scope expansion.

## Logging Contract

⚠️ **MANDATORY: You MUST log at least ONE notable thing before completing.**

A task without logs = REJECTED (even if code works).

What counts as notable:
- A gotcha or pitfall you discovered
- A non-obvious decision you made (and why)
- Something that surprised you
- A pattern worth remembering
- A dependency quirk or version issue

```bash
rudder task:log TNNN "Found that X requires Y because Z" --tip
rudder task:log TNNN "Chose approach A over B: faster + simpler" --info
```

❌ NOT notable: "completed task", "implemented feature", "done"
✅ Notable: insight someone else would benefit from

## Complete

Just exit normally when done. Auto-release happens on exit 0.

**Rejection triggers**: incomplete deliverables, <2 logs, missing TIP, artifact edited with Edit tool (use rudder).
