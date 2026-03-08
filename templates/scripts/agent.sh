#!/bin/bash
# papercompany — 에이전트 실행 래퍼
# Usage: ./scripts/agent.sh [role] [prompt]

set -e

ROLE=$1
shift 2>/dev/null || true
PROMPT="$*"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "$ROLE" ] || [ -z "$PROMPT" ]; then
  echo "Usage: ./scripts/agent.sh [role] [prompt]"
  echo ""
  if [ -f "$PROJECT_DIR/agents/org.json" ]; then
    echo "Available roles:"
    jq -r '.agents | to_entries[] | select(.value.status == "active") | "  \(.key)\t— \(.value.title)"' "$PROJECT_DIR/agents/org.json"
  fi
  exit 1
fi

cd "$PROJECT_DIR"

case $ROLE in
  ceo|secretary) AGENT_ID="ceo" ;;
  engineer)              AGENT_ID="founding-engineer" ;;
  qa)                    AGENT_ID="tester" ;;
  mobile)                AGENT_ID="mobile-engineer" ;;
  *)                     AGENT_ID="$ROLE" ;;
esac

AGENTS_FILE="agents/$AGENT_ID/AGENTS.md"

if [ ! -f "$AGENTS_FILE" ]; then
  echo "Error: AGENTS.md not found for role '$ROLE' (looked for $AGENTS_FILE)"
  exit 1
fi

COMPANY_NAME=""
if [ -f "$PROJECT_DIR/agents/company.json" ]; then
  COMPANY_NAME=$(jq -r '.name' "$PROJECT_DIR/agents/company.json")
fi

echo "🚀 ${COMPANY_NAME:+[$COMPANY_NAME] }[$ROLE] 에이전트 실행..."
echo "📋 Prompt: $PROMPT"
echo "---"

claude -p "$(cat $AGENTS_FILE)

---
위 지침을 따라 아래 작업을 수행하세요:

$PROMPT"
