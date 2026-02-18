#!/bin/bash
#
# Build SKILL_INLINE.md, SKILL_WORKTREE.md, and command variants from Nunjucks templates
#
# Usage: ./skill/build.sh
#
# Requires: npm run build (compiled rudder CLI)
# See BUILD_SKILL.md for details.
#

set -e

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUDDER="node $REPO_ROOT/dist/cli/rudder.js"
CMD_DIR="$REPO_ROOT/commands/dev"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

# Skills
$RUDDER template:render "$SCRIPT_DIR/SKILL.md.njk" --var mode=inline -o "$SCRIPT_DIR/SKILL_INLINE.md"
echo -e "${GREEN}Generated: SKILL_INLINE.md${NC}"

$RUDDER template:render "$SCRIPT_DIR/SKILL.md.njk" --var mode=worktree -o "$SCRIPT_DIR/SKILL_WORKTREE.md"
echo -e "${GREEN}Generated: SKILL_WORKTREE.md${NC}"

# Command variants from .njk templates
FOUND_VARIANTS=false

for njk in "$CMD_DIR"/*.md.njk; do
  [ -f "$njk" ] || continue
  FOUND_VARIANTS=true
  name=$(basename "$njk" .md.njk)

  $RUDDER template:render "$njk" --var mode=inline -o "$CMD_DIR/${name}.inline.md"
  echo -e "${GREEN}Generated: commands/dev/${name}.inline.md${NC}"

  $RUDDER template:render "$njk" --var mode=worktree -o "$CMD_DIR/${name}.worktree.md"
  echo -e "${GREEN}Generated: commands/dev/${name}.worktree.md${NC}"
done

if [ "$FOUND_VARIANTS" = false ]; then
  echo "No command .njk templates found, skipping variant generation."
fi

echo "Done."
