#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Day 4 接口测试脚本
# 用法：
#   1. 终端 A：cd server && npm start   （或 PORT=3010 node app.js）
#   2. 终端 B：bash server/test-day4.sh  （或 PORT=3010 bash server/test-day4.sh）
# ──────────────────────────────────────────────────────────────────────────────

PORT="${PORT:-3000}"
HOST="http://localhost:${PORT}"
BASE="${HOST}/api/v1"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
blue()  { printf "\033[36m%s\033[0m\n" "$*"; }
sep()   { echo "----------------------------------------"; }

jq_code() { python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))"; }
jq_path() { local path="$1"; shift; python3 -c "import sys,json; d=json.load(sys.stdin); exec(\"v=d$path\"); print(v)"; }

check() {
  local desc="$1" actual="$2" expect="$3"
  if [ "$actual" = "$expect" ]; then
    PASS=$((PASS+1)); green "  OK  $desc  (code=$actual)"
  else
    FAIL=$((FAIL+1)); red   "  NG  $desc  (want=$expect got=$actual)"
  fi
}

sep
blue "Day 4 接口测试开始"
sep

# ─── 0. 登录 ──────────────────────────────────────────────────────────────────
blue ""
blue "[0] 登录获取 Token"

R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}')
TOKEN_C=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
check "central 登录" "$(echo "$R" | jq_code)" "200"

R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"emp_E002","password":"Train2026!"}')
TOKEN_E=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
EMP_ID=$(echo "$R"  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['userInfo']['employeeId'])")
check "employee 登录" "$(echo "$R" | jq_code)" "200"
echo "    employeeId = ${EMP_ID}"

R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"store_S001","password":"Train2026!"}')
TOKEN_M=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
check "employee 登录" "$(echo "$R" | jq_code)" "200"

# ─── 1. 创建 + 下发任务 ───────────────────────────────────────────────────────
blue ""
blue "[1] 创建并下发任务（为通知/催办测试准备数据）"

R=$(curl -s -X POST "$BASE/tasks" \
  -H "Authorization: Bearer ${TOKEN_C}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Day4测试任务","hasMypal":true,"hasSmartSell":true,"ddlAt":"2026-05-01T00:00:00Z"}')
TASK_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
check "创建任务" "$(echo "$R" | jq_code)" "201"
echo "    task_id = ${TASK_ID}"

R=$(curl -s -X POST "$BASE/tasks/${TASK_ID}/dispatch" \
  -H "Authorization: Bearer ${TOKEN_C}")
ASSIGN_N=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['assignmentCreated'])")
check "下发任务" "$(echo "$R" | jq_code)" "200"
echo "    assignmentCreated = ${ASSIGN_N}"

# ─── 2. GET /events/unread-count ──────────────────────────────────────────────
blue ""
blue "[2] GET /events/unread-count"

R=$(curl -s "$BASE/events/unread-count" -H "Authorization: Bearer ${TOKEN_E}")
UC=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['unreadCount'])")
check "员工未读数 code=200" "$(echo "$R" | jq_code)" "200"
echo "    unreadCount = ${UC}  (下发后应 >= 1)"

R=$(curl -s "$BASE/events/unread-count" -H "Authorization: Bearer ${TOKEN_C}")
check "central 未读数 code=200" "$(echo "$R" | jq_code)" "200"

# ─── 3. GET /events ──────────────────────────────────────────────────────────
blue ""
blue "[3] GET /events 通知事件列表"

R=$(curl -s "$BASE/events?pageNum=1&pageSize=10" -H "Authorization: Bearer ${TOKEN_E}")
ETOTAL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['pagination']['total'])")
EVENT_ID=$(echo "$R" | python3 -c "import sys,json; l=json.load(sys.stdin)['data']['list']; print(l[0]['eventId'] if l else '')")
IS_ACT=$(echo "$R"  | python3 -c "import sys,json; l=json.load(sys.stdin)['data']['list']; print(l[0]['isActive'] if l else '')")
check "员工获取事件列表 code=200" "$(echo "$R" | jq_code)" "200"
echo "    total = ${ETOTAL}  eventId = ${EVENT_ID}  isActive = ${IS_ACT}"

R=$(curl -s "$BASE/events?pageNum=1&pageSize=5" -H "Authorization: Bearer ${TOKEN_C}")
check "central 获取所有事件 code=200" "$(echo "$R" | jq_code)" "200"

# ─── 4. POST /assignments/:id/viewed（已读主路径；含 read_receipts）──────────────
blue ""
blue "[4] POST /assignments/:id/viewed  打开任务详情"

R=$(curl -s "$BASE/assignments" -H "Authorization: Bearer ${TOKEN_E}")
ASSIGN_ID=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
items = d.get('list', d) if isinstance(d, dict) else d
if items:
    row=items[0]
    print(row.get('assignmentId', row.get('id','')))
")
echo "    assignmentId = ${ASSIGN_ID}"

