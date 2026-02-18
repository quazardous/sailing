#!/bin/bash
#
# Sailing Dev Install - Local installation from sailing repo (symlink mode)
#
# Usage: /path/to/sailing/devinstall.sh [options]
#        Run from target project directory
#
# Creates symlinks to the sailing repo - changes reflected immediately.
# For standalone installation, use install.sh instead.
#

set -e

# =============================================================================
# COLORS & FLAGS
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FORCE=false
FIX=false
DRY_RUN=false
USE_WORKTREE=false
FOLDERS_PROFILE=""
SELF_INSTALL=false

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

# Dry-run aware mkdir
do_mkdir() {
  local dir="$1"
  if [ "$DRY_RUN" = true ]; then
    [ ! -d "$dir" ] && echo "  Would create: $dir"
    return 0
  else
    mkdir -p "$dir"
  fi
}

# Dry-run aware copy (protected = skip if exists unless --force)
do_cp() {
  local src="$1"
  local dest="$2"
  local protected="${3:-false}"

  if [ ! -f "$src" ]; then
    return
  fi

  if [ -f "$dest" ] && [ "$protected" = true ] && [ "$FORCE" != true ]; then
    echo -e "  ${YELLOW}Preserved: $dest${NC}"
    return
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy: $dest"
  else
    cp "$src" "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  fi
}

# Dry-run aware symlink
do_ln() {
  local target="$1"
  local link="$2"

  if [ -L "$link" ] || [ -e "$link" ]; then
    if [ "$FORCE" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  Would replace: $link → $target"
      else
        rm -rf "$link"
        ln -s "$target" "$link"
        echo -e "  ${GREEN}Replaced: $link → $target${NC}"
      fi
    else
      echo -e "  ${YELLOW}Exists: $link${NC}"
    fi
  else
    if [ "$DRY_RUN" = true ]; then
      echo "  Would link: $link → $target"
    else
      ln -s "$target" "$link"
      echo -e "  ${GREEN}Linked: $link → $target${NC}"
    fi
  fi
}

# Dry-run aware file write
do_write() {
  local dest="$1"
  local content="$2"
  local protected="${3:-false}"

  if [ -f "$dest" ] && [ "$protected" = true ] && [ "$FORCE" != true ]; then
    echo -e "  ${YELLOW}Preserved: $dest${NC}"
    return
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  Would write: $dest"
  else
    echo "$content" > "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  fi
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================
while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      echo "Sailing Dev Install - Local installation from sailing repo"
      echo
      echo "Usage: /path/to/sailing/devinstall.sh [options]"
      echo "       Run from target project directory"
      echo
      echo "Creates symlinks to the sailing repo."
      echo "Changes to the repo are immediately reflected."
      echo "For standalone installation, use install.sh instead."
      echo
      echo "Options:"
      echo "  --force              Force overwrite existing files"
      echo "  --fix                Auto-fix configuration issues"
      echo "  --dry-run            Show what would be done without doing it"
      echo "  --self               Install within the sailing repo itself (for development)"
      echo "  --use-worktree       Enable worktree mode (subprocess, isolation)"
      echo "  --folders-profile=X  Use folder profile: project (default), haven, sibling"
      echo "  --help, -h           Show this help"
      echo
      echo "Examples:"
      echo "  cd /path/to/my-project"
      echo "  /path/to/sailing/devinstall.sh"
      echo "  /path/to/sailing/devinstall.sh --force"
      echo "  /path/to/sailing/devinstall.sh --dry-run"
      echo
      exit 0
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --fix)
      FIX=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --use-worktree)
      USE_WORKTREE=true
      shift
      ;;
    --self)
      SELF_INSTALL=true
      shift
      ;;
    --folders-profile=*)
      FOLDERS_PROFILE="${1#*=}"
      shift
      ;;
    --folders-profile)
      FOLDERS_PROFILE="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage"
      exit 1
      ;;
  esac
done

# Validate folders profile
if [ -n "$FOLDERS_PROFILE" ]; then
  case "$FOLDERS_PROFILE" in
    project|haven|sibling)
      ;;
    *)
      echo -e "${RED}Invalid folders profile: $FOLDERS_PROFILE${NC}"
      echo "Valid profiles: project, haven, sibling"
      exit 1
      ;;
  esac
