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
    if [ "$reports_to" = "secretary" ]; then
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

hire)
  AGENT_ID="$2"
  AGENT_TITLE="$3"
  AGENT_RANK="${4:-staff}"
  REPORTS_TO="${5:-secretary}"

  if [ -z "$AGENT_ID" ] || [ -z "$AGENT_TITLE" ]; then
    echo "Usage: ./scripts/org.sh hire [id] [title] [rank] [reportsTo]"
    echo ""
    echo "  id         에이전트 ID (예: tester, mobile-engineer)"
    echo "  title      직함 (예: \"QA 엔지니어\")"
    echo "  rank       등급: executive | staff (기본: staff)"
    echo "  reportsTo  보고 대상 ID (기본: secretary)"
    exit 1
  fi

  # 이미 존재하는지 확인
  EXISTING=$(jq -r --arg id "$AGENT_ID" '.agents[$id] // empty' "$ORG_FILE")
  if [ -n "$EXISTING" ]; then
    STATUS=$(jq -r --arg id "$AGENT_ID" '.agents[$id].status' "$ORG_FILE")
    if [ "$STATUS" = "active" ]; then
      echo "❌ '$AGENT_ID'는 이미 활성 에이전트입니다."
      exit 1
    fi
    # terminated → 재채용
    echo "♻️  해고된 에이전트를 재채용합니다."
  fi

  HIRE_PERM="none"
  if [ "$AGENT_RANK" = "executive" ]; then
    HIRE_PERM="via-secretary"
  fi

  TODAY=$(date +%Y-%m-%d)

  # org.json에 에이전트 추가
  jq --arg id "$AGENT_ID" \
     --arg title "$AGENT_TITLE" \
     --arg rank "$AGENT_RANK" \
     --arg reports "$REPORTS_TO" \
     --arg perm "$HIRE_PERM" \
     --arg today "$TODAY" \
     '.agents[$id] = {
        name: $id, title: $title, reportsTo: $reports,
        manages: [], type: "agent", rank: $rank,
        hirePermission: $perm, status: "active", hiredAt: $today
      }' "$ORG_FILE" > "${ORG_FILE}.tmp" && mv "${ORG_FILE}.tmp" "$ORG_FILE"

  # reportsTo 대상의 manages 배열에 추가
  jq --arg id "$AGENT_ID" --arg mgr "$REPORTS_TO" \
     'if .agents[$mgr].manages then
        .agents[$mgr].manages = (.agents[$mgr].manages + [$id] | unique)
      else . end' "$ORG_FILE" > "${ORG_FILE}.tmp" && mv "${ORG_FILE}.tmp" "$ORG_FILE"

  # updated 날짜 갱신
  jq --arg today "$TODAY" '.updated = $today' "$ORG_FILE" > "${ORG_FILE}.tmp" && mv "${ORG_FILE}.tmp" "$ORG_FILE"

  # AGENTS.md 생성 (TEMPLATE.md 기반)
  AGENT_DIR="$AGENTS_DIR/$AGENT_ID"
  mkdir -p "$AGENT_DIR"
  COMPANY=$(jq -r '.name' "$COMPANY_FILE")
  FOUNDER=$(jq -r '.founder' "$COMPANY_FILE")
  SEC_NAME=$(jq -r '.secretary.name' "$COMPANY_FILE")

  if [ -f "$AGENTS_DIR/TEMPLATE.md" ]; then
    sed -e "s/\[에이전트명\]/$AGENT_ID/g" \
        -e "s/\[회사명\]/$COMPANY/g" \
        -e "s/\[역할\]/$AGENT_TITLE/g" \
        -e "s/\[company.name\]/$COMPANY/g" \
        -e "s/\[company.founder\]/$FOUNDER/g" \
        -e "s/\[company.secretary.name\]/$SEC_NAME/g" \
        -e "s/\[reportsTo\]/$REPORTS_TO/g" \
        "$AGENTS_DIR/TEMPLATE.md" > "$AGENT_DIR/AGENTS.md"
  fi

  echo -e "${GREEN}✅ 채용 완료${NC}: $AGENT_ID ($AGENT_TITLE) — rank: $AGENT_RANK, reports to: $REPORTS_TO"
  ;;

fire)
  AGENT_ID="$2"

  if [ -z "$AGENT_ID" ]; then
    echo "Usage: ./scripts/org.sh fire [agent-id]"
    exit 1
  fi

  # 존재 확인
  EXISTING=$(jq -r --arg id "$AGENT_ID" '.agents[$id] // empty' "$ORG_FILE")
  if [ -z "$EXISTING" ]; then
    echo "❌ '$AGENT_ID' 에이전트를 찾을 수 없습니다."
    exit 1
  fi

  STATUS=$(jq -r --arg id "$AGENT_ID" '.agents[$id].status' "$ORG_FILE")
  if [ "$STATUS" = "terminated" ]; then
    echo "⚠️  '$AGENT_ID'는 이미 해고된 상태입니다."
    exit 0
  fi

  # secretary는 해고 불가
  RANK=$(jq -r --arg id "$AGENT_ID" '.agents[$id].rank' "$ORG_FILE")
  if [ "$RANK" = "secretary" ]; then
    echo "❌ 비서는 해고할 수 없습니다."
    exit 1
  fi

  TODAY=$(date +%Y-%m-%d)

  # status → terminated
  jq --arg id "$AGENT_ID" --arg today "$TODAY" \
     '.agents[$id].status = "terminated" | .updated = $today' \
     "$ORG_FILE" > "${ORG_FILE}.tmp" && mv "${ORG_FILE}.tmp" "$ORG_FILE"

  # reportsTo 대상의 manages에서 제거
  REPORTS_TO=$(jq -r --arg id "$AGENT_ID" '.agents[$id].reportsTo' "$ORG_FILE")
  if [ "$REPORTS_TO" != "null" ]; then
    jq --arg id "$AGENT_ID" --arg mgr "$REPORTS_TO" \
       '.agents[$mgr].manages = [.agents[$mgr].manages[] | select(. != $id)]' \
       "$ORG_FILE" > "${ORG_FILE}.tmp" && mv "${ORG_FILE}.tmp" "$ORG_FILE"
  fi

  echo -e "${RED}🔥 해고 완료${NC}: $AGENT_ID"
  ;;

