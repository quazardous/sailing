# Versioning Rules

## Semver

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes

## Commands

```bash
rudder versions                      # Show all component versions
rudder versions --component X        # Specific component
```

## Bump workflow

1. Identify change type (major/minor/patch)
2. Update via rudder (not manual edit)
3. Update changelog
4. User commits

## Components

Tracked in components file (use `rudder versions` to query):
```yaml
components:
  api:
    version: "1.2.3"
    path: "src/api"
  cli:
    version: "0.5.0"
    path: "cli/"
```

## Authority

Version bumps require user approval for commit.
