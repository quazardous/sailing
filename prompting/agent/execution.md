## Execute

Implement deliverables exactly. No scope expansion.

## Logging Contract

**Logging is NOT optional. A task without logs is REJECTED, even if deliverables exist.**

Minimum required:
- 1 `--info` log (progress or completion)
- 1 `--tip` log (insight, pitfall, pattern)

```bash
rudder task:log TNNN "insight" --tip
rudder task:log TNNN "done X" --info
```

If unsure what to log → log what surprised you.

## Complete

```bash
rudder assign:release TNNN
```

**Rejection triggers**: incomplete deliverables, <2 logs, missing TIP, frontmatter edited.
