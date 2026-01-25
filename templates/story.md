---
id: SNNN
title: Story Title
parent: PRD-NNN
parent_story: null
type: user
# MCP: artefact_update { "id": "<id>", "status": "...", "set": {...} }
---

<!--
MCP multi-section edit (preferred):
artefact_edit { "id": "<id>", "content": "## Story\n**As** user **I want** feature **So that** benefit\n\n## Acceptance Criteria\n- [ ] Given X, when Y, then Z" }
-->

## Story

<!-- REQUIRED: Use ONE format below based on type field, delete the others -->

### User Story (type: user)
**As** [role/persona]
**I want** [feature/capability]
**So that** [benefit/value]

### Technical Story (type: technical)
**Subject**: [page/service/component]
**Must**: [what it needs to do]
**Benefit**: [performance/maintainability/reliability]

### API Story (type: api)
**Endpoint**: [HTTP method + path]
**Consumer**: [who calls this API]
**Contract**: [key request/response expectations]

## Acceptance Criteria

<!-- REQUIRED: Given/When/Then format -->
- [ ] Given [context], when [action], then [outcome]

## Context

<!-- OPTIONAL: Delete fields not applicable -->
**Where**: [Functional area - page, module, service]
**Why**: [Problem being solved]
**Constraints**: [Limits, dependencies, edge cases]
**See also**: [Links to docs, specs]
