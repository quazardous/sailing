# Building Skill Files

The skill files `SKILL_INLINE.md` and `SKILL_WORKTREE.md` are **generated** — do not edit them directly.

## Source Files

| File | Purpose |
|------|---------|
| `SKILL.base.md` | Main skill template (edit this) |
| `SKILL_WORKTREE.block.md` | Worktree-specific block (inserted after header) |
| `build.sh` | Generates the final skill files |

## How to Edit

1. **For common rules**: Edit `SKILL.base.md`
2. **For worktree-specific rules**: Edit `SKILL_WORKTREE.block.md`
3. **Regenerate**: Run `./build.sh` (or `npm run build:skill` from root)

## Generated Files

| File | Content |
|------|---------|
| `SKILL_INLINE.md` | Copy of `SKILL.base.md` |
| `SKILL_WORKTREE.md` | `SKILL.base.md` + worktree block |

## Install Flow

The install script (`install.sh`) creates `SKILL.md` in `.claude/skills/sailing/` as a copy of either:
- `SKILL_INLINE.md` (default mode)
- `SKILL_WORKTREE.md` (worktree mode with `--use-worktree`)
