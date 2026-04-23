#!/usr/bin/env bash
# Test EChat Feedback and Regenerate HTTP flow
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
SESSION_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])")
echo "createSession OK, sessionId: $SESSION_ID"

# Send a message
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"现在有哪些进行中的培训任务？"}')
echo "sendMessage OK"

# Get history to get messageId
R=$(curl -s "$BASE/chat/executive/sessions/$SESSION_ID/history?pageNum=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN")
MESSAGE_ID=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for item in d['data']['historyList']:
    if item['role'] == 'assistant':
        print(item['messageId'])
        break
")
echo "Got latest assistant message ID: $MESSAGE_ID"

# 1. Test Feedback: like
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages/$MESSAGE_ID/feedback" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"feedback":"like"}')
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert d['data']['userFeedback'] == 'like', d
print('feedback like OK')
"

# Get history to verify feedback
R=$(curl -s "$BASE/chat/executive/sessions/$SESSION_ID/history?pageNum=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for item in d['data']['historyList']:
    if item['messageId'] == '$MESSAGE_ID':
        assert item['userFeedback'] == 'like', item
        print('history userFeedback like OK')
"

# 2. Test Feedback: dislike
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages/$MESSAGE_ID/feedback" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"feedback":"dislike"}')
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert d['data']['userFeedback'] == 'dislike', d
print('feedback dislike OK')
"

# 3. Test Feedback: none
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages/$MESSAGE_ID/feedback" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"feedback":"none"}')
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert d['data']['userFeedback'] is None, d
print('feedback none OK')
"

# 4. Test Regenerate
R=$(curl -s -X POST "$BASE/chat/executive/sessions/$SESSION_ID/messages/$MESSAGE_ID/regenerate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
NEW_MESSAGE_ID=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d.get('code')==200, d
assert 'messageId' in d['data'], d
print(d['data']['messageId'])
")
echo "regenerate OK, new messageId: $NEW_MESSAGE_ID"

# Get history to verify new message
R=$(curl -s "$BASE/chat/executive/sessions/$SESSION_ID/history?pageNum=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids = [item['messageId'] for item in d['data']['historyList']]
assert '$NEW_MESSAGE_ID' in ids, 'New message not in history'
assert '$MESSAGE_ID' not in ids, 'Old message should not be in history anymore'
print('history includes regenerated and correctly removed old message OK')
"

# Clean up
curl -s -X DELETE "$BASE/chat/executive/sessions/$SESSION_ID" -H "Authorization: Bearer $TOKEN" > /dev/null
echo "ALL EChat Feedback & Regenerate tests PASSED"
