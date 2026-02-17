#!/bin/bash
# Publish dist files to dist branch
# Uses a temporary worktree - never touches your working directory
#
# Usage: ./publish-dist.sh [--push]

set -e

DIST_BRANCH="dist"
MAIN_BRANCH="main"
DO_PUSH=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --push) DO_PUSH=true; shift ;;
    *) shift ;;
  esac
done

# Get last commit info from main
LAST_MSG=$(git log -1 --format="%s" "$MAIN_BRANCH" 2>/dev/null || git log -1 --format="%s")
LAST_SHA=$(git log -1 --format="%h" "$MAIN_BRANCH" 2>/dev/null || git log -1 --format="%h")

echo "Publishing dist (ref: $LAST_SHA)..."

# Create temp worktree for dist branch
WORK_DIR=$(mktemp -d)
trap "git worktree remove --force '$WORK_DIR' 2>/dev/null; rm -rf '$WORK_DIR'" EXIT

# Create dist branch if it doesn't exist (orphan)
if ! git show-ref --verify --quiet "refs/heads/$DIST_BRANCH"; then
  echo "Creating orphan dist branch..."
  git worktree add --detach "$WORK_DIR"
  (
    cd "$WORK_DIR"
    git checkout --orphan "$DIST_BRANCH"
    git rm -rf . 2>/dev/null || true
    git commit --allow-empty -m "chore(dist): initial orphan branch"
  )
else
  git worktree add "$WORK_DIR" "$DIST_BRANCH"
fi

# Clean worktree
rm -rf "$WORK_DIR"/*

# === Copy essential files ===

# Compiled CLI
mkdir -p "$WORK_DIR/dist"
cp -r dist/cli "$WORK_DIR/dist/"

# Dashboard UI (Vue.js built files)
if [ -d "dashboard-ui/dist" ]; then
  mkdir -p "$WORK_DIR/dashboard-ui"
  cp -r dashboard-ui/dist "$WORK_DIR/dashboard-ui/"
  echo "  ✓ Dashboard UI included"
fi

# Distribution templates
cp disttpl/*.yaml-dist disttpl/*.md-dist "$WORK_DIR/dist/" 2>/dev/null || true

# CLI wrappers (from scripts/*.dist)
mkdir -p "$WORK_DIR/scripts"
cp scripts/rudder.dist scripts/rdrctl.dist scripts/rdrmcp.dist "$WORK_DIR/scripts/"

# Prompting fragments
cp -r prompting "$WORK_DIR/"

# Templates
cp -r templates "$WORK_DIR/" 2>/dev/null || true

# Skill
mkdir -p "$WORK_DIR/skill"
cp skill/build.sh "$WORK_DIR/skill/"
cp skill/*.md "$WORK_DIR/skill/" 2>/dev/null || true

# Commands
cp -r commands "$WORK_DIR/" 2>/dev/null || true

# Package files
mkdir -p "$WORK_DIR/cli"
cp cli/package.json "$WORK_DIR/cli/"

# === Commit ===

cd "$WORK_DIR"
git add -A
if git diff --cached --quiet; then
  echo "No changes to dist"
else
  git commit -q -m "chore(dist): $LAST_MSG"
  echo "✓ Committed: chore(dist): $LAST_MSG"
fi

echo "✓ dist branch updated"

if [ "$DO_PUSH" = true ]; then
  cd - >/dev/null
  git push origin "$DIST_BRANCH"
  echo "✓ Pushed to origin/$DIST_BRANCH"
else
  echo "  (use 'git push origin dist' to publish)"
fi
