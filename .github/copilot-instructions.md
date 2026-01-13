# Sailing Framework - Copilot Instructions

This project uses the **Sailing** framework for PRD/Epic/Task governance.

## CLI: `bin/rudder`

```bash
bin/rudder --help              # All commands
bin/rudder <group> -h          # Group help (prd, epic, task, story, memory, deps)
```

### Common Commands

```bash
# List/Show
bin/rudder prd:list
bin/rudder epic:list PRD-001
bin/rudder task:list --status wip
bin/rudder task:show T001 --raw      # View full content

# Create
bin/rudder prd:create "Title"
bin/rudder epic:create PRD-001 "Title"
bin/rudder task:create E001 "Title"

# Update
bin/rudder task:update T001 --status "In Progress"
bin/rudder task:edit T001 --section Deliverables -c "New content"

# Dependencies
bin/rudder deps:show T001            # Check blockers
bin/rudder deps:add T002 T001        # T002 blocked by T001

# Memory
bin/rudder memory:show E001          # Epic memory
bin/rudder task:log T001 "Note"      # Add log entry
```

## Project Structure

```
.sailing/
├── artefacts/prds/PRD-001/    # PRD folders
│   ├── prd.md                 # PRD document
│   ├── epics/E001-*.md        # Epic files
│   └── tasks/T001-*.md        # Task files
├── memory/                    # Memory files (E001.md, T001.log)
├── templates/                 # Artefact templates
└── config.yaml               # Project config

bin/rudder                     # CLI wrapper
```

## Key Rules

1. **Access artefacts via CLI**, not file paths
   - Use `task:show T001 --raw` for content
   - Avoid direct file manipulation

2. **Status flow**: Draft → Ready → In Progress → Done

3. **Dependencies**: Tasks can be blocked by other tasks
   - Check with `deps:show` before starting
   - Mark blockers with `deps:add`

4. **Memory**: Epic-level knowledge accumulation
   - Tips/gotchas go in memory, not task files
   - Use `task:log` for task-specific notes

## For AI Agents

When working on tasks:
```bash
bin/rudder context:load T001 --role agent   # Get full context
bin/rudder task:show T001 --raw             # Task details
bin/rudder memory:show E001                 # Epic memory
bin/rudder task:log T001 "What I learned"   # Log insights
```
