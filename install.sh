#!/bin/bash
#
# Sailing - Project Governance Skill Installer
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/quazardous/sailing/main/install.sh | bash
#   curl -sSL .../install.sh | bash -s -- --global
#
# For local development, use devinstall.sh instead.
#
# Options:
#   --global              Install rudder CLI globally via npm
#   --force               Force overwrite protected files
#   --dry-run             Show what would be done without doing it
#   --use-worktree        Enable worktree mode (subprocess, isolation)
#   --folders-profile=X   Use folder profile: project (default), haven, sibling
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Repo info
REPO_URL="https://github.com/quazardous/sailing"
REPO_RAW="https://raw.githubusercontent.com/quazardous/sailing/main"

# Default paths
DEFAULT_SAILING_DIR=".sailing"
DEFAULT_ARTEFACTS=".sailing/artefacts"
DEFAULT_MEMORY=".sailing/memory"
DEFAULT_TEMPLATES=".sailing/templates"
DEFAULT_PROMPTING=".sailing/prompting"
DEFAULT_RUDDER=".sailing/rudder"
DEFAULT_SKILL=".claude/skills/sailing"
DEFAULT_COMMANDS=".claude/commands/dev"

# Parse arguments
GLOBAL=false
FORCE=false
FIX=false
DRY_RUN=false
USE_WORKTREE=false
FOLDERS_PROFILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --global)
      GLOBAL=true
      shift
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

# --use-worktree defaults to haven profile (avoid git pollution)
if [ "$USE_WORKTREE" = true ] && [ -z "$FOLDERS_PROFILE" ]; then
  FOLDERS_PROFILE="haven"
fi

echo -e "${BLUE}Sailing Installer${NC}"
echo "=================="

# Detect upgrade vs fresh install (check for CLI, not just .sailing which may contain only paths.yaml)
if [ -f "bin/rudder" ] || [ -d ".sailing/rudder" ]; then
  UPGRADE=true
  echo -e "${YELLOW}Existing installation detected - upgrading${NC}"
else
  UPGRADE=false
  echo "Fresh installation"
fi
echo

# =============================================================================
# 1. CHECK DEPENDENCIES
# =============================================================================
echo -e "${BLUE}Checking dependencies...${NC}"

MISSING=()

if ! command -v node &>/dev/null; then
  MISSING+=("nodejs")
fi

if ! command -v npm &>/dev/null; then
  MISSING+=("npm")
fi

if ! command -v git &>/dev/null; then
  MISSING+=("git")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  echo -e "${RED}Missing dependencies: ${MISSING[*]}${NC}"
  echo
  echo "Would you like to install them? (y/n)"
  read -r answer
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    if command -v apt &>/dev/null; then
      echo "Installing via apt..."
      sudo apt update && sudo apt install -y nodejs npm git
    elif command -v dnf &>/dev/null; then
      echo "Installing via dnf..."
      sudo dnf install -y nodejs npm git
    elif command -v brew &>/dev/null; then
      echo "Installing via brew..."
      brew install node git
    else
      echo -e "${RED}Please install Node.js, npm, and git manually.${NC}"
      echo "  Node.js: https://nodejs.org/"
      echo "  Git: https://git-scm.com/"
      exit 1
    fi
  else
    echo -e "${RED}Aborted. Please install dependencies and retry.${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}Dependencies OK${NC}"
echo

# =============================================================================
# 2. READ EXISTING CONFIG (if any)
# =============================================================================
CONFIG_FILE="${DEFAULT_SAILING_DIR}/paths.yaml"
ARTEFACTS="$DEFAULT_ARTEFACTS"
MEMORY="$DEFAULT_MEMORY"
TEMPLATES="$DEFAULT_TEMPLATES"
PROMPTING="$DEFAULT_PROMPTING"
RUDDER="$DEFAULT_RUDDER"
SKILL="$DEFAULT_SKILL"
COMMANDS="$DEFAULT_COMMANDS"

