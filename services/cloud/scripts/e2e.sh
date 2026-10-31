#!/bin/bash
# End-to-end test of the local worker: sign-up, access link, agents.md, key, uploads (s a b p), serving, ownership,
# deletes, staff removal, expiry (cron), revoking, the drive (items, folders, signed URLs, links, quota) and app sign-in (connect). Starts `teeny dev` (port 8787) and stops it at the end.
# Usage: npm test
set -u
cd "$(dirname "$0")/.."
A=http://127.0.0.1:8787
TMP=$(mktemp -d)
j() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
ok() { echo "OK   $1"; }; bad() { echo "FAIL $1"; FAILS=$((FAILS+1)); }; FAILS=0
# fixtures through teenybase's admin API (ADMIN_SERVICE_TOKEN of .dev.vars): admin <table>/<insert|update|delete> <json>
admin() { curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d "$2" "$A/api/v1/table/$1"; }

if curl -s -o /dev/null "$A/api/v1/health"; then echo "port 8787 is in use: stop the other dev server first"; exit 1; fi
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
ADMIN_TOKEN=$(grep '^ADMIN_SERVICE_TOKEN=' .dev.vars | cut -d= -f2-)
npx teenybase deploy --local --yes > "$TMP/migrate.log" 2>&1 || { cat "$TMP/migrate.log"; exit 1; }
# its own process group, so the cleanup stops teenybase, wrangler and workerd together
setsid npx teenybase dev > "$TMP/dev.log" 2>&1 &
DEV=$!
trap 'kill -- -$DEV 2>/dev/null; rm -rf "$TMP"' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "$A/api/v1/health" && break; sleep 1; done
curl -s -o /dev/null "$A/api/v1/health" || { echo "dev server did not start"; cat "$TMP/dev.log"; exit 1; }

