## Check Before Starting

```bash
rudder deps:show TNNN
```

## Rules

1. **Never start blocked task**
2. **Dependency Done but artifact missing** → STOP (state corruption)
3. **Never implement dependency code** - it should exist
4. **Never expand scope to unblock**