if [ -f "$CONFIG_FILE" ]; then
  echo -e "${BLUE}Found existing paths.yaml, reading custom paths...${NC}"

  # Simple YAML parsing with grep/sed (no yq dependency)
  parse_yaml_path() {
    grep -E "^\s*$1:" "$CONFIG_FILE" 2>/dev/null | sed 's/.*:\s*//' | tr -d '"' | tr -d "'" || echo ""
  }

  CUSTOM_ARTEFACTS=$(parse_yaml_path "artefacts")
  CUSTOM_MEMORY=$(parse_yaml_path "memory")
  CUSTOM_TEMPLATES=$(parse_yaml_path "templates")
  CUSTOM_PROMPTING=$(parse_yaml_path "prompting")
  CUSTOM_RUDDER=$(parse_yaml_path "rudder")
  CUSTOM_SKILL=$(parse_yaml_path "skill")
  CUSTOM_COMMANDS=$(parse_yaml_path "commands")

  [ -n "$CUSTOM_ARTEFACTS" ] && ARTEFACTS="$CUSTOM_ARTEFACTS"
  [ -n "$CUSTOM_MEMORY" ] && MEMORY="$CUSTOM_MEMORY"
  [ -n "$CUSTOM_TEMPLATES" ] && TEMPLATES="$CUSTOM_TEMPLATES"
  [ -n "$CUSTOM_PROMPTING" ] && PROMPTING="$CUSTOM_PROMPTING"
  [ -n "$CUSTOM_RUDDER" ] && RUDDER="$CUSTOM_RUDDER"
  [ -n "$CUSTOM_SKILL" ] && SKILL="$CUSTOM_SKILL"
  [ -n "$CUSTOM_COMMANDS" ] && COMMANDS="$CUSTOM_COMMANDS"

  echo "  Using paths from paths.yaml"
else
  echo "No existing paths.yaml, using defaults"
fi

echo

# =============================================================================
# 3. VALIDATE PATHS
# =============================================================================
echo -e "${BLUE}Validating paths...${NC}"

validate_path() {
  local p="$1"
  local parent=$(dirname "$p")
  if [ "$parent" != "." ] && [ ! -d "$parent" ]; then
    if ! mkdir -p "$parent" 2>/dev/null; then
      echo -e "${RED}Cannot create parent directory for: $p${NC}"
      return 1
    fi
  fi
  return 0
}

validate_path "$ARTEFACTS" || exit 1
validate_path "$MEMORY" || exit 1
validate_path "$TEMPLATES" || exit 1
validate_path "$CORE" || exit 1
validate_path "$RUDDER" || exit 1
validate_path "$SKILL" || exit 1
validate_path "$COMMANDS" || exit 1

echo -e "${GREEN}Paths OK${NC}"
echo

# =============================================================================
# 4. CLONE REPO
# =============================================================================
echo -e "${BLUE}Getting sailing source...${NC}"

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

git clone --depth 1 "$REPO_URL" "$TEMP_DIR/sailing" 2>/dev/null || {
  echo -e "${RED}Failed to clone repository${NC}"
  exit 1
}

SRC="$TEMP_DIR/sailing"

echo -e "${GREEN}Source ready${NC}"
echo

# =============================================================================
# 5. CREATE DIRECTORIES
# =============================================================================
echo -e "${BLUE}Creating directories...${NC}"

