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

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FORCE=false
FIX=false
USE_WORKTREE=false
FOLDERS_PROFILE=""

# Parse arguments
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
      echo "  --use-worktree       Enable worktree mode (subprocess, isolation)"
      echo "  --folders-profile=X  Use folder profile: project (default), haven, sibling"
      echo "  --help, -h           Show this help"
      echo
      echo "Examples:"
      echo "  cd /path/to/my-project"
      echo "  /path/to/sailing/devinstall.sh"
      echo "  /path/to/sailing/devinstall.sh --force"
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
    --use-worktree)
      USE_WORKTREE=true
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

# 3. Verify we're NOT in the sailing repo itself
if [ "$(realpath "$(pwd)")" = "$SCRIPT_DIR" ]; then
  echo -e "${RED}Error: Run from target project directory, not from sailing repo${NC}"
  echo "Usage: cd /path/to/your/project && $0"
  exit 1
fi

echo -e "Source repo: ${GREEN}$SCRIPT_DIR${NC}"
echo -e "Target project: ${GREEN}$(pwd)${NC}"
echo

# 4. Default paths
DEFAULT_SAILING_DIR=".sailing"
ARTEFACTS=".sailing/artefacts"
MEMORY=".sailing/memory"
STATE_FILE=".sailing/state.json"
COMPONENTS_FILE=".sailing/components.yaml"
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

