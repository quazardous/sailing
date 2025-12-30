# MX: Milestone Name

> Copy to `prds/PRD-NNN/milestones/mX-name/CRITERIA.md`

## Status

**Current**: Pending
**Last validated**: -
**Validated by**: -

## Acceptance Criteria

- [ ] Criterion 1 description
- [ ] Criterion 2 description
- [ ] Criterion 3 description

## Validation Method

### Script Validation
```bash
./validate.sh
```

### Manual Steps (if no script)
1. Step 1
2. Step 2
3. Verify result

### Browser Validation (if needed)
```javascript
// Claude in Chrome javascript_tool
fetch('https://api.example.local/health')
  .then(r => r.json())
  .then(d => console.log('[TEST]', d.status === 'ok' ? 'PASS' : 'FAIL'));
```

## Dependencies

- Requires: (list prerequisites)
- Fixtures: (list fixture files if any)

## Drift Report

**Status**: N/A (no validation run yet)

## Results Log

<!-- Add entries after each validation run -->
