# Building Skill Files

The skill files `SKILL_INLINE.md` and `SKILL_WORKTREE.md` are **generated** — do not edit them directly.

## Template Engine

Source files use [Nunjucks](https://mozilla.github.io/nunjucks/) templates (`.njk`). The `mode` variable (`inline` or `worktree`) controls mode-specific content via `{% if mode == 'worktree' %}...{% endif %}`.

The `rudder template:render` command renders templates with config-aware defaults:
- Reads `agent.use_worktrees` from project config to set `mode` automatically
- `--var mode=xxx` overrides the config default

## Source Files

| File | Purpose |
|------|---------|
| `SKILL.md.njk` | Main skill template (edit this) |
| `build.sh` | Generates the final skill files using `rudder template:render` |

## How to Edit

1. **Edit** `SKILL.md.njk` (shared + mode-conditional content in one file)
2. **Regenerate**: Run `npm run build:skill` (requires `npm run build` first)

## Generated Files

| File | Content |
|------|---------|
| `SKILL_INLINE.md` | Rendered with `mode=inline` |
| `SKILL_WORKTREE.md` | Rendered with `mode=worktree` |

## Install Flow

The install script (`install.sh`) creates `SKILL.md` in `.claude/skills/sailing/` as a copy of either:
- `SKILL_INLINE.md` (default mode)
- `SKILL_WORKTREE.md` (worktree mode with `--use-worktree`)

---

# Command Variants

Commands can also have mode-specific variants. The same `build.sh` generates them.

## How It Works

1. Create `commands/dev/<name>.md.njk` with mode conditionals:
   ```nunjucks
   {#
   variables:
     mode: inline|worktree  # Execution mode
   #}
   {% if mode == 'worktree' %}
   Content only for worktree/subprocess mode
   {% endif %}

   {% if mode == 'inline' %}
   Content only for inline mode
   {% endif %}
   ```

2. `build.sh` generates:
   - `<name>.inline.md` — rendered with `mode=inline`
   - `<name>.worktree.md` — rendered with `mode=worktree`

3. Install scripts pick the right variant based on mode and install it as `<name>.md`.

## Source Files

| File | Purpose |
|------|---------|
| `commands/dev/*.md.njk` | Command templates with mode conditionals (edit these) |
| `commands/dev/*.inline.md` | Generated inline variant (do not edit) |
| `commands/dev/*.worktree.md` | Generated worktree variant (do not edit) |

## Current Commands with Variants

- `tasks-batch` — batch task spawning (subprocess vs inline agent spawning)

## CLI Usage

```bash
# Render a template with config defaults
rudder template:render skill/SKILL.md.njk

# Render with explicit mode
rudder template:render skill/SKILL.md.njk --var mode=worktree

# Write to file
rudder template:render skill/SKILL.md.njk --var mode=inline -o skill/SKILL_INLINE.md

# Show template variables
rudder template:info skill/SKILL.md.njk
```