if [ -n "${ASSIGN_ID}" ]; then
  R=$(curl -s -X POST "$BASE/assignments/${ASSIGN_ID}/viewed" \
    -H "Authorization: Bearer ${TOKEN_E}")
  AV=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['alreadyViewed'])")
  RID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('receiptId') or '')")
  check "首次打开任务详情 code=200" "$(echo "$R" | jq_code)" "200"
  echo "    alreadyViewed = ${AV}  (首次应为 False)  receiptId = ${RID}"

  R=$(curl -s -X POST "$BASE/assignments/${ASSIGN_ID}/viewed" \
    -H "Authorization: Bearer ${TOKEN_E}")
  AV2=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['alreadyViewed'])")
  check "重复打开（幂等）code=200" "$(echo "$R" | jq_code)" "200"
  echo "    alreadyViewed = ${AV2}  (第二次应为 True)"
else
  red "  SKIP  没有 assignmentId"
fi

# ─── 5. POST /nudges ─────────────────────────────────────────────────────────
blue ""
blue "[5] POST /nudges  发起催办"

R=$(curl -s -X POST "$BASE/nudges" \
  -H "Authorization: Bearer ${TOKEN_C}" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"${TASK_ID}\",\"targetType\":\"employee\",\"targetId\":\"${EMP_ID}\",\"severity\":\"yellow\"}")
ND_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['nudgeRecordId'])")
ND_N=$(echo "$R"  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['nudgedCount'])")
check "central 催办员工 yellow code=200" "$(echo "$R" | jq_code)" "200"
echo "    nudgeRecordId=${ND_ID}  nudgedCount=${ND_N}"

R=$(curl -s -X POST "$BASE/nudges" \
  -H "Authorization: Bearer ${TOKEN_C}" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"${TASK_ID}\",\"targetType\":\"store\",\"targetId\":\"S001\",\"severity\":\"red\"}")
ND_N2=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['nudgedCount'])")
check "central 催办整门店 red code=200" "$(echo "$R" | jq_code)" "200"
echo "    nudgedCount (S001) = ${ND_N2}"

# 催办后员工未读应增加
R=$(curl -s "$BASE/events/unread-count" -H "Authorization: Bearer ${TOKEN_E}")
UC3=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['unreadCount'])")
echo "    催办后 unreadCount = ${UC3}"

R=$(curl -s -X POST "$BASE/nudges" \
  -H "Authorization: Bearer ${TOKEN_M}" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"${TASK_ID}\",\"targetType\":\"store\",\"targetId\":\"S001\",\"severity\":\"yellow\"}")

# 非法 severity，期望 400
R=$(curl -s -X POST "$BASE/nudges" \
  -H "Authorization: Bearer ${TOKEN_C}" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"${TASK_ID}\",\"targetType\":\"employee\",\"targetId\":\"${EMP_ID}\",\"severity\":\"blue\"}")
check "非法 severity 期望 400" "$(echo "$R" | jq_code)" "400"

# ─── 6. GET /nudges ──────────────────────────────────────────────────────────
blue ""
blue "[6] GET /nudges  催办审计记录"

R=$(curl -s "$BASE/nudges?taskId=${TASK_ID}" -H "Authorization: Bearer ${TOKEN_C}")
NT=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['pagination']['total'])")
check "获取催办列表 code=200" "$(echo "$R" | jq_code)" "200"
echo "    total = ${NT}  (期望 >= 2)"

R=$(curl -s "$BASE/nudges" -H "Authorization: Bearer ${TOKEN_C}")
check "缺少 taskId 期望 400" "$(echo "$R" | jq_code)" "400"

# ─── 7. 权限边界 ──────────────────────────────────────────────────────────────
blue ""
blue "[7] 权限边界"

R=$(curl -s "$BASE/events/unread-count")
check "无 Token 期望 401" "$(echo "$R" | jq_code)" "401"

R=$(curl -s -X POST "$BASE/events" \
  -H "Authorization: Bearer ${TOKEN_C}" \
  -H "Content-Type: application/json" \
  -d "{\"eventType\":\"nudge_yellow\",\"taskId\":\"${TASK_ID}\",\"targetUserId\":\"${EMP_ID}\",\"targetRole\":\"employee\"}")
check "POST /events 禁止 nudge 类型 期望 400" "$(echo "$R" | jq_code)" "400"

# ─── 8. WebSocket 握手 ────────────────────────────────────────────────────────
blue ""
blue "[8] WebSocket 握手"

WS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://localhost:${PORT}/ws?token=${TOKEN_E}")
check "WebSocket 升级握手 101" "${WS_CODE}" "101"

# ─── 汇总 ────────────────────────────────────────────────────────────────────
sep
echo ""
green "通过: ${PASS}"
if [ "${FAIL}" -gt 0 ]; then
  red "失败: ${FAIL}"
else
  green "失败: 0"
fi
echo ""
if [ "${FAIL}" -eq 0 ]; then
  green "全部通过！Day 4 验收完成"
else
  red "有失败项，请检查上方输出"
  exit 1
fi