create_dir() {
  local d="$1"
  if [ ! -d "$d" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "  Would create: $d"
    else
      mkdir -p "$d"
      echo -e "  ${GREEN}Created: $d${NC}"
    fi
  fi
}

create_dir "$DEFAULT_SAILING_DIR"
create_dir "$ARTEFACTS"
create_dir "$ARTEFACTS/prds"
create_dir "$MEMORY"
create_dir "$TEMPLATES"
create_dir "$PROMPTING"
create_dir "$RUDDER"
create_dir "$SKILL"
create_dir "$COMMANDS"
create_dir "bin"

echo

# =============================================================================
# 6. COPY FILES
# =============================================================================
echo -e "${BLUE}Installing files...${NC}"

# Protected files (never overwritten unless --force)
PROTECTED_FILES=(
  "$DEFAULT_SAILING_DIR/state.json"
  "$DEFAULT_SAILING_DIR/components.yaml"
  "$ARTEFACTS/ROADMAP.md"
  "$ARTEFACTS/POSTIT.md"
)

copy_file() {
  local src="$1"
  local dest="$2"
  local protected="$3"

  if [ ! -f "$src" ]; then
    return
  fi

  if [ -f "$dest" ]; then
    if [ "$protected" = "true" ] && [ "$FORCE" != "true" ]; then
      echo -e "  ${YELLOW}Preserved: $dest${NC}"
      return
    fi
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy: $dest"
  else
    cp "$src" "$dest"
    echo -e "  ${GREEN}Installed: $dest${NC}"
  fi
}

copy_dir() {
  local src="$1"
  local dest="$2"

  if [ ! -d "$src" ]; then
    return
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy directory: $dest"
  else
    cp -r "$src"/* "$dest"/ 2>/dev/null || true
    echo -e "  ${GREEN}Installed: $dest${NC}"
  fi
}

# Rudder CLI (always updated)
echo "Installing Rudder CLI..."
copy_dir "$SRC/cli" "$RUDDER"

# Create bin/rudder wrapper at project root
if [ "$DRY_RUN" = true ]; then
  echo "  Would create: bin/rudder"
else
  cat > "bin/rudder" << 'WRAPPER'
#!/bin/bash
# Rudder CLI wrapper - points to .sailing/rudder/rudder.js
# This file is auto-generated by sailing installer
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
exec node "$SCRIPT_DIR/../.sailing/rudder/rudder.js" "$@"
WRAPPER
  chmod +x "bin/rudder"
  echo -e "  ${GREEN}Installed: bin/rudder${NC}"
fi

# Templates (always updated)
echo "Installing templates..."
copy_dir "$SRC/templates" "$TEMPLATES"

# Prompting fragments (always updated)
echo "Installing prompting fragments..."
copy_file "$SRC/prompting/contexts.yaml" "$PROMPTING/contexts.yaml" false
for subdir in agent skill shared; do
  if [ -d "$SRC/prompting/$subdir" ]; then
    create_dir "$PROMPTING/$subdir"
    for f in "$SRC/prompting/$subdir"/*.md; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      copy_file "$f" "$PROMPTING/$subdir/$fname" false
    done
  fi
done

# Skill (generate then copy - SKILL.md created based on mode in section 11)
echo "Building skill files..."
(cd "$SRC/skill" && ./build.sh) || {
  echo -e "${RED}Failed to build skill files${NC}"
  exit 1
}
echo "Installing skill..."
copy_file "$SRC/skill/SKILL_INLINE.md" "$SKILL/SKILL_INLINE.md" false
copy_file "$SRC/skill/SKILL_WORKTREE.md" "$SKILL/SKILL_WORKTREE.md" false

# Commands (always updated)
echo "Installing commands..."
copy_dir "$SRC/commands/dev" "$COMMANDS"

# Dist files (only if target doesn't exist)
echo "Installing dist files..."
copy_file "$SRC/dist/paths.yaml-dist" "$DEFAULT_SAILING_DIR/paths.yaml" true
# config.yaml: created on demand via 'rudder config:init' (defaults from schema)
copy_file "$SRC/dist/components.yaml-dist" "$DEFAULT_SAILING_DIR/components.yaml" true
copy_file "$SRC/dist/ROADMAP.md-dist" "$ARTEFACTS/ROADMAP.md" true
copy_file "$SRC/dist/POSTIT.md-dist" "$ARTEFACTS/POSTIT.md" true

# =============================================================================
# LEGACY HANDLING - Remove old core/ directory (replaced by prompting/)
# =============================================================================
if [ -d "$DEFAULT_SAILING_DIR/core" ]; then
  echo -e "${BLUE}Cleaning up legacy files...${NC}"
  if [ "$DRY_RUN" = true ]; then
    echo "  Would remove: $DEFAULT_SAILING_DIR/core/ (replaced by prompting/)"
  else
    rm -rf "$DEFAULT_SAILING_DIR/core"
    echo -e "  ${GREEN}Removed: $DEFAULT_SAILING_DIR/core/ (replaced by prompting/)${NC}"
  fi
fi

echo

# =============================================================================
# 7. INSTALL NPM DEPENDENCIES
# =============================================================================
echo -e "${BLUE}Installing npm dependencies...${NC}"

if [ "$DRY_RUN" = true ]; then
  echo "  Would run: npm install in $RUDDER"
else
  # Copy package.json to rudder dir
  cp "$SRC/package.json" "$RUDDER/"

  (cd "$RUDDER" && npm install --silent 2>/dev/null) || {
    echo -e "${YELLOW}npm install had warnings (this is usually OK)${NC}"
  }
  echo -e "  ${GREEN}Dependencies installed${NC}"
fi

echo

# =============================================================================
# 8. GLOBAL INSTALL (optional)
# =============================================================================
if [ "$GLOBAL" = true ]; then
  echo -e "${BLUE}Installing rudder globally...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  Would run: npm install -g"
  else
    (cd "$SRC" && npm install -g) || {
      echo -e "${YELLOW}Global install may require sudo. Try: sudo npm install -g @quazardous/sailing${NC}"
    }
  fi
  echo
fi

# =============================================================================
# 9. CONFIGURE CLAUDE PERMISSIONS
# =============================================================================
echo -e "${BLUE}Configuring Claude Code permissions...${NC}"

if [ "$DRY_RUN" = true ]; then
  echo "  Would run: bin/rudder permissions:fix"
else
  bin/rudder permissions:fix || {
    echo -e "${YELLOW}Could not configure permissions automatically.${NC}"
    echo "  Run manually: bin/rudder permissions:fix"
  }
fi

echo

# =============================================================================
# 10. APPLY FOLDER PROFILE (optional)
# =============================================================================
if [ -n "$FOLDERS_PROFILE" ]; then
  echo -e "${BLUE}Applying folder profile: $FOLDERS_PROFILE${NC}"

  PATHS_FILE="$DEFAULT_SAILING_DIR/paths.yaml"

  # Helper to check/fix haven paths (for haven profile with --fix)
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

  # Check if paths.yaml already exists
  if [ -f "$PATHS_FILE" ] && [ "$FORCE" != "true" ]; then
    if [ "$FIX" = true ] && [ "$FOLDERS_PROFILE" = "haven" ]; then
      echo -e "  ${BLUE}Checking haven paths...${NC}"
      check_haven_path "artefacts" "artefacts"
      check_haven_path "memory" "memory"
      check_haven_path "state" "state.json"
      check_haven_path "components" "components.yaml"
    else
      echo -e "${YELLOW}paths.yaml already exists, skipping (use --force to overwrite or --fix to update)${NC}"
    fi
  else
    if [ "$DRY_RUN" = true ]; then
      echo "  Would create: $PATHS_FILE with profile $FOLDERS_PROFILE"
    else
      case "$FOLDERS_PROFILE" in
        project)
          cat > "$PATHS_FILE" << 'EOF'
# Folder profile: project
# Worktrees in haven, artefacts in project
artefacts: ".sailing/artefacts"
memory: ".sailing/memory"
worktrees: "%haven%/worktrees/%project_hash%"
agents: "%haven%/agents"
EOF
          ;;
        haven)
          cat > "$PATHS_FILE" << 'EOF'
# Folder profile: haven
# Everything in ~/.sailing/havens/<hash>/
artefacts: "%haven%/artefacts"
memory: "%haven%/memory"
state: "%haven%/state.json"
components: "%haven%/components.yaml"
worktrees: "%haven%/worktrees"
agents: "%haven%/agents"
EOF
          ;;
        sibling)
          cat > "$PATHS_FILE" << 'EOF'
# Folder profile: sibling
# Worktrees in sibling directory
artefacts: ".sailing/artefacts"
memory: ".sailing/memory"
worktrees: "%sibling%/worktrees"
agents: "%sibling%/agents"
EOF
          ;;
      esac
      echo -e "  ${GREEN}Created: $PATHS_FILE${NC}"
    fi
  fi
  echo
fi

# =============================================================================
# 11. CONFIGURE SKILL MODE AND SKILL.md
# =============================================================================
echo -e "${BLUE}Configuring skill mode...${NC}"

CONFIG_FILE="$DEFAULT_SAILING_DIR/config.yaml"

if [ "$USE_WORKTREE" = true ]; then
  echo -e "  ${GREEN}Mode: worktree (subprocess + isolation)${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  Would set agent.use_subprocess: true and agent.use_worktrees: true in $CONFIG_FILE"
    echo "  Would copy: SKILL_WORKTREE.md → SKILL.md"
  else
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

    # SKILL.md = SKILL_WORKTREE.md
    cp "$SKILL/SKILL_WORKTREE.md" "$SKILL/SKILL.md"
    echo -e "  ${GREEN}Created: SKILL.md (worktree mode)${NC}"

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
  fi
else
  echo -e "  ${GREEN}Mode: inline (default)${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  Would copy: SKILL_INLINE.md → SKILL.md"
  else
    # SKILL.md = SKILL_INLINE.md
    cp "$SKILL/SKILL_INLINE.md" "$SKILL/SKILL.md"
    echo -e "  ${GREEN}Created: SKILL.md (inline mode)${NC}"
  fi
fi
echo

# =============================================================================
# DONE
# =============================================================================
echo -e "${GREEN}Installation complete!${NC}"
echo
echo "Usage:"
echo "  bin/rudder --help"
echo
echo "Quick start:"
echo "  bin/rudder prd:create \"My first PRD\""
echo "  bin/rudder prd:list"
echo