fi

# --use-worktree requires haven or sibling profile (git-clean isolation)
if [ "$USE_WORKTREE" = true ]; then
  if [ -z "$FOLDERS_PROFILE" ]; then
    FOLDERS_PROFILE="haven"
  elif [ "$FOLDERS_PROFILE" != "haven" ] && [ "$FOLDERS_PROFILE" != "sibling" ]; then
    echo -e "${RED}Error: --use-worktree requires --folders-profile=haven or sibling${NC}"
    echo "  Project profile keeps worktrees inside git repo (not allowed)"
    exit 1
  fi
fi

echo -e "${BLUE}Sailing Dev Install${NC} (symlink mode)"
echo "===================="
echo

# 1. Resolve script directory (sailing repo)
SCRIPT_DIR="$(dirname "$(realpath "$0")")"

# 2. Verify we're running from a sailing repo
if [ ! -d "$SCRIPT_DIR/cli" ] || [ ! -d "$SCRIPT_DIR/skill" ]; then
  echo -e "${RED}Error: Script must be in a sailing repo (missing cli/ or skill/)${NC}"
  exit 1
fi

# 3. Verify we're NOT in the sailing repo itself (unless --self)
if [ "$(realpath "$(pwd)")" = "$SCRIPT_DIR" ]; then
  if [ "$SELF_INSTALL" = true ]; then
    echo -e "${YELLOW}Self-install mode: installing within sailing repo${NC}"
    echo
  else
    echo -e "${RED}Error: Run from target project directory, not from sailing repo${NC}"
    echo "Usage: cd /path/to/your/project && $0"
    echo "       Or use --self to install within the sailing repo itself"
    exit 1
  fi
fi

echo -e "Source repo: ${GREEN}$SCRIPT_DIR${NC}"
echo -e "Target project: ${GREEN}$(pwd)${NC}"
echo

# 4. Default paths (may be overridden by profile below)
DEFAULT_SAILING_DIR=".sailing"
SKILL=".claude/skills/sailing"
COMMANDS=".claude/commands/dev"
# Note: templates and prompting use ^/ prefix in paths.yaml (no local copy)

# Compute project hash (same as paths.js)
compute_haven_path() {
  local source
  source=$(git remote get-url origin 2>/dev/null || realpath "$(pwd)")
  local hash=$(echo -n "$source" | sha256sum | cut -c1-12)
  echo "$HOME/.sailing/havens/$hash"
}

# Apply profile-based paths BEFORE reading paths.yaml
# This ensures correct paths even for fresh install
if [ "$FOLDERS_PROFILE" = "haven" ] || [ "$FOLDERS_PROFILE" = "sibling" ]; then
  HAVEN_PATH=$(compute_haven_path)
  ARTEFACTS="$HAVEN_PATH/artefacts"
  MEMORY="$HAVEN_PATH/memory"
  STATE_FILE="$HAVEN_PATH/state.json"
else
  ARTEFACTS=".sailing/artefacts"
  MEMORY=".sailing/memory"
  STATE_FILE=".sailing/state.json"
fi
# components.yaml always stays in .sailing/ (default)
COMPONENTS_FILE=".sailing/components.yaml"

# Resolve ${haven} placeholder in path (also supports legacy %haven%)
resolve_path() {
  local p="$1"
  local haven=$(compute_haven_path)
  # New syntax: ${haven}
  if [[ "$p" == *'${haven}'* ]]; then
    echo "${p//\$\{haven\}/$haven}"
  # Legacy syntax: %haven%
  elif [[ "$p" == *"${haven}"* ]]; then
    echo "${p/\%haven\%/$haven}"
  else
    echo "$p"
  fi
}

