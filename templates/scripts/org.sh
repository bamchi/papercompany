#!/bin/bash
# papercompany — 조직 관리 스크립트
# Usage: ./scripts/org.sh [command]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_DIR/agents"
ORG_FILE="$AGENTS_DIR/org.json"
GOALS_FILE="$AGENTS_DIR/goals.json"
COMPANY_FILE="$AGENTS_DIR/company.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

if [ ! -f "$COMPANY_FILE" ]; then
  echo "⚠️  회사가 설정되지 않았습니다. 먼저 온보딩을 진행하세요:"
  echo "   pc init"
  exit 1
fi

command="${1:-tree}"

case "$command" in

tree)
  COMPANY=$(jq -r '.name' "$COMPANY_FILE")
  FOUNDER=$(jq -r '.founder' "$COMPANY_FILE")
  MISSION=$(jq -r '.mission' "$COMPANY_FILE")
  SEC_NAME=$(jq -r '.secretary.name' "$COMPANY_FILE")
  SEC_ROLE=$(jq -r '.secretary.role' "$COMPANY_FILE")

  echo ""
  echo -e "${BOLD}🏢 $COMPANY${NC}"
  echo -e "   미션: $MISSION"
  echo -e "   회장님: $FOUNDER"
  echo ""
  echo -e "   └─ ${CYAN}$SEC_NAME${NC} ($SEC_ROLE)"

  jq -r '.agents | to_entries[] | select(.value.reportsTo != null and .value.status == "active") | "\(.key)|\(.value.name)|\(.value.title)|\(.value.rank)|\(.value.reportsTo)"' "$ORG_FILE" | while IFS='|' read -r id name title rank reports_to; do
    if [ "$reports_to" = "taeyeon" ] || [ "$reports_to" = "secretary" ]; then
      RANK_BADGE=""
      if [ "$rank" = "executive" ]; then
        RANK_BADGE=" ${YELLOW}[임원]${NC}"
      fi
      echo -e "      ├─ ${GREEN}$name${NC} ($title)$RANK_BADGE"

      jq -r --arg mgr "$id" '.agents | to_entries[] | select(.value.reportsTo == $mgr and .value.status == "active") | "\(.value.name)|\(.value.title)"' "$ORG_FILE" | while IFS='|' read -r sub_name sub_title; do
        echo -e "      │  └─ $sub_name ($sub_title)"
      done
    fi
  done
  echo ""
  ;;

list)
  echo ""
  echo -e "${BOLD}📋 에이전트 목록${NC}"
  echo "─────────────────────────────────────────────────────"
  printf "%-16s %-20s %-10s %-10s %-12s\n" "ID" "TITLE" "RANK" "STATUS" "HIRE PERM"
  echo "─────────────────────────────────────────────────────"
  jq -r '.agents | to_entries[] | "\(.key)|\(.value.title)|\(.value.rank)|\(.value.status)|\(.value.hirePermission)"' "$ORG_FILE" | while IFS='|' read -r id title rank status perm; do
    STATUS_ICON="✅"
    if [ "$status" = "terminated" ]; then STATUS_ICON="❌"; fi
    printf "%-16s %-20s %-10s %s %-8s %-12s\n" "$id" "$title" "$rank" "$STATUS_ICON" "$status" "$perm"
  done
  echo ""
  ;;

show)
  AGENT_ID="$2"
  if [ -z "$AGENT_ID" ]; then
    echo "Usage: ./scripts/org.sh show [agent-id]"
    exit 1
  fi
  echo ""
  jq --arg id "$AGENT_ID" '.agents[$id] // "Agent not found"' "$ORG_FILE"
  echo ""
  ;;

goals)
  COMPANY=$(jq -r '.name' "$COMPANY_FILE")
  echo ""
  echo -e "${BOLD}🎯 $COMPANY Goals${NC}"
  echo ""

  GOAL_COUNT=$(jq '.goals | length' "$GOALS_FILE")
  if [ "$GOAL_COUNT" -eq 0 ]; then
    echo "  아직 목표가 없습니다. goals.json에 목표를 추가하세요."
    echo ""
    exit 0
  fi

  jq -r '.goals[] | "\(.id)|\(.title)|\(.status)|\(.priority)"' "$GOALS_FILE" | while IFS='|' read -r id title status priority; do
    TOTAL=$(jq --arg id "$id" '[.goals[] | select(.id == $id) | .keyResults[]] | length' "$GOALS_FILE")
    DONE=$(jq --arg id "$id" '[.goals[] | select(.id == $id) | .keyResults[] | select(.done == true)] | length' "$GOALS_FILE")

    if [ "$TOTAL" -gt 0 ]; then PCT=$((DONE * 100 / TOTAL)); else PCT=0; fi

    FILLED=$((PCT / 10))
    EMPTY=$((10 - FILLED))
    BAR=""
    for ((i=0; i<FILLED; i++)); do BAR+="█"; done
    for ((i=0; i<EMPTY; i++)); do BAR+="░"; done

    STATUS_ICON="🟢"
    if [ "$status" = "paused" ]; then STATUS_ICON="⏸"; fi
    if [ "$status" = "completed" ]; then STATUS_ICON="✅"; fi

    echo -e "$STATUS_ICON ${BOLD}$priority. $title${NC} [$BAR] ${PCT}% ($DONE/$TOTAL KR)"

    jq -r --arg id "$id" '.goals[] | select(.id == $id) | .keyResults[] | "\(.done)|\(.kr)"' "$GOALS_FILE" | while IFS='|' read -r done kr; do
      if [ "$done" = "true" ]; then
        echo -e "   ├─ ${GREEN}✅ $kr${NC}"
      else
        echo -e "   ├─ ⬜ $kr"
      fi
    done
    echo ""
  done
  ;;

*)
  echo ""
  echo "📎 papercompany 조직 관리"
  echo ""
  echo "Usage: ./scripts/org.sh [command]"
  echo ""
  echo "Commands:"
  echo "  tree              조직도 트리 (기본)"
  echo "  list              에이전트 테이블"
  echo "  show [id]         에이전트 상세"
  echo "  goals             목표 + 진행률"
  echo ""
  ;;

esac
