#!/bin/bash
# papercompany — Heartbeat 데몬
# 에이전트별 설정된 주기(초)마다 자동으로 에이전트를 깨운다.
# Usage: ./scripts/heartbeat.sh [start|stop|status|once]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_DIR/agents"
ORG_FILE="$AGENTS_DIR/org.json"
COMPANY_FILE="$AGENTS_DIR/company.json"
STATE_FILE="$AGENTS_DIR/.heartbeat-state.json"
PID_FILE="$PROJECT_DIR/.heartbeat.pid"
LOG_FILE="$PROJECT_DIR/.heartbeat.log"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# state.json 초기화
init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    echo '{}' > "$STATE_FILE"
  fi
}

# 에이전트의 마지막 실행 시각 (epoch seconds)
get_last_run() {
  local agent_id="$1"
  jq -r --arg id "$agent_id" '.[$id].lastRun // 0' "$STATE_FILE"
}

# 마지막 실행 시각 업데이트
set_last_run() {
  local agent_id="$1"
  local now=$(date +%s)
  jq --arg id "$agent_id" --argjson now "$now" \
    '.[$id] = {lastRun: $now}' "$STATE_FILE" > "${STATE_FILE}.tmp" \
    && mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# GitHub에서 해당 role의 open 이슈 확인
get_assigned_issues() {
  local role="$1"
  local repo
  repo=$(jq -r '.repo // ""' "$COMPANY_FILE")
  if [ -z "$repo" ]; then return; fi

  gh issue list --repo "$repo" --label "role:$role" --state open --json number,title,labels \
    -q '.[] | "#\(.number) \(.title)"' 2>/dev/null || true
}

# 단일 heartbeat 사이클 실행
run_once() {
  init_state
  local now=$(date +%s)
  local ran=0

  jq -r '.agents | to_entries[] | select(.value.status == "active" and (.value.heartbeat // 0) > 0) | "\(.key)|\(.value.heartbeat)|\(.value.title)"' "$ORG_FILE" | \
  while IFS='|' read -r id interval title; do
    local last_run=$(get_last_run "$id")
    local elapsed=$((now - last_run))

    if [ "$elapsed" -ge "$interval" ]; then
      echo "[$(date '+%H:%M:%S')] 💓 $id ($title) — heartbeat 실행 (${interval}s 주기)"

      # GitHub 이슈 확인
      local issues
      issues=$(get_assigned_issues "$id")

      if [ -n "$issues" ]; then
        echo "[$(date '+%H:%M:%S')]    📌 할당된 이슈:"
        echo "$issues" | while read -r issue; do
          echo "       $issue"
        done

        # 에이전트 실행
        local prompt="Heartbeat 체크입니다. 할당된 GitHub Issues를 확인하고 작업을 진행하세요. 현재 할당된 이슈:\n$issues"
        "$SCRIPT_DIR/agent.sh" "$id" "$prompt" >> "$LOG_FILE" 2>&1 &
        echo "[$(date '+%H:%M:%S')]    🚀 에이전트 실행됨 (백그라운드)"
      else
        echo "[$(date '+%H:%M:%S')]    ✅ 할당된 이슈 없음 — 대기"
      fi

      set_last_run "$id"
      ran=1
    fi
  done

  if [ "$ran" -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] 😴 아직 heartbeat 시간이 안 된 에이전트만 있습니다."
  fi
}

# 데몬 실행 (최소 주기 간격으로 루프)
run_daemon() {
  init_state
  echo "[$(date '+%H:%M:%S')] 📎 papercompany heartbeat 시작"

  # 최소 heartbeat 간격 계산 (체크 주기)
  local min_interval
  min_interval=$(jq '[.agents | to_entries[] | select(.value.status == "active" and (.value.heartbeat // 0) > 0) | .value.heartbeat] | min // 60' "$ORG_FILE")

  # 체크 주기 = 최소 간격의 절반 (최소 10초)
  local check_interval=$((min_interval / 2))
  if [ "$check_interval" -lt 10 ]; then check_interval=10; fi

  echo "[$(date '+%H:%M:%S')] ⏱  체크 주기: ${check_interval}초 (최소 heartbeat: ${min_interval}초)"
  echo ""

  # Heartbeat 설정 현황 출력
  jq -r '.agents | to_entries[] | select(.value.status == "active") | "\(.key)|\(.value.heartbeat // 0)|\(.value.title)"' "$ORG_FILE" | \
  while IFS='|' read -r id interval title; do
    if [ "$interval" -gt 0 ]; then
      echo "  💓 $id ($title): ${interval}초"
    else
      echo "  💤 $id ($title): 비활성"
    fi
  done
  echo ""

  while true; do
    run_once 2>&1 | tee -a "$LOG_FILE"
    sleep "$check_interval"
  done
}

# ─── Main ───

COMMAND="${1:-status}"

case "$COMMAND" in

start)
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      echo "⚠️  이미 실행 중입니다 (PID: $OLD_PID)"
      echo "   중지하려면: ./scripts/heartbeat.sh stop"
      exit 1
    fi
    rm -f "$PID_FILE"
  fi

  echo -e "${GREEN}💓 Heartbeat 데몬 시작${NC}"
  run_daemon &
  DAEMON_PID=$!
  echo "$DAEMON_PID" > "$PID_FILE"
  echo "   PID: $DAEMON_PID"
  echo "   로그: $LOG_FILE"
  echo "   중지: pc heartbeat stop"
  ;;