# Read custom paths from existing paths.yaml (if any)
CONFIG_FILE="${DEFAULT_SAILING_DIR}/paths.yaml"
if [ -f "$CONFIG_FILE" ]; then
  echo -e "${BLUE}Reading paths from existing paths.yaml...${NC}"

  parse_yaml_path() {
    grep -E "^\s*$1:" "$CONFIG_FILE" 2>/dev/null | sed 's/.*:\s*//' | tr -d '"' | tr -d "'" || echo ""
  }

  CUSTOM_ARTEFACTS=$(parse_yaml_path "artefacts")
  CUSTOM_MEMORY=$(parse_yaml_path "memory")
  CUSTOM_STATE=$(parse_yaml_path "state")
  CUSTOM_COMPONENTS=$(parse_yaml_path "components")
  CUSTOM_SKILL=$(parse_yaml_path "skill")
  CUSTOM_COMMANDS=$(parse_yaml_path "commands")

  # Resolve %haven% placeholders
  [ -n "$CUSTOM_ARTEFACTS" ] && ARTEFACTS=$(resolve_path "$CUSTOM_ARTEFACTS")
  [ -n "$CUSTOM_MEMORY" ] && MEMORY=$(resolve_path "$CUSTOM_MEMORY")
  [ -n "$CUSTOM_STATE" ] && STATE_FILE=$(resolve_path "$CUSTOM_STATE")
  [ -n "$CUSTOM_COMPONENTS" ] && COMPONENTS_FILE=$(resolve_path "$CUSTOM_COMPONENTS")
  [ -n "$CUSTOM_SKILL" ] && SKILL=$(resolve_path "$CUSTOM_SKILL")
  [ -n "$CUSTOM_COMMANDS" ] && COMMANDS=$(resolve_path "$CUSTOM_COMMANDS")
fi

# 5. Create necessary directories
echo -e "${BLUE}Creating directories...${NC}"
do_mkdir "$DEFAULT_SAILING_DIR"
do_mkdir "$ARTEFACTS/prds"
do_mkdir "$MEMORY"
do_mkdir "$(dirname "$SKILL")"
do_mkdir "$(dirname "$COMMANDS")"
do_mkdir bin
echo

# 6. Create bin wrappers and config files
echo -e "${BLUE}Creating bin wrappers...${NC}"

if [ "$DRY_RUN" = true ]; then
  echo "  Would copy: bin/rudder (from rudder.dev)"
  echo "  Would copy: bin/rdrctl (from rdrctl.dev)"
  echo "  Would copy: bin/rdrmcp (from rdrmcp.dev)"
  echo "  Would patch: SAILING_SOURCE in bin wrappers"
  echo "  Would write: SAILING_DIST"
else
  # Copy dev wrapper scripts from sailing repo
  cp "$SCRIPT_DIR/scripts/rudder.dev" bin/rudder
  chmod +x bin/rudder
  echo -e "  ${GREEN}Created: bin/rudder${NC}"

  cp "$SCRIPT_DIR/scripts/rdrctl.dev" bin/rdrctl
  chmod +x bin/rdrctl
  echo -e "  ${GREEN}Created: bin/rdrctl${NC}"

  cp "$SCRIPT_DIR/scripts/rdrmcp.dev" bin/rdrmcp
  chmod +x bin/rdrmcp
  echo -e "  ${GREEN}Created: bin/rdrmcp${NC}"

  # Patch SAILING_SOURCE path directly into wrappers
  sed -i "s|^SAILING_SOURCE=\"\" # patched by devinstall.sh|SAILING_SOURCE=\"$SCRIPT_DIR\" # patched by devinstall.sh|" bin/rudder bin/rdrctl bin/rdrmcp
  echo -e "  ${GREEN}Patched: SAILING_SOURCE in bin wrappers${NC}"

  # SAILING_DIST at project root determines dev vs dist mode
  echo "dev" > "SAILING_DIST"
  echo -e "  ${GREEN}Created: SAILING_DIST (dev mode)${NC}"
fi
echo

# 7. Create symlinks & build skill
echo -e "${BLUE}Building skill files...${NC}"
if [ "$DRY_RUN" = true ]; then
  echo "  Would build skill files"
else
  (cd "$SCRIPT_DIR/skill" && ./build.sh) || {
    echo -e "${RED}Failed to build skill files${NC}"
    exit 1
  }
fi

