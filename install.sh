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
#   --global    Install rudder CLI globally via npm
#   --force     Force overwrite protected files
#   --dry-run   Show what would be done without doing it
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
DEFAULT_CORE=".sailing/core"
DEFAULT_RUDDER=".sailing/rudder"
DEFAULT_SKILL=".claude/skills/sailing"
DEFAULT_COMMANDS=".claude/commands/dev"

# Parse arguments
GLOBAL=false
FORCE=false
DRY_RUN=false

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
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

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
CORE="$DEFAULT_CORE"
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
  CUSTOM_CORE=$(parse_yaml_path "core")
  CUSTOM_RUDDER=$(parse_yaml_path "rudder")
  CUSTOM_SKILL=$(parse_yaml_path "skill")
  CUSTOM_COMMANDS=$(parse_yaml_path "commands")

  [ -n "$CUSTOM_ARTEFACTS" ] && ARTEFACTS="$CUSTOM_ARTEFACTS"
  [ -n "$CUSTOM_MEMORY" ] && MEMORY="$CUSTOM_MEMORY"
  [ -n "$CUSTOM_TEMPLATES" ] && TEMPLATES="$CUSTOM_TEMPLATES"
  [ -n "$CUSTOM_CORE" ] && CORE="$CUSTOM_CORE"
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
create_dir "$CORE"
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

# Core docs (reference documentation, always updated)
echo "Installing core docs..."
for f in "$SRC/core"/*.md; do
  fname=$(basename "$f")
  copy_file "$f" "$CORE/$fname" false
done

# Skill (always updated)
echo "Installing skill..."
copy_file "$SRC/skill/SKILL.md" "$SKILL/SKILL.md" false

# Commands (always updated)
echo "Installing commands..."
copy_dir "$SRC/commands/dev" "$COMMANDS"

# Dist files (only if target doesn't exist)
echo "Installing dist files..."
copy_file "$SRC/dist/paths.yaml-dist" "$DEFAULT_SAILING_DIR/paths.yaml" true
copy_file "$SRC/dist/components.yaml-dist" "$DEFAULT_SAILING_DIR/components.yaml" true
copy_file "$SRC/dist/ROADMAP.md-dist" "$ARTEFACTS/ROADMAP.md" true
copy_file "$SRC/dist/POSTIT.md-dist" "$ARTEFACTS/POSTIT.md" true

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
