#!/usr/bin/env bash
# Lint error report for sailing CLI
# Usage: ./scripts/lint-report.sh [--top N] [--file FILE]
set -euo pipefail

TOP=15
FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --top) TOP="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    *) echo "Usage: $0 [--top N] [--file FILE]"; exit 1 ;;
  esac
done

TARGET="${FILE:-cli/}"
LINT_OUTPUT=$(npx eslint "$TARGET" 2>&1 || true)

echo "=== LINT REPORT $(date +%Y-%m-%d) ==="
echo ""

# Total counts
ERRORS=$(echo "$LINT_OUTPUT" | grep -c " error " || true)
WARNINGS=$(echo "$LINT_OUTPUT" | grep -c " warning " || true)
echo "Total: ${ERRORS} errors, ${WARNINGS} warnings"
echo ""

# By rule
echo "--- BY RULE ---"
echo "$LINT_OUTPUT" | grep -oP '(@typescript-eslint|sonarjs)/\S+' | sort | uniq -c | sort -rn | head -"$TOP"
echo ""

# By file (errors only)
echo "--- TOP ${TOP} FILES (by error count) ---"
echo "$LINT_OUTPUT" | awk '/^\//{file=$0} / error /{count[file]++} END{for(f in count) print count[f], f}' | sort -rn | head -"$TOP"
echo ""

# Explicit-any sources (root causes)
echo "--- no-explicit-any SOURCES ---"
echo "$LINT_OUTPUT" | awk '/^\//{file=$0} /no-explicit-any/{count[file]++} END{for(f in count) print count[f], f}' | sort -rn | head -"$TOP"
