#!/usr/bin/env bash
# Day6 Dev1：Assignments 分页 / §3.4 batch-create 冒烟
# 用法：另开终端 cd server && PORT=3010 node app.js
#       bash server/test-day6-dev1.sh

set -e
BASE="http://localhost:${PORT:-3000}/api/v1"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"central","password":"Train2026!"}')
CODE=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code'))")
if [ "$CODE" != "200" ]; then red "登录失败"; echo "$R"; exit 1; fi
TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

R=$(curl -s "$BASE/assignments?pageNum=1&pageSize=3" -H "Authorization: Bearer $TOKEN")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
data=d['data']
assert 'list' in data and 'pagination' in data
p=data['pagination']
assert p['total']>=0 and p['pageNum']==1 and p['pageSize']==3
if data['list']:
    row=data['list'][0]
    for k in ('assignmentId','taskId','taskAssignedEventId'):
        assert k in row, f'missing {k}'
print('OK GET /assignments pagination + list shape')
"
green "GET /assignments §3.1 结构 OK"

R=$(curl -s "$BASE/assignments?pageNum=0" -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code'))")
if [ "$CODE" != "400" ]; then red "pageNum=0 应 400"; echo "$R"; exit 1; fi
green "pageNum 校验 OK"

R=$(curl -s -X POST "$BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Dev1 batch-create 测试","hasMypal":true,"ddlAt":"2026-06-01T00:00:00Z"}')
TASK_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

BODY=$(python3 -c "import json; print(json.dumps({
  'taskId': '${TASK_ID}',
  'targetUsers': [
    {'userId':'E002','userRole':'employee','storeId':'S001'},
    {'userId':'E003','userRole':'employee','storeId':'S001'},
  ]
}))")

R=$(curl -s -X POST "$BASE/assignments/batch-create" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
x=d['data']
assert x['successCount']==2, x
assert x['skippedCount']==0, x
print('OK first batch-create successCount=2')
"
green "POST /assignments/batch-create 首次 OK"

R=$(curl -s -X POST "$BASE/assignments/batch-create" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$BODY")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
x=d['data']
assert x['successCount']==0 and x['skippedCount']==2, x
print('OK idempotent batch-create skipped=2')
"
green "POST /assignments/batch-create 幂等 OK"

green "Day6 Dev1 脚本全部通过"