# Resolve %haven% placeholder in path
resolve_path() {
  local p="$1"
  if [[ "$p" == *"%haven%"* ]]; then
    local haven=$(compute_haven_path)
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
mkdir -p "$DEFAULT_SAILING_DIR"
mkdir -p "$ARTEFACTS/prds"
mkdir -p "$MEMORY"
mkdir -p "$(dirname "$SKILL")"
mkdir -p "$(dirname "$COMMANDS")"
mkdir -p bin

echo -e "${GREEN}Directories created${NC}"
echo

# 6. Create bin/rudder wrapper
echo -e "${BLUE}Creating bin/rudder...${NC}"

cat > bin/rudder << EOF
#!/bin/bash
# Rudder CLI wrapper - dev mode pointing to sailing repo
# Auto-generated by devinstall.sh
SAILING_PROJECT="\$(realpath "\$(dirname "\$0")/..")" exec node "$SCRIPT_DIR/cli/rudder.js" "\$@"
EOF

chmod +x bin/rudder
echo -e "${GREEN}Created: bin/rudder (→ source repo)${NC}"
echo

# 7. Create symlinks
echo -e "${BLUE}Creating symlinks...${NC}"

create_symlink() {
  local src="$1"
  local dest="$2"

  # Check if destination exists and is not a symlink
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    if [ "$FORCE" = "true" ]; then
      rm -rf "$dest"
      echo -e "  ${YELLOW}Removed existing: $dest${NC}"
    else
      echo -e "  ${YELLOW}Skipped (exists): $dest - use --force to overwrite${NC}"
      return
    fi
  fi

  ln -sfn "$src" "$dest"
  echo -e "  ${GREEN}Linked: $dest → $src${NC}"
}

# Skill (generate files, symlink created in section 13 based on mode)
echo -e "${BLUE}Building skill files...${NC}"
(cd "$SCRIPT_DIR/skill" && ./build.sh) || {
  echo -e "${RED}Failed to build skill files${NC}"
  exit 1
}
# Remove if old symlink (legacy devinstall)
if [ -L "$SKILL" ]; then
  rm "$SKILL"
  echo -e "  ${YELLOW}Removed legacy symlink: $SKILL${NC}"
fi
mkdir -p "$SKILL"

# Commands
create_symlink "$SCRIPT_DIR/commands/dev" "$COMMANDS"

# Templates: handled via ^/templates in paths.yaml (like prompting)

echo

# 8. Copy protected files if they don't exist (or --force)
echo -e "${BLUE}Checking protected files...${NC}"

copy_protected() {
  local src="$1"
  local dest="$2"

  if [ ! -f "$dest" ] || [ "$FORCE" = true ]; then
    cp "$src" "$dest"
    echo -e "  ${GREEN}Created: $dest${NC}"
  else
    echo -e "  ${YELLOW}Preserved: $dest${NC}"
  fi
}

# paths.yaml always goes in .sailing/ (config.yaml created only if needed)
copy_protected "$SCRIPT_DIR/dist/paths.yaml-dist" "$DEFAULT_SAILING_DIR/paths.yaml"

# These respect paths.yaml configuration
mkdir -p "$(dirname "$COMPONENTS_FILE")"
copy_protected "$SCRIPT_DIR/dist/components.yaml-dist" "$COMPONENTS_FILE"
copy_protected "$SCRIPT_DIR/dist/ROADMAP.md-dist" "$ARTEFACTS/ROADMAP.md"
copy_protected "$SCRIPT_DIR/dist/POSTIT.md-dist" "$ARTEFACTS/POSTIT.md"

# =============================================================================
# LEGACY HANDLING - Remove old core/ directory (replaced by prompting/)
# =============================================================================
if [ -d "$DEFAULT_SAILING_DIR/core" ]; then
  echo -e "${BLUE}Cleaning up legacy files...${NC}"
  rm -rf "$DEFAULT_SAILING_DIR/core"
  echo -e "  ${GREEN}Removed: $DEFAULT_SAILING_DIR/core/ (replaced by prompting/)${NC}"
fi

echo

# 9. Configure repo paths in paths.yaml (must use ^/ prefix for devinstall)
echo -e "${BLUE}Configuring repo paths...${NC}"

configure_repo_path() {
  local key="$1"
  local value="^/$key"
  local file="$DEFAULT_SAILING_DIR/paths.yaml"

  # Check non-comment lines only
  local current=$(grep -E "^[[:space:]]*$key:" "$file" 2>/dev/null | grep -v "^[[:space:]]*#" | head -1)

  if [ -z "$current" ]; then
    echo "  $key: $value" >> "$file"
    echo -e "  ${GREEN}Added: $key: $value${NC}"
  elif ! echo "$current" | grep -q "\^/$key"; then
    if [ "$FIX" = true ]; then
      sed -i "s|^[[:space:]]*$key:.*|  $key: $value|" "$file"
      echo -e "  ${GREEN}Fixed: $key: $value${NC}"
    else
      echo -e "  ${YELLOW}Warning: paths.yaml has custom $key path${NC}"
      echo -e "  ${YELLOW}For devinstall, it MUST be: $key: $value (use --fix)${NC}"
    fi
  else
    echo -e "  ${GREEN}OK: $key: $value${NC}"
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

# 11. Configure Claude permissions
echo -e "${BLUE}Configuring Claude Code permissions...${NC}"
bin/rudder permissions:fix || {
  echo -e "${YELLOW}Could not configure permissions automatically.${NC}"
  echo "  Run manually: bin/rudder permissions:fix"
}
echo

# 12. Apply folder profile (optional)
if [ -n "$FOLDERS_PROFILE" ]; then
  echo -e "${BLUE}Applying folder profile: $FOLDERS_PROFILE${NC}"

  PATHS_FILE="$DEFAULT_SAILING_DIR/paths.yaml"

  # For devinstall, we always preserve ^/ prefixes for prompting/templates
  # Only configure worktrees/agents paths based on profile

  case "$FOLDERS_PROFILE" in
    project)
      # Append worktree paths if not present
      if ! grep -q "^worktrees:" "$PATHS_FILE" 2>/dev/null; then
        echo 'worktrees: "%haven%/worktrees/%project_hash%"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: worktrees path${NC}"
      fi
      if ! grep -q "^agents:" "$PATHS_FILE" 2>/dev/null; then
        echo 'agents: "%haven%/agents"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: agents path${NC}"
      fi
      ;;
    haven)
      # Helper to check/fix haven paths
      check_haven_path() {
        local key="$1"
        local expected="%haven%/$2"
        local current=$(grep -E "^\s*$key:" "$PATHS_FILE" 2>/dev/null | sed 's/.*:\s*//' | tr -d '"' | tr -d "'")

        if [ -z "$current" ]; then
          echo "  $key: \"$expected\"" >> "$PATHS_FILE"
          echo -e "  ${GREEN}Added: $key${NC}"
        elif [[ "$current" != *"%haven%"* ]]; then
          if [ "$FIX" = true ]; then
            sed -i "s|$key:.*|$key: \"$expected\"|" "$PATHS_FILE"
            echo -e "  ${GREEN}Fixed: $key → $expected${NC}"
          else
            echo -e "  ${YELLOW}Warning: $key should use %haven% (use --fix)${NC}"
          fi
        else
          echo -e "  ${GREEN}OK: $key${NC}"
        fi
      }

      check_haven_path "artefacts" "artefacts"
      check_haven_path "memory" "memory"
      check_haven_path "state" "state.json"
      check_haven_path "components" "components.yaml"

      # Worktrees and agents
      if ! grep -q "^worktrees:" "$PATHS_FILE" 2>/dev/null; then
        echo 'worktrees: "%haven%/worktrees"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: worktrees path${NC}"
      fi
      if ! grep -q "^agents:" "$PATHS_FILE" 2>/dev/null; then
        echo 'agents: "%haven%/agents"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: agents path${NC}"
      fi
      ;;
    sibling)
      if ! grep -q "^worktrees:" "$PATHS_FILE" 2>/dev/null; then
        echo 'worktrees: "%sibling%/worktrees"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: worktrees path${NC}"
      fi
      if ! grep -q "^agents:" "$PATHS_FILE" 2>/dev/null; then
        echo 'agents: "%sibling%/agents"' >> "$PATHS_FILE"
        echo -e "  ${GREEN}Added: agents path${NC}"
      fi
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

  # SKILL.md → source repo SKILL_WORKTREE.md
  ln -sfn "$SCRIPT_DIR/skill/SKILL_WORKTREE.md" "$SKILL/SKILL.md"
  echo -e "  ${GREEN}Linked: SKILL.md → SKILL_WORKTREE.md${NC}"

  # Create haven convenience symlink for IDE
  echo
  echo -e "${BLUE}Setting up haven symlink...${NC}"

  HAVEN_PATH=$(bin/rudder paths haven 2>/dev/null | head -1)
  if [ -z "$HAVEN_PATH" ]; then
    echo -e "${YELLOW}Warning: Could not determine haven path${NC}"
  else
    # Expand ~ to $HOME
    HAVEN_PATH="${HAVEN_PATH/#\~/$HOME}"

    # Create haven directories
    mkdir -p "$HAVEN_PATH/artefacts/prds"
    mkdir -p "$HAVEN_PATH/memory"

    # Create convenience symlink
    ln -sfn "$HAVEN_PATH" "$DEFAULT_SAILING_DIR/haven"
    echo -e "  ${GREEN}Linked: $DEFAULT_SAILING_DIR/haven → $HAVEN_PATH${NC}"

    # Add to .gitignore
    GITIGNORE=".gitignore"
    [ ! -f "$GITIGNORE" ] && touch "$GITIGNORE"
    if ! grep -qxF ".sailing/haven" "$GITIGNORE" 2>/dev/null; then
      echo ".sailing/haven" >> "$GITIGNORE"
      echo -e "  ${GREEN}Added to .gitignore: .sailing/haven${NC}"
    fi
  fi
else
  echo -e "  ${GREEN}Mode: inline (default)${NC}"

  # SKILL.md → source repo SKILL_INLINE.md
  ln -sfn "$SCRIPT_DIR/skill/SKILL_INLINE.md" "$SKILL/SKILL.md"
  echo -e "  ${GREEN}Linked: SKILL.md → SKILL_INLINE.md${NC}"
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
