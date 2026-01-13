#!/bin/bash
#
# Build SKILL_INLINE.md and SKILL_WORKTREE.md from templates
#
# Usage: ./skill/build.sh
#

set -e

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

# Warning comment (inserted after frontmatter)
WARNING="<!-- DO NOT EDIT DIRECTLY - see BUILD_SKILL.md -->"

# SKILL_INLINE.md = base with warning after frontmatter
{
  head -5 SKILL.base.md          # frontmatter (lines 1-5: --- to ---)
  echo "$WARNING"
  tail -n +6 SKILL.base.md       # rest of file (line 6+)
} > SKILL_INLINE.md
echo -e "${GREEN}Generated: SKILL_INLINE.md${NC}"

# SKILL_WORKTREE.md = base with warning + modified title + block inserted
{
  head -5 SKILL.base.md          # frontmatter
  echo "$WARNING"
  echo ""
  sed -n '7p' SKILL.base.md | sed 's/^# Sailing$/# Sailing (Worktree Mode)/'
  cat SKILL_WORKTREE.block.md
  tail -n +8 SKILL.base.md
} > SKILL_WORKTREE.md
echo -e "${GREEN}Generated: SKILL_WORKTREE.md${NC}"

echo "Done."