goals-add)
  GOAL_TITLE="${2}"

  if [ -z "$GOAL_TITLE" ]; then
    echo "Usage: ./scripts/org.sh goals-add [title]"
    exit 1
  fi

  # 다음 goal ID 자동 생성
  LAST_NUM=$(jq '[.goals[].id | capture("goal-(?<n>[0-9]+)") | .n | tonumber] | max // 0' "$GOALS_FILE")
  NEXT_NUM=$((LAST_NUM + 1))
  GOAL_ID="goal-$NEXT_NUM"

  # 우선순위 = 기존 목표 수 + 1
  PRIORITY=$(jq '.goals | length + 1' "$GOALS_FILE")

  jq --arg id "$GOAL_ID" \
     --arg title "$GOAL_TITLE" \
     --argjson priority "$PRIORITY" \
     '.goals += [{
        id: $id, title: $title, description: $title,
        status: "active", priority: $priority,
        milestones: [], keyResults: []
      }]' "$GOALS_FILE" > "${GOALS_FILE}.tmp" && mv "${GOALS_FILE}.tmp" "$GOALS_FILE"

  echo -e "${GREEN}✅ 목표 추가${NC}: $GOAL_ID — $GOAL_TITLE (priority: $PRIORITY)"
  ;;

goals-kr)
  GOAL_ID="$2"
  KR_TEXT="$3"

  if [ -z "$GOAL_ID" ]; then
    echo "Usage: ./scripts/org.sh goals-kr [goal-id] [kr-text]"
    echo ""
    echo "  kr-text 없으면: 기존 KR 목록에서 done 토글"
    echo "  kr-text 있으면: 새 KR 추가"
    exit 1
  fi

  # goal 존재 확인
  GOAL_EXISTS=$(jq --arg id "$GOAL_ID" '[.goals[] | select(.id == $id)] | length' "$GOALS_FILE")
  if [ "$GOAL_EXISTS" -eq 0 ]; then
    echo "❌ '$GOAL_ID' 목표를 찾을 수 없습니다."
    exit 1
  fi

  if [ -n "$KR_TEXT" ]; then
    # 새 KR 추가
    jq --arg id "$GOAL_ID" --arg kr "$KR_TEXT" \
       '(.goals[] | select(.id == $id)).keyResults += [{kr: $kr, done: false}]' \
       "$GOALS_FILE" > "${GOALS_FILE}.tmp" && mv "${GOALS_FILE}.tmp" "$GOALS_FILE"
    echo -e "${GREEN}✅ KR 추가${NC}: $GOAL_ID — $KR_TEXT"
  else
    # KR 목록 출력 + 토글 안내
    echo ""
    echo -e "${BOLD}$GOAL_ID Key Results:${NC}"
    IDX=0
    jq -r --arg id "$GOAL_ID" '.goals[] | select(.id == $id) | .keyResults[] | "\(.done)|\(.kr)"' "$GOALS_FILE" | while IFS='|' read -r done kr; do
      if [ "$done" = "true" ]; then
        echo "  $IDX. ✅ $kr"
      else
        echo "  $IDX. ⬜ $kr"
      fi
      IDX=$((IDX + 1))
    done
    echo ""
    echo "토글하려면: ./scripts/org.sh goals-kr $GOAL_ID --toggle [index]"
    echo "추가하려면: ./scripts/org.sh goals-kr $GOAL_ID \"KR 텍스트\""
  fi
  ;;

goals-kr-toggle)
  # pc goals kr [goal-id] --toggle [index] 에서 호출
  # 하지만 CLI에서 직접 처리하는 게 더 깔끔하므로 여기서도 지원
  ;;

*)
  echo ""
  echo "📎 papercompany 조직 관리"
  echo ""
  echo "Usage: ./scripts/org.sh [command]"
  echo ""
  echo "Commands:"
  echo "  tree                  조직도 트리 (기본)"
  echo "  list                  에이전트 테이블"
  echo "  show [id]             에이전트 상세"
  echo "  hire [id] [title]     에이전트 채용"
  echo "  fire [id]             에이전트 해고"
  echo "  goals                 목표 + 진행률"
  echo "  goals-add [title]     목표 추가"
  echo "  goals-kr [id] [kr]    KR 추가/토글"
  echo ""
  ;;

esac
