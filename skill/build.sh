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

# SKILL_INLINE.md = base as-is
cp SKILL.base.md SKILL_INLINE.md
echo -e "${GREEN}Generated: SKILL_INLINE.md${NC}"

# SKILL_WORKTREE.md = base with modified title + block inserted
{
  # Read base file
  head -7 SKILL.base.md | sed 's/^# Sailing$/# Sailing (Worktree Mode)/'
  cat SKILL_WORKTREE.block.md
  tail -n +8 SKILL.base.md
} > SKILL_WORKTREE.md
echo -e "${GREEN}Generated: SKILL_WORKTREE.md${NC}"

echo "Done."