stop)
  if [ ! -f "$PID_FILE" ]; then
    echo "⚠️  실행 중인 heartbeat이 없습니다."
    exit 0
  fi

  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    # 자식 프로세스도 정리
    pkill -P "$PID" 2>/dev/null || true
    echo -e "${RED}🛑 Heartbeat 중지${NC} (PID: $PID)"
  else
    echo "⚠️  프로세스가 이미 종료되었습니다."
  fi
  rm -f "$PID_FILE"
  ;;

status)
  echo ""
  echo -e "${BOLD}💓 Heartbeat 상태${NC}"
  echo ""

  # 데몬 상태
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo -e "  데몬: ${GREEN}실행 중${NC} (PID: $(cat "$PID_FILE"))"
  else
    echo -e "  데몬: ${RED}중지${NC}"
  fi
  echo ""

  # 에이전트별 heartbeat 설정
  init_state
  local now=$(date +%s)

  echo -e "${BOLD}  에이전트별 설정:${NC}"
  jq -r '.agents | to_entries[] | select(.value.status == "active") | "\(.key)|\(.value.heartbeat // 0)|\(.value.title)"' "$ORG_FILE" | \
  while IFS='|' read -r id interval title; do
    if [ "$interval" -gt 0 ]; then
      last_run=$(get_last_run "$id")
      if [ "$last_run" -gt 0 ]; then
        elapsed=$(( $(date +%s) - last_run ))
        last_str="${elapsed}초 전"
      else
        last_str="아직 실행 안 됨"
      fi
      echo -e "  💓 ${CYAN}$id${NC} ($title): ${interval}초 주기 — 마지막: $last_str"
    else
      echo -e "  💤 $id ($title): 비활성"
    fi
  done
  echo ""
  ;;

once)
  echo -e "${BOLD}💓 Heartbeat 1회 실행${NC}"
  echo ""
  run_once
  ;;

set)
  AGENT_ID="$2"
  INTERVAL="$3"

  if [ -z "$AGENT_ID" ] || [ -z "$INTERVAL" ]; then
    echo "Usage: ./scripts/heartbeat.sh set [agent-id] [seconds]"
    echo "  0 = 비활성"
    exit 1
  fi

  # org.json에 heartbeat 필드 추가/업데이트
  jq --arg id "$AGENT_ID" --argjson interval "$INTERVAL" \
    '.agents[$id].heartbeat = $interval' "$ORG_FILE" > "${ORG_FILE}.tmp" \
    && mv "${ORG_FILE}.tmp" "$ORG_FILE"

  if [ "$INTERVAL" -eq 0 ]; then
    echo -e "💤 $AGENT_ID heartbeat 비활성화"
  else
    echo -e "${GREEN}💓 $AGENT_ID heartbeat: ${INTERVAL}초${NC}"
  fi
  ;;

*)
  echo ""
  echo "📎 papercompany heartbeat"
  echo ""
  echo "Usage: ./scripts/heartbeat.sh [command]"
  echo ""
  echo "Commands:"
  echo "  start                     데몬 시작 (백그라운드)"
  echo "  stop                      데몬 중지"
  echo "  status                    상태 확인"
  echo "  once                      1회 실행"
  echo "  set [agent-id] [seconds]  주기 설정 (0 = 비활성)"
  echo ""
  ;;

esac
