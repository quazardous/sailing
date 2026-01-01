# Versioning

## Commands

```bash
rudder versions                 # All components
rudder versions --component X   # Specific
```

## Bump Workflow

1. Identify change type (major/minor/patch)
2. `rudder version:bump <component> --<type>`
3. Update changelog
4. User commits

Bumps require user approval.
