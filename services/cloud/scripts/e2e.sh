#!/bin/bash
# End-to-end test of the local worker: sign-up, access link, agents.md, key, uploads (s a b p), serving, ownership,
# deletes, staff removal, expiry (cron) and revoking. Starts `teeny dev` (port 8787) and stops it at the end.
# Usage: npm test
set -u
cd "$(dirname "$0")/.."
A=http://127.0.0.1:8787
TMP=$(mktemp -d)
PERSIST=.local-persist
j() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }
ok() { echo "OK   $1"; }; bad() { echo "FAIL $1"; FAILS=$((FAILS+1)); }; FAILS=0
d1() { npx wrangler d1 execute threepipe-cloud --local --persist-to $PERSIST "$@" 2>/dev/null; }

if curl -s -o /dev/null "$A/api/v1/health"; then echo "port 8787 is in use: stop the other dev server first"; exit 1; fi
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
npx teenybase deploy --local --yes > "$TMP/migrate.log" 2>&1 || { cat "$TMP/migrate.log"; exit 1; }
npx teenybase dev > "$TMP/dev.log" 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null; pkill -P $DEV 2>/dev/null; rm -rf "$TMP"' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "$A/api/v1/health" && break; sleep 1; done
curl -s -o /dev/null "$A/api/v1/health" || { echo "dev server did not start"; cat "$TMP/dev.log"; exit 1; }

U=u$RANDOM
SIGN=$(curl -s -X POST $A/api/v1/table/users/auth/sign-up -H 'content-type: application/json' -d "{\"username\":\"$U\",\"email\":\"$U@x.test\",\"password\":\"pass12345\",\"passwordConfirm\":\"pass12345\",\"name\":\"$U\"}")
TOK=$(echo "$SIGN" | j "['token']" 2>/dev/null) && ok "sign-up" || { bad "sign-up: $SIGN"; exit 1; }
LINK=$(curl -s -X POST $A/api/v1/access-links -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"name":"laptop"}')
URL=$(echo "$LINK" | j "['url']") && ok "access link: $URL" || bad "access link: $LINK"
LID=$(echo "$LINK" | j "['id']")
MD=$(curl -s "$URL"); echo "$MD" | head -1 | grep -q "threepipe cloud" && ok "agents.md" || bad "agents.md: $MD"
KEYURL=$(echo "$MD" | grep -o "http[^ ]*/key" | head -1)
KEY=$(curl -s "$KEYURL"); [ ${#KEY} -gt 50 ] && ok "key (${#KEY} chars)" || bad "key: $KEY"
H="Authorization: Bearer $KEY"
echo "hello share" > $TMP/a.txt
R=$(curl -s -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-share/a.txt"); SURL=$(echo "$R" | j "['url']") && ok "upload s/ -> $SURL" || bad "upload s/: $R"
[ "$(curl -s "$SURL")" = "hello share" ] && ok "serve s/" || bad "serve s/"
printf '<h1>page</h1>' > $TMP/index.html
R=$(curl -s -X PUT -H "$H" -H 'content-type: text/html' --data-binary @$TMP/index.html "$A/api/v1/uploads/p/$U-page/index.html"); PURL=$(echo "$R" | j "['url']") && ok "upload p/" || bad "upload p/: $R"
HDR=$(curl -sI "${PURL%index.html}"); echo "$HDR" | grep -qi "content-security-policy: sandbox" && ok "p/ folder serves index.html with sandbox CSP" || bad "p/ headers: $HDR"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${PURL%/index.html}")" = "301" ] && ok "folder without slash redirects" || bad "folder redirect"
SHA=$(sha256sum $TMP/a.txt | cut -d' ' -f1)
R=$(curl -s -X PUT -H "$H" -H "x-content-sha256: $SHA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/a/$U.txt"); AURL=$(echo "$R" | j "['url']") && ok "upload a/ -> $AURL" || bad "upload a/: $R"
curl -sI "$AURL" | grep -qi "immutable" && ok "a/ cached immutable" || bad "a/ cache header"
R=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$H" -H "x-content-sha256: $(printf '0%.0s' {1..64})" --data-binary @$TMP/a.txt "$A/api/v1/uploads/a/$U-bad.txt"); [ "$R" = "400" ] && ok "a/ sha mismatch -> 400" || bad "a/ sha mismatch: $R"
R=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$H" "$A/api/v1/uploads/${AURL#*/_files/}"); [ "$R" = "403" ] && ok "owner cannot delete a/" || bad "delete a/ as owner: $R"
R=$(curl -s -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/b/threepipe/pr-$U/examples/a.txt"); echo "$R" | grep -q '"url"' && ok "upload b/" || bad "upload b/: $R"
R=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$H" "$A/api/v1/uploads/s/$U-share/a.txt"); [ "$R" = "200" ] && ok "delete s/" || bad "delete s/: $R"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$SURL")" = "410" ] && ok "deleted -> 410" || bad "deleted status"
# another user cannot write into the first user's scope
U2=v$RANDOM
T2=$(curl -s -X POST $A/api/v1/table/users/auth/sign-up -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"email\":\"$U2@x.test\",\"password\":\"pass12345\",\"passwordConfirm\":\"pass12345\",\"name\":\"$U2\"}" | j "['token']")
R=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $T2" --data-binary @$TMP/a.txt "$A/api/v1/uploads/p/$U-page/x.txt"); [ "$R" = "403" ] && ok "scope owned by first uploader" || bad "scope check: $R"
# list own files through teenybase
R=$(curl -s -H "$H" "$A/api/v1/table/files/select?select=path,size"); echo "$R" | grep -q "$U-page" && ok "list own files" || bad "list: $R"
# revoke the link: the key stops working
R=$(curl -s -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"where\":\"id == '$LID'\",\"returning\":[\"id\"]}" "$A/api/v1/table/access_links/delete"); echo "$R" | grep -q "$LID" && ok "revoke link (teenybase delete)" || bad "revoke: $R"
R=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-share2/a.txt"); [ "$R" = "401" ] && ok "revoked key -> 401" || bad "revoked key: $R"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$KEYURL")" = "404" ] && ok "revoked link -> 404" || bad "revoked link"

# staff removes a permanent asset
STAFF=st$RANDOM
TS=$(curl -s -X POST $A/api/v1/table/users/auth/sign-up -H 'content-type: application/json' -d "{\"username\":\"$STAFF\",\"email\":\"$STAFF@x.test\",\"password\":\"pass12345\",\"passwordConfirm\":\"pass12345\",\"name\":\"$STAFF\"}" | j "['token']")
d1 --command "UPDATE users SET role='staff' WHERE username='$STAFF'" > /dev/null
R=$(curl -s -X DELETE -H "Authorization: Bearer $TS" "$A/api/v1/uploads/${AURL#*/_files/}?reason=copyright"); echo "$R" | grep -q copyright && ok "staff removes a/" || bad "staff delete: $R"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$AURL")" = "410" ] && ok "removed a/ -> 410" || bad "removed a/ status"
# expiry: backdate the b/ build, run the cron
d1 --command "UPDATE files SET expires_at='2000-01-01T00:00:00.000Z' WHERE path LIKE 'b/threepipe/pr-$U/%'" > /dev/null
curl -s -o /dev/null "$A/cdn-cgi/handler/scheduled?cron=17+3+*+*+*"; sleep 1
[ "$(curl -s -o /dev/null -w '%{http_code}' "$A/_files/b/threepipe/pr-$U/examples/a.txt")" = "404" ] && ok "cron deletes expired build" || bad "cron"
echo "failures: $FAILS"
[ $FAILS -eq 0 ]
