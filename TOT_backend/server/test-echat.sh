#!/usr/bin/env bash
# Test EChat HTTP flow
set -e
BASE="http://localhost:${PORT:-3000}/api/v1"

# Login as executive
R=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"executive","password":"Train2026!"}')
TOKEN=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['token'])")
echo "Login OK"

# Create session
R=$(curl -s -X POST "$BASE/chat/executive/sessions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert 'sessionId' in d['data'], d
assert 'exampleQuestions' in d['data'], d
print('createSession OK, sessionId:', d['data']['sessionId'])
"
SESSION_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])")

# Send a message
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"现在有哪些进行中的培训任务？"}')
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
rc=d['data']['replyContent']
assert 'overview' in rc, rc
assert isinstance(rc['keyNumbers'], list), rc
assert isinstance(rc['followUpSuggestions'], list), rc
print('sendMessage OK, overview:', rc['overview'][:50])
"

# Get history
R=$(curl -s "$BASE/chat/executive/sessions/$SESSION_ID/history?pageNum=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert d['data']['pagination']['total'] >= 2, d['data']['pagination']
print('getHistory OK, total messages:', d['data']['pagination']['total'])
"

echo "ALL EChat HTTP tests PASSED"