U=u$RANDOM
SIGN=$(curl -s -X POST $A/api/v1/table/users/auth/sign-up -H 'content-type: application/json' -d "{\"username\":\"$U\",\"email\":\"$U@x.test\",\"password\":\"pass12345\",\"passwordConfirm\":\"pass12345\",\"name\":\"$U\"}")
TOK=$(echo "$SIGN" | j "['token']" 2>/dev/null) && ok "sign-up" || { bad "sign-up: $SIGN"; exit 1; }
LINK=$(curl -s -X POST $A/api/v1/access-links -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"name":"laptop"}')
URL=$(echo "$LINK" | j "['url']") && ok "access link: $URL" || bad "access link: $LINK"
LID=$(echo "$LINK" | j "['id']")
MD=$(curl -s "$URL"); echo "$MD" | head -1 | grep -q "threepipe cloud" && echo "$MD" | grep -q "valid for 30 days" && echo "$MD" | grep -q "max 90 MB per file" && ok "agents.md (limits from src/limits.ts)" || bad "agents.md: $MD"
KEYURL=$(echo "$MD" | grep -o "http[^ ]*/key" | head -1)
KEY=$(curl -s "$KEYURL"); [ ${#KEY} -gt 50 ] && ok "key (${#KEY} chars)" || bad "key: $KEY"
H="Authorization: Bearer $KEY"
echo "hello share" > $TMP/a.txt
R=$(curl -s -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-share/a.txt"); SURL=$(echo "$R" | j "['url']") && ok "upload s/ -> $SURL" || bad "upload s/: $R"
[ "$(curl -s "$SURL")" = "hello share" ] && ok "serve s/" || bad "serve s/"
# names in any language: NFC-normalized (here the é comes decomposed, as macOS sends it), URLs percent-encoded
NFD=$(python3 -c "import urllib.parse;print(urllib.parse.quote('cafe\u0301 モデル.txt'))")
R=$(curl -s -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-uni/$NFD"); UURL=$(echo "$R" | j "['url']")
[ "$(curl -s "$UURL")" = "hello share" ] && [ "$(curl -s "$A/_files/s/$U-uni/$(python3 -c "import urllib.parse;print(urllib.parse.quote('caf\u00e9 モデル.txt'))")")" = "hello share" ] && ok "unicode file names (NFC)" || bad "unicode: $R"
[ "$(code -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-uni/$(python3 -c "import urllib.parse;print(urllib.parse.quote('x\u202egnp.exe'))")")" = "400" ] && [ "$(code -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-uni/a%23b.txt")" = "400" ] && ok "control/format characters and # are refused" || bad "bad names"
[ "$(code "$SURL")" = "200" ] && [ "$(code -H 'Range: bytes=0-4' "$SURL")" = "206" ] && [ "$(curl -s -H 'Range: bytes=0-4' "$SURL")" = "hello" ] && ok "200, and 206 for a Range request" || bad "status / range"
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
[ "$(admin users/update "{\"where\":\"username == '$STAFF'\",\"setValues\":{\"role\":\"staff\"}}")" = "200" ] || bad "fixture: make staff"
R=$(curl -s -X DELETE -H "Authorization: Bearer $TS" "$A/api/v1/uploads/${AURL#*/_files/}?reason=copyright"); echo "$R" | grep -q copyright && ok "staff removes a/" || bad "staff delete: $R"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$AURL")" = "410" ] && ok "removed a/ -> 410" || bad "removed a/ status"
# staff buckets (write-once, content-addressed for e2e)
BSHA=$(sha256sum $TMP/a.txt | cut -d' ' -f1)
R=$(curl -s -X PUT -H "Authorization: Bearer $TS" -H "x-content-sha256: $BSHA" --data-binary @$TMP/a.txt "$A/api/v1/buckets/e2e/blobs/$BSHA.txt"); echo "$R" | grep -q "e2e-snapshots.threepipe.org/blobs/$BSHA.txt" && ok "staff uploads an e2e blob" || bad "e2e blob: $R"
curl -s -X PUT -H "Authorization: Bearer $TS" -H "x-content-sha256: $BSHA" --data-binary @$TMP/a.txt "$A/api/v1/buckets/e2e/blobs/$BSHA.txt" | grep -q '"existed":true' && ok "same blob again -> existed" || bad "e2e blob again"
[ "$(code -X PUT -H "Authorization: Bearer $TS" -H "x-content-sha256: $BSHA" --data-binary @$TMP/a.txt "$A/api/v1/buckets/e2e/blobs/$(printf '1%.0s' {1..64}).txt")" = "400" ] && ok "e2e blob name must be its sha256" || bad "e2e blob name"
[ "$(code -X PUT -H "Authorization: Bearer $T2" -H "x-content-sha256: $BSHA" --data-binary @$TMP/a.txt "$A/api/v1/buckets/samples/x/a.txt")" = "403" ] && ok "members cannot write staff buckets" || bad "member staff bucket"
R=$(curl -s -X POST -H "Authorization: Bearer $TS" -H 'content-type: application/json' -d "{\"paths\":[\"blobs/$BSHA.txt\",\"blobs/$(printf 'a%.0s' {1..64}).png\"]}" "$A/api/v1/buckets/e2e/missing")
echo "$R" | grep -q "aaaa" && ! echo "$R" | grep -q "$BSHA" && ok "missing blobs" || bad "missing: $R"
# expiry: backdate the b/ build, run the cron
[ "$(admin files/update "{\"where\":\"path == 'b/threepipe/pr-$U/examples/a.txt'\",\"setValues\":{\"expires_at\":\"2000-01-01T00:00:00.000Z\"}}")" = "200" ] || bad "fixture: backdate build"
curl -s -o /dev/null "$A/cdn-cgi/handler/scheduled?cron=17+3+*+*+*"; sleep 1
[ "$(curl -s -o /dev/null -w '%{http_code}' "$A/_files/b/threepipe/pr-$U/examples/a.txt")" = "404" ] && ok "cron deletes expired build" || bad "cron"
# --- drive (items, folders) ---
H0="Authorization: Bearer $TOK"
UID1=$(echo "$SIGN" | j "['record']['id']")
echo '{"asset":{"version":"2.0"}}' > $TMP/scene.gltf; echo "bin" > $TMP/scene.bin
R=$(curl -s -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=chair.glb"); ITEM=$(echo "$R" | j "['id']"); IURL=$(echo "$R" | j "['url']")
echo "$R" | grep -q '"visibility":"private"' && ok "save a file: a private item" || bad "save: $R"
[ "$(code "$IURL")" = "404" ] && ok "a private item is not served" || bad "private served: $IURL"
R=$(curl -s -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=chair.glb"); echo "$R" | grep -q '"name":"chair (2).glb"' && ok "same name in a folder -> chair (2).glb" || bad "free name: $R"
FID=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d '{"name":"furniture"}' "$A/api/v1/drive/folders" | j "['id']")
LID=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"name\":\"lamp\",\"entry\":\"scene.gltf\",\"folder\":\"$FID\"}" "$A/api/v1/drive/items" | j "['id']")
curl -s -o /dev/null -X PUT -H "$H0" --data-binary @$TMP/scene.gltf "$A/api/v1/drive/items/$LID/scene.gltf"
curl -s -o /dev/null -X PUT -H "$H0" --data-binary @$TMP/scene.bin "$A/api/v1/drive/items/$LID/tex/scene.bin"
curl -s -H "$H0" "$A/api/v1/drive/items/$LID" | grep -q '"files_count":2' && ok "a folder item with 2 files" || bad "folder item"
SURL=$(curl -s -X POST -H "$H0" "$A/api/v1/drive/items/$LID/sign" | j "['url']")
curl -s "${SURL}scene.gltf" | grep -q asset && [ "$(curl -s "${SURL}tex/scene.bin")" = "bin" ] && ok "signed item URL serves the entry and its relative files" || bad "signed item: $SURL"
[ "$(code "${SURL%$LID/}$ITEM/chair.glb")" = "403" ] && ok "a signature covers one item only" || bad "signature scope"
[ "$(code "$(echo "$SURL" | sed -E 's#(/t/[0-9]+\.)[A-Za-z0-9_-]#\1x#')scene.gltf")" = "403" ] && ok "tampered signature -> 403" || bad "tampered"
LURL=$(curl -s -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"visibility":"link"}' "$A/api/v1/drive/items/$LID" | j "['url']")
[ "$(code "$LURL")" = "200" ] && [ "$(curl -s "${LURL%scene.gltf}tex/scene.bin")" = "bin" ] && ok "link: anyone with the item URL" || bad "link: $LURL"
curl -s -o /dev/null -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"visibility":"private"}' "$A/api/v1/drive/items/$LID"
[ "$(code "$LURL")" = "404" ] && ok "private again" || bad "private again"
R=$(curl -s -X PATCH -H "$H0" -H 'content-type: application/json' -d "{\"name\":\"armchair.glb\",\"folder\":\"$FID\"}" "$A/api/v1/drive/items/$ITEM")
[ "$(echo "$R" | j "['url']")" = "$IURL" ] && curl -s -H "$H0" "$A/api/v1/drive?folder=$FID" | grep -q armchair.glb && ok "rename and move: only the label changes, the URL stays" || bad "rename: $R"
[ "$(curl -s -H "$H0" "$A/api/v1/drive/resolve?path=/furniture/armchair.glb" | j "['item']['id']")" = "$ITEM" ] && ok "resolve a path" || bad "resolve"
curl -s -o /dev/null -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"name":"Möbel 2"}' "$A/api/v1/drive/folders/$FID"
[ "$(curl -s -H "$H0" "$A/api/v1/drive/resolve?path=$(enc '/Möbel 2/lamp')" | j "['item']['id']")" = "$LID" ] && ok "rename a folder (one row), paths follow" || bad "folder rename"
SUB=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"name\":\"sub\",\"parent\":\"$FID\"}" "$A/api/v1/drive/folders" | j "['id']")
[ "$(code -X PATCH -H "$H0" -H 'content-type: application/json' -d "{\"parent\":\"$SUB\"}" "$A/api/v1/drive/folders/$FID")" = "400" ] && ok "a folder cannot move into itself" || bad "folder cycle"
[ "$(code -X DELETE -H "$H0" "$A/api/v1/drive/folders/$FID")" = "409" ] && ok "a folder that is not empty is not deleted" || bad "delete non-empty"
[ "$(code -H "Authorization: Bearer $T2" "$A/api/v1/drive/items/$ITEM")" = "404" ] && [ "$(code -X PUT -H "Authorization: Bearer $T2" --data-binary @$TMP/a.txt "$A/api/v1/drive/items/$ITEM/x.txt")" = "404" ] && ok "another user's items do not exist for you" || bad "other user item"
NL=$(curl -s -X POST -H "$H0" "$A/api/v1/drive/items/$LID/new-id" | j "['id']")
[ -n "$NL" ] && [ "$NL" != "$LID" ] && [ "$(code "${SURL}scene.gltf")" = "404" ] && curl -s "$(curl -s -X POST -H "$H0" "$A/api/v1/drive/items/$NL/sign" | j "['url']")tex/scene.bin" | grep -q bin && ok "new id: the old URLs stop working, the item stays" || bad "new id: $NL"
[ "$(admin files/insert "{\"values\":{\"owner_id\":\"$UID1\",\"bucket\":\"cloud\",\"prefix\":\"d\",\"path\":\"d/$U/big\",\"size\":1073741824}}")" = "200" ] || bad "fixture: big file"
[ "$(code -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=over.txt")" = "413" ] && ok "drive quota -> 413" || bad "quota"
[ "$(admin user_limits/insert "{\"values\":{\"user_id\":\"$UID1\",\"drive_quota\":2147483648,\"note\":\"e2e\"}}")" = "200" ] || bad "fixture: user limits"
[ "$(code -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=over.txt")" = "201" ] && [ "$(curl -s -H "$H0" "$A/api/v1/me" | j "['drive']['quota']")" = "2147483648" ] && ok "a user's own drive quota (user_limits)" || bad "user quota"
[ "$(code -H "$H0" "$A/api/v1/table/user_limits/list")" = "403" ] && [ "$(code -X POST -H "$H0" -H 'content-type: application/json' -d "{\"values\":{\"user_id\":\"$UID1\",\"projects\":99}}" "$A/api/v1/table/user_limits/insert")" = "403" ] && ok "users cannot read or set their limits" || bad "user_limits rules"
admin user_limits/delete "{\"where\":\"user_id == '$UID1'\"}" > /dev/null
admin files/delete "{\"where\":\"path == 'd/$U/big'\"}" > /dev/null
curl -sI "$A/drive" | grep -qi "content-security-policy: default-src 'none'; script-src 'self'" && [ "$(code "$A/drive/page.js")" = "200" ] && ok "drive page" || bad "drive page"
[ "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$A/ui.css")" = "200 text/css; charset=utf-8" ] && [ "$(code "$A/ui.js")" = "200" ] && ok "the pages' look (/ui.css, /ui.js)" || bad "ui.css"
R=$(curl -s -H "$H0" "$A/api/v1/me"); [ "$(echo "$R" | j "['username']")" = "$U" ] && [ "$(echo "$R" | j "['drive']['quota']")" = "1073741824" ] && echo "$R" | grep -q '"feedback":' && ok "me: the handle, the drive quota, the feedback project" || bad "me: $R"
[ "$(code -X DELETE -H "$H0" "$A/api/v1/drive/items/$ITEM")" = "200" ] && [ "$(code -H "$H0" "$A/api/v1/drive/items/$ITEM")" = "404" ] && ok "delete an item" || bad "delete item"

# --- app sign-in (connect) ---
CK="Cookie: tp_cloud_auth=$TOK"
APP="$A/_files/p/$U-page/index.html"
CON="$A/api/v1/connect?return=$(enc "$APP")"
curl -s "$CON" | grep -q "Continue with GitHub" && ok "connect: signed out -> sign-in page" || bad "connect signed out"
curl -s -H "$CK" "$CON" | grep -q "Connect p/$U-page" && ok "connect: consent page" || bad "connect consent"
[ "$(code -X POST -H "$CK" --data-urlencode "return=$APP" "$A/api/v1/connect")" = "403" ] && ok "connect: cookie post without our Origin -> 403" || bad "connect csrf"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST -H "$CK" -H "Origin: $A" --data-urlencode "return=$APP" "$A/api/v1/connect")
AK=$(python3 -c "import sys,urllib.parse as u;print(u.parse_qs(sys.argv[1].split('#',1)[1])['tp_cloud_key'][0])" "$LOC" 2>/dev/null) && ok "connect: approve -> back to the app with a key" || bad "connect approve: $LOC"
AF=$(python3 -c "import sys,urllib.parse as u;print(u.parse_qs(sys.argv[1].split('#',1)[1])['tp_cloud_folder'][0])" "$LOC" 2>/dev/null)
[ -n "$AF" ] && [ "$AF" != "*" ] && curl -s -H "$H0" "$A/api/v1/drive?folder=$AF" | grep -q '"name":"Apps"' && ok "connect: the app's folder Apps/<app>" || bad "connect folder: $LOC"
HA="Authorization: Bearer $AK"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=save.txt")" = "201" ] && ok "app key saves in its folder" || bad "app key write"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=x.txt&folder=")" = "403" ] && [ "$(code -H "$HA" "$A/api/v1/drive/items/$NL")" = "403" ] && ok "app key: the rest of the drive -> 403" || bad "app key outside folder"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-app/a.txt")" = "403" ] && ok "app key: s/ -> 403" || bad "app key s/"
[ "$(code -H "$HA" "$A/api/v1/table/files/select")" = "403" ] && ok "app key: teenybase routes -> 403" || bad "app key teenybase"
[ "$(code -X POST -H "$HA" "$A/api/v1/access-links")" = "403" ] && ok "app key: no access links" || bad "app key access links"
[ "$(code -H "$HA" "$A/api/v1/me")" = "403" ] && ok "app key: no me" || bad "app key me"
R=$(curl -s -H "$HA" "$A/api/v1/drive"); echo "$R" | grep -q save.txt && ! echo "$R" | grep -q 'Möbel' && ok "app key lists only its folder" || bad "app key list: $R"
curl -s -o /dev/null -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"name":"My page app"}' "$A/api/v1/drive/folders/$AF"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=after-rename.txt")" = "201" ] && ok "the user renames the app's folder, the app still works" || bad "app folder rename"
# the user empties and deletes the app's folder: the app's next save makes it again (same key)
for it in $(curl -s -H "$H0" "$A/api/v1/drive?folder=$AF" | python3 -c "import json,sys;print(' '.join(i['id'] for i in json.load(sys.stdin)['items']))"); do curl -s -o /dev/null -X DELETE -H "$H0" "$A/api/v1/drive/items/$it"; done
[ "$(code -X DELETE -H "$H0" "$A/api/v1/drive/folders/$AF")" = "200" ] || bad "fixture: delete the app's folder"
R=$(curl -s -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=again.txt"); echo "$R" | grep -q '"name":"again.txt"' && [ "$(echo "$R" | j "['folder_id']")" != "$AF" ] && ok "the app's folder was deleted: made again on the next save" || bad "app folder recreate: $R"
AF=$(echo "$R" | j "['folder_id']")
LOC2=$(curl -s -o /dev/null -w '%{redirect_url}' -H "$CK" "$CON"); echo "$LOC2" | grep -q "#tp_cloud_key=" && ok "connect: approved before -> straight back with a key" || bad "connect silent: $LOC2"
UID2=$(curl -s -H "Authorization: Bearer $T2" "$A/api/v1/table/users/select?select=id" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
admin scopes/update "{\"where\":\"scope == 'p/$U-page'\",\"setValues\":{\"owner_id\":\"$UID2\"}}" > /dev/null
curl -s -H "$CK" "$CON" | grep -q "@$U2" && ok "connect: app with a new owner -> consent again" || bad "connect new owner"
admin scopes/update "{\"where\":\"scope == 'p/$U-page'\",\"setValues\":{\"owner_id\":\"$UID1\"}}" > /dev/null
[ "$(code -H "$CK" "$A/api/v1/connect?return=$(enc "$A/_files/p/none-$U/")")" = "400" ] && ok "connect: unknown app -> 400" || bad "connect unknown app"
[ "$(code -H "$CK" "$A/api/v1/connect?return=$(enc "https://example.com/app/")")" = "400" ] && ok "connect: other sites -> 400" || bad "connect other site"
curl -s -H "$CK" "$A/api/v1/connect?return=$(enc "http://localhost:5173/")" | grep -q "Apps/localhost:5173" && ok "connect: localhost app" || bad "connect localhost"
curl -s -H "$CK" "$A/api/v1/connect?return=$(enc "http://5173.me.aibox.localhost/x/")" | grep -q "Apps/5173.me.aibox.localhost:80" && ok "connect: *.localhost app" || bad "connect *.localhost"
R=$(curl -s -H "$H0" "$A/api/v1/access-links"); GID=$(echo "$R" | python3 -c "import json,sys;print([l for l in json.load(sys.stdin)['links'] if l.get('app')=='p/$U-page'][0]['id'])" 2>/dev/null)
[ -n "$GID" ] && echo "$R" | grep -q '"access":"folder"' && ok "access links list the connected app and its folder" || bad "list access links: $R"
[ "$(code -H "$HA" "$A/api/v1/access-links")" = "403" ] && [ "$(code -X DELETE -H "$HA" "$A/api/v1/access-links/$GID")" = "403" ] && ok "app key: cannot list or revoke links" || bad "app key links"
[ "$(code -X DELETE -H "Authorization: Bearer $T2" "$A/api/v1/access-links/$GID")" = "404" ] && ok "revoke someone else's link -> 404" || bad "revoke other"
[ "$(code -X DELETE -H "$H0" "$A/api/v1/access-links/$GID")" = "200" ] && ok "revoke the app (DELETE /api/v1/access-links/<id>)" || bad "revoke app"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/drive/files?name=late.txt")" = "401" ] && ok "revoked app -> 401" || bad "revoked app"
LOC3=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST -H "$CK" -H "Origin: $A" --data-urlencode "return=$APP" "$A/api/v1/connect")
echo "$LOC3" | grep -q "tp_cloud_folder=$AF" && ok "approved again: the same folder" || bad "re-approve folder: $LOC3"
# --- local sign-in (DEV_LOGIN) ---
DU=dev$RANDOM
R=$(curl -s -o /dev/null -D - -X POST --data-urlencode "username=$DU" --data-urlencode "password=pass12345" --data-urlencode "redirect=/api/v1/drive" "$A/login")
echo "$R" | grep -qi "set-cookie: tp_cloud_auth=" && echo "$R" | grep -qi "location: /api/v1/drive" && ok "local sign-in signs up and sets the session cookie" || bad "dev login: $R"
DCK=$(echo "$R" | grep -i "set-cookie: tp_cloud_auth=" | sed -E 's/.*tp_cloud_auth=([^;]*).*/\1/' | tr -d '\r')
curl -s -H "Cookie: tp_cloud_auth=$DCK" "$A/api/v1/drive" | grep -q '"items"' && ok "the cookie signs in" || bad "dev cookie"
[ "$(code -X POST --data-urlencode "username=$DU" --data-urlencode "password=wrongpass1" "$A/login")" = "303" ] && curl -s -o /dev/null -w '%{redirect_url}' -X POST --data-urlencode "username=$DU" --data-urlencode "password=wrongpass1" "$A/login" | grep -q "wrong%20password" && ok "wrong password" || bad "dev login wrong password"
LOCR=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST --data-urlencode "username=$DU" --data-urlencode "password=pass12345" --data-urlencode "redirect=//evil.example/" "$A/login")
[ "$LOCR" = "$A/reports" ] && ok "redirect stays on this host" || bad "dev login redirect: $LOCR"
# --- projects and reports ---
P=p-$U
[ "$(code -X POST -H "$H0" -H 'content-type: application/json' -d "{\"slug\":\"$P\",\"name\":\"My app\"}" "$A/api/v1/projects")" = "201" ] && ok "create a project" || bad "create project"
[ "$(code -X POST -H "$H0" -H 'content-type: application/json' -d "{\"slug\":\"$P\"}" "$A/api/v1/projects")" = "409" ] && ok "slug taken -> 409" || bad "slug taken"
[ "$(code -X POST -H "Authorization: Bearer $T2" -H 'content-type: application/json' -d '{"slug":"threepipe-x"}' "$A/api/v1/projects")" = "403" ] && ok "threepipe* slugs are for staff" || bad "threepipe slug"
curl -s -H "$H0" "$A/api/v1/projects" | grep -q "\"$P\"" && ok "list my projects" || bad "list projects"
admin user_limits/insert "{\"values\":{\"user_id\":\"$UID2\",\"projects\":0}}" > /dev/null
[ "$(code -X POST -H "Authorization: Bearer $T2" -H 'content-type: application/json' -d "{\"slug\":\"$P-limited\"}" "$A/api/v1/projects")" = "403" ] && ok "a user's own project limit (user_limits)" || bad "user project limit"
admin user_limits/delete "{\"where\":\"user_id == '$UID2'\"}" > /dev/null
R=$(curl -s -H "$H0" "$A/api/v1/projects/$P"); echo "$R" | grep -q '"role":"manager"' && echo "$R" | grep -q '"discord_webhook":false' && echo "$R" | grep -q "\"owner\":\"$U\"" && ok "a project's settings" || bad "project get: $R"
[ "$(code -H "Authorization: Bearer $T2" "$A/api/v1/projects/$P")" = "404" ] && ok "non-members: no such project" || bad "project get non-member"
curl -s -H "Authorization: Bearer $TS" "$A/api/v1/projects/$P" | grep -q '"role":"manager"' && ok "staff open any project (the reports page's #slug)" || bad "staff project get"
RJ='{"type":"bug","surface":"examples","text":"it broke","email":"me@x.test","log":["GET https://a.test/x?token=abcdefgh12345678 failed","at /Users/jane/app.js:1:2"],"versions":{"threepipe":"0.4.0"}}'
[ "$(code -X POST -H 'content-type: application/json' -H "Idempotency-Key: k-$U-0" -d "$RJ" "$A/api/v1/projects/$P/reports")" = "401" ] && ok "anonymous report without Turnstile -> 401" || bad "no turnstile"
R=$(curl -s -X POST -H 'content-type: application/json' -H "Idempotency-Key: k-$U-1" -H 'cf-turnstile-response: test' -H "Origin: https://files.threepipe.org" -d "$RJ" "$A/api/v1/projects/$P/reports"); RID=$(echo "$R" | j "['id']") && ok "anonymous report with Turnstile -> $RID" || bad "anon report: $R"
R=$(curl -s -X POST -H "Authorization: Bearer $T2" -H 'content-type: application/json' -H "Idempotency-Key: k-$U-2" -d '{"type":"other","surface":"editor","text":"signed in","image":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="}' "$A/api/v1/projects/$P/reports"); RID2=$(echo "$R" | j "['id']") && ok "signed-in report (type other), no Turnstile -> $RID2" || bad "signed-in report: $R"
admin user_limits/insert "{\"values\":{\"user_id\":\"$UID2\",\"reports_daily\":1}}" > /dev/null
[ "$(code -X POST -H "Authorization: Bearer $T2" -H 'content-type: application/json' -H "Idempotency-Key: k-$U-limited" -d "$RJ" "$A/api/v1/projects/$P/reports")" = "429" ] && ok "a user's own daily report cap (user_limits)" || bad "user report cap"
admin user_limits/delete "{\"where\":\"user_id == '$UID2'\"}" > /dev/null
curl -s -X POST -H "Authorization: Bearer $T2" -H 'content-type: application/json' -H "Idempotency-Key: k-$U-2" -d '{"type":"idea","surface":"editor"}' "$A/api/v1/projects/$P/reports" | grep -q '"repeat":true' && ok "same Idempotency-Key -> the same report" || bad "idempotency"
echo "$RJ" > $TMP/report.json
R=$(curl -s -X POST -H "Authorization: Bearer $T2" -H "Idempotency-Key: k-$U-3" -F "report=<$TMP/report.json" -F "file=@$TMP/a.txt;filename=scene.glb" "$A/api/v1/projects/$P/reports"); RID3=$(echo "$R" | j "['id']") && ok "multipart report with a file" || bad "multipart: $R"
[ "$(code -H "Authorization: Bearer $T2" "$A/api/v1/projects/$P/reports")" = "404" ] && ok "non-members cannot read reports" || bad "non-member read"
R=$(curl -s -H "$H0" "$A/api/v1/projects/$P/reports"); [ "$(echo "$R" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['rows']))")" = "3" ] && ok "owner lists 3 reports" || bad "list: $R"
R=$(curl -s -H "$H0" "$A/api/v1/projects/$P/reports/$RID"); echo "$R" | grep -q 'https://a.test/x failed' && echo "$R" | grep -q '/Users/<user>' && ! echo "$R" | grep -q abcdefgh12345678 && ok "log redacted on the server (query strings, home folders)" || bad "redaction: $R"
[ "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H "$H0" "$A/api/v1/projects/$P/reports/$RID2/image")" = "200 image/png" ] && ok "screenshot" || bad "screenshot"
curl -s -D - -o /dev/null -H "$H0" "$A/api/v1/projects/$P/reports/$RID3/files/0" | grep -qi 'attachment; filename="scene.glb"' && ok "attached file download" || bad "file download"
curl -s -o /dev/null -X POST -H "$H0" -H 'content-type: application/json' -d "{\"username\":\"$U2\",\"role\":\"reader\"}" "$A/api/v1/projects/$P/members"
[ "$(code -H "Authorization: Bearer $T2" "$A/api/v1/projects/$P/reports")" = "200" ] && ok "reader lists reports" || bad "reader list"
[ "$(code -X PATCH -H "Authorization: Bearer $T2" -H 'content-type: application/json' -d '{"status":"closed"}' "$A/api/v1/projects/$P/reports/$RID")" = "403" ] && ok "reader cannot change a report" || bad "reader patch"
curl -s -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"status":"in_progress","note":"looking"}' "$A/api/v1/projects/$P/reports/$RID" | grep -q "\"status_by\":\"$U\"" && ok "manager sets status" || bad "manager patch"
curl -s -X DELETE -H "$H0" "$A/api/v1/projects/$P/reports/$RID2" | grep -q deleted_at && [ "$(code -H "$H0" "$A/api/v1/projects/$P/reports/$RID2/image")" = "404" ] && ok "delete a report (tombstone)" || bad "delete report"
[ "$(code -H "$H0" "$A/api/v1/projects/p-none-$U/reports")" = "404" ] && ok "unknown project -> 404" || bad "unknown project"
curl -sI "$A/reports" | grep -qi "content-security-policy: default-src 'none'; script-src 'self'" && [ "$(code "$A/reports/page.js")" = "200" ] && ok "reports page" || bad "reports page"
echo "failures: $FAILS"
[ $FAILS -eq 0 ]