# Remove if old symlink (legacy devinstall)
if [ -L "$SKILL" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "  Would remove legacy symlink: $SKILL"
  else
    rm "$SKILL"
    echo -e "  ${YELLOW}Removed legacy symlink: $SKILL${NC}"
  fi
fi
do_mkdir "$SKILL"

echo -e "${BLUE}Creating symlinks...${NC}"
do_ln "$SCRIPT_DIR/commands/dev" "$COMMANDS"
echo

# 9. Copy protected files if they don't exist (or --force)
echo -e "${BLUE}Checking protected files...${NC}"

do_mkdir "$(dirname "$COMPONENTS_FILE")"

# Generate paths.yaml from schema if it doesn't exist
PATHS_FILE="$DEFAULT_SAILING_DIR/paths.yaml"
if [ ! -f "$PATHS_FILE" ] || [ "$FORCE" = true ]; then
  # Determine profile based on --use-worktree
  PATHS_PROFILE="${FOLDERS_PROFILE:-}"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would generate: paths.yaml (profile: ${PATHS_PROFILE:-default})"
  else
    if [ -n "$PATHS_PROFILE" ]; then
      bin/rudder paths:init --profile "$PATHS_PROFILE" --force 2>/dev/null
    else
      bin/rudder paths:init --force 2>/dev/null
    fi
    echo -e "  ${GREEN}Generated: paths.yaml${NC}"
  fi
else
  echo -e "  ${GREEN}Exists: paths.yaml${NC}"
  # Migrate old %placeholder% to ${placeholder} syntax
  if grep -q '%haven%\|%sibling%\|${project_hash}' "$PATHS_FILE" 2>/dev/null; then
    if [ "$FIX" = true ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  Would migrate: %placeholder% → \${placeholder}"
      else
        sed -i 's/%haven%/${haven}/g; s/%sibling%/${sibling}/g; s/${project_hash}/${project_hash}/g' "$PATHS_FILE"
        echo -e "  ${GREEN}Migrated: %placeholder% → \${placeholder}${NC}"
      fi
    else
      echo -e "  ${YELLOW}Warning: paths.yaml uses old %placeholder% syntax${NC}"
      echo -e "  ${YELLOW}Run with --fix to migrate to \${placeholder}${NC}"
    fi
  fi
fi

do_cp "$SCRIPT_DIR/disttpl/components.yaml-dist" "$COMPONENTS_FILE" true
do_cp "$SCRIPT_DIR/disttpl/ROADMAP.md-dist" "$ARTEFACTS/ROADMAP.md" true
do_cp "$SCRIPT_DIR/disttpl/POSTIT.md-dist" "$ARTEFACTS/POSTIT.md" true
do_cp "$SCRIPT_DIR/disttpl/MEMORY.md-dist" "$ARTEFACTS/MEMORY.md" true

# Legacy cleanup
if [ -d "$DEFAULT_SAILING_DIR/core" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "  Would remove: $DEFAULT_SAILING_DIR/core/ (legacy)"
  else
    rm -rf "$DEFAULT_SAILING_DIR/core"
    echo -e "  ${GREEN}Removed: $DEFAULT_SAILING_DIR/core/ (legacy)${NC}"
  fi
fi
if [ -f "$DEFAULT_SAILING_DIR/SAILING_SOURCE" ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "  Would remove: $DEFAULT_SAILING_DIR/SAILING_SOURCE (legacy)"
  else
    rm -f "$DEFAULT_SAILING_DIR/SAILING_SOURCE"
    echo -e "  ${GREEN}Removed: $DEFAULT_SAILING_DIR/SAILING_SOURCE (legacy)${NC}"
  fi
fi

echo

# 9. Configure repo paths in paths.yaml (must use ^/ prefix for devinstall)
echo -e "${BLUE}Configuring repo paths...${NC}"

# For devinstall, prompting and templates must point to source repo
configure_repo_path() {
  local key="$1"
  local value="^/$key"
  local current=$(bin/rudder paths:get "$key" --raw 2>/dev/null)

  if [ "$current" = "$value" ]; then
    echo -e "  ${GREEN}OK: $key: $value${NC}"
  elif [ "$FIX" = true ] || [ -z "$current" ] || [ "$current" = ".sailing/$key" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  Would set: $key: $value"
    else
      bin/rudder paths:set "$key" "$value" 2>/dev/null
      echo -e "  ${GREEN}Set: $key: $value${NC}"
    fi
  else
    echo -e "  ${YELLOW}Warning: paths.yaml has custom $key path${NC}"
    echo -e "  ${YELLOW}For devinstall, it MUST be: $key: $value (use --fix)${NC}"
  fi
}

configure_repo_path "prompting"
configure_repo_path "templates"

echo

# 10. npm install in source repo (if needed)
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${BLUE}Installing npm dependencies in source repo...${NC}"
  (cd "$SCRIPT_DIR" && npm install --silent 2>/dev/null) || {
    echo -e "${YELLOW}npm install had warnings (this is usually OK)${NC}"
  }
  echo -e "${GREEN}Dependencies installed${NC}"
  echo
fi

# 11. Configure MCP and Claude permissions
echo -e "${BLUE}Configuring MCP and Claude Code permissions...${NC}"
bin/rudder install:fix || {
  echo -e "${YELLOW}Could not configure automatically.${NC}"
  echo "  Run manually: bin/rudder install:fix"
}
echo

# 12. Verify folder profile paths (paths:init already applied profile defaults)
if [ -n "$FOLDERS_PROFILE" ]; then
  echo -e "${BLUE}Verifying folder profile: $FOLDERS_PROFILE${NC}"

  # paths:init with --profile already set correct defaults
  # Just verify critical paths are correct
  verify_path() {
    local key="$1"
    local expected="$2"
    local current=$(bin/rudder paths:get "$key" --raw 2>/dev/null)

    if [ "$current" = "$expected" ]; then
      echo -e "  ${GREEN}OK: $key${NC}"
    elif [ -z "$current" ]; then
      bin/rudder paths:set "$key" "$expected" 2>/dev/null
      echo -e "  ${GREEN}Set: $key${NC}"
    else
      echo -e "  ${YELLOW}Custom: $key = $current${NC}"
    fi
  }

  case "$FOLDERS_PROFILE" in
    haven)
      verify_path "worktrees" "${haven}/worktrees"
      verify_path "agents" "${haven}/agents"
      ;;
    sibling)
      verify_path "worktrees" "${sibling}/worktrees"
      verify_path "agents" "${sibling}/agents"
      ;;
    project)
      verify_path "worktrees" "${haven}/worktrees/${project_hash}"
      verify_path "agents" "${haven}/agents"
      ;;
  esac
  echo
fi

# 13. Apply worktree mode and create SKILL.md symlink
echo -e "${BLUE}Configuring skill mode...${NC}"

CONFIG_FILE="$DEFAULT_SAILING_DIR/config.yaml"

if [ "$USE_WORKTREE" = true ]; then
  echo -e "  ${GREEN}Mode: worktree (subprocess + isolation)${NC}"

  # Create or update config.yaml
  if [ "$DRY_RUN" = true ]; then
    if [ ! -f "$CONFIG_FILE" ]; then
      echo "  Would create: $CONFIG_FILE"
    else
      echo "  Would update: $CONFIG_FILE"
    fi
  else
    if [ ! -f "$CONFIG_FILE" ]; then
      cat > "$CONFIG_FILE" << 'EOF'
# Sailing configuration
agent:
  # Enable subprocess mode (Claude spawned as subprocess)
  use_subprocess: true
  # Enable worktree isolation for parallel agents
  use_worktrees: true
  # Skip permission prompts (requires use_subprocess)
  risky_mode: true
  # Enable sandbox mode (requires use_subprocess)
  sandbox: true
  timeout: 3600
  merge_strategy: merge
EOF
      echo -e "  ${GREEN}Created: $CONFIG_FILE${NC}"
    else
      # Update or add use_subprocess
      if grep -q "use_subprocess:" "$CONFIG_FILE" 2>/dev/null; then
        sed -i 's/use_subprocess:.*/use_subprocess: true/' "$CONFIG_FILE"
      else
        if grep -q "^agent:" "$CONFIG_FILE" 2>/dev/null; then
          sed -i '/^agent:/a\  use_subprocess: true' "$CONFIG_FILE"
        else
          echo -e "\nagent:\n  use_subprocess: true" >> "$CONFIG_FILE"
        fi
      fi
      # Update or add use_worktrees
      if grep -q "use_worktrees:" "$CONFIG_FILE" 2>/dev/null; then
        sed -i 's/use_worktrees:.*/use_worktrees: true/' "$CONFIG_FILE"
      else
        if grep -q "^agent:" "$CONFIG_FILE" 2>/dev/null; then
          sed -i '/^agent:/a\  use_worktrees: true' "$CONFIG_FILE"
        else
          echo -e "\nagent:\n  use_worktrees: true" >> "$CONFIG_FILE"
        fi
      fi
      echo -e "  ${GREEN}Updated: $CONFIG_FILE${NC}"
    fi
  fi

  # SKILL.md → source repo SKILL_WORKTREE.md
  do_ln "$SCRIPT_DIR/skill/SKILL_WORKTREE.md" "$SKILL/SKILL.md"
  do_ln "$SCRIPT_DIR/skill/CHEATSHEET.md" "$SKILL/CHEATSHEET.md"

  # Create haven convenience symlink for IDE
  echo
  echo -e "${BLUE}Setting up haven symlink...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  Would setup haven symlink"
  else
    HAVEN_PATH=$(bin/rudder paths haven 2>/dev/null | head -1)
    if [ -z "$HAVEN_PATH" ]; then
      echo -e "${YELLOW}Warning: Could not determine haven path${NC}"
    else
      HAVEN_PATH="${HAVEN_PATH/#\~/$HOME}"
      do_mkdir "$HAVEN_PATH/artefacts/prds"
      do_mkdir "$HAVEN_PATH/memory"
      do_ln "$HAVEN_PATH" "$DEFAULT_SAILING_DIR/haven"

      # Add to .gitignore
      GITIGNORE=".gitignore"
      [ ! -f "$GITIGNORE" ] && touch "$GITIGNORE"
      if ! grep -qxF ".sailing/haven" "$GITIGNORE" 2>/dev/null; then
        echo ".sailing/haven" >> "$GITIGNORE"
        echo -e "  ${GREEN}Added to .gitignore: .sailing/haven${NC}"
      fi
    fi
  fi
else
  echo -e "  ${GREEN}Mode: inline (default)${NC}"
  do_ln "$SCRIPT_DIR/skill/SKILL_INLINE.md" "$SKILL/SKILL.md"
  do_ln "$SCRIPT_DIR/skill/CHEATSHEET.md" "$SKILL/CHEATSHEET.md"
fi
echo

# Done
echo -e "${GREEN}Dev install complete!${NC}"
echo
echo "Usage:"
echo "  bin/rudder --help"
echo
echo "Changes to $SCRIPT_DIR will be immediately reflected."
echo

# Show sandbox setup steps for worktree mode
if [ "$USE_WORKTREE" = true ]; then
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}Worktree mode enabled - Setup required:${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo

  # Check if git repo exists
  STEP=1
  if [ ! -d ".git" ]; then
    echo "${STEP}. Initialize git repository (required for worktrees):"
    echo "   git init"
    echo "   git add ."
    echo "   git commit -m \"Initial commit\""
    echo
    STEP=$((STEP + 1))
  fi

  echo "${STEP}. Install sandbox-runtime:"
  echo "   npm install -g @anthropic-ai/sandbox-runtime"
  echo
  STEP=$((STEP + 1))

  echo "${STEP}. Install dependencies:"
  if [[ "$OSTYPE" == "linux"* ]]; then
    if command -v dnf &> /dev/null; then
      echo "   sudo dnf install ripgrep bubblewrap socat"
    else
      echo "   sudo apt install ripgrep bubblewrap socat"
    fi
  else
    echo "   brew install ripgrep"
  fi
  echo
  STEP=$((STEP + 1))

  echo "${STEP}. Initialize sandbox config:"
  echo "   bin/rudder sandbox:init"
  echo
  STEP=$((STEP + 1))

  echo "${STEP}. Verify setup:"
  echo "   bin/rudder sandbox:check"
  echo
  STEP=$((STEP + 1))

  echo "${STEP}. Before spawning agents, start the MCP server:"
  echo "   bin/rdrctl start agents"
  echo "   (keep it running in a terminal)"
  echo
  echo "Documentation: docs/sandbox.md"
  echo
fi
