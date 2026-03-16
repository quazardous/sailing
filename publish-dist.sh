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

# Read version from root package.json (source of truth)
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
TAG="v${VERSION}"

echo "Publishing dist (ref: $LAST_SHA, version: $VERSION)..."

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

# README for dist branch
cat > "$WORK_DIR/README.md" << 'DISTREADME'
# Sailing — Distribution Branch

This branch contains pre-compiled files for the [Sailing](https://github.com/quazardous/sailing) project governance framework.

**Do not edit files here** — they are auto-generated from `main` by `publish-dist.sh`.

## Install

```bash
cd /path/to/your-project
curl -sSL https://raw.githubusercontent.com/quazardous/sailing/dist/install.sh | bash
```

See the [main branch](https://github.com/quazardous/sailing/tree/main) for documentation and source code.
DISTREADME

# Install script (so users can curl from dist branch)
cp install.sh "$WORK_DIR/"

# Compiled CLI
mkdir -p "$WORK_DIR/dist"
cp -r dist/cli "$WORK_DIR/dist/"

# Dashboard UI (Vue.js built files)
if [ -d "dashboard-ui/dist" ]; then
  mkdir -p "$WORK_DIR/dashboard-ui"
  cp -r dashboard-ui/dist "$WORK_DIR/dashboard-ui/"
  echo "  ✓ Dashboard UI included"
fi

# Distribution templates (install.sh expects $SRC/disttpl/)
mkdir -p "$WORK_DIR/disttpl"
cp disttpl/*.yaml-dist disttpl/*.md-dist "$WORK_DIR/disttpl/" 2>/dev/null || true

# CLI wrappers (from scripts/*.dist)
mkdir -p "$WORK_DIR/scripts"
cp scripts/rudder.dist scripts/rdrctl.dist scripts/rdrmcp.dist "$WORK_DIR/scripts/"

# Prompting fragments
cp -r prompting "$WORK_DIR/"

# Templates
cp -r templates "$WORK_DIR/" 2>/dev/null || true

# Skill (only generated .md files, no build.sh or .njk sources)
mkdir -p "$WORK_DIR/skill"
cp skill/*.md "$WORK_DIR/skill/" 2>/dev/null || true

# Commands (exclude .base.md and .njk templates — only ship generated variants)
mkdir -p "$WORK_DIR/commands/dev"
for f in commands/dev/*.md; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    *.base.md) continue ;;
    *) cp "$f" "$WORK_DIR/$f" ;;
  esac
done

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

  # Tag the main branch with version if not already tagged
  if [ -n "$VERSION" ]; then
    if git rev-parse "$TAG" >/dev/null 2>&1; then
      echo "  Tag $TAG already exists, skipping"
    else
      git tag -a "$TAG" "$MAIN_BRANCH" -m "Release $TAG"
      git push origin "$TAG"
      echo "✓ Tagged: $TAG"
    fi
  fi
else
  echo "  (use 'git push origin dist' to publish)"
fi
