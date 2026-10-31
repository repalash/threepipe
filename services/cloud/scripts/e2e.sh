#!/bin/bash
# End-to-end test of the local worker: sign-up, access link, agents.md, key, uploads (s a b p), serving, ownership,
# deletes, staff removal, expiry (cron), revoking, the drive (d/, signed URLs, share links, quota) and app sign-in (connect). Starts `teeny dev` (port 8787) and stops it at the end.
# Usage: npm test
set -u
cd "$(dirname "$0")/.."
A=http://127.0.0.1:8787
TMP=$(mktemp -d)
PERSIST=.local-persist
j() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
ok() { echo "OK   $1"; }; bad() { echo "FAIL $1"; FAILS=$((FAILS+1)); }; FAILS=0
d1() { npx wrangler d1 execute threepipe-cloud --local --persist-to $PERSIST "$@" 2>/dev/null; }

if curl -s -o /dev/null "$A/api/v1/health"; then echo "port 8787 is in use: stop the other dev server first"; exit 1; fi
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
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
MD=$(curl -s "$URL"); echo "$MD" | head -1 | grep -q "threepipe cloud" && ok "agents.md" || bad "agents.md: $MD"
KEYURL=$(echo "$MD" | grep -o "http[^ ]*/key" | head -1)
KEY=$(curl -s "$KEYURL"); [ ${#KEY} -gt 50 ] && ok "key (${#KEY} chars)" || bad "key: $KEY"
H="Authorization: Bearer $KEY"
echo "hello share" > $TMP/a.txt
R=$(curl -s -X PUT -H "$H" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-share/a.txt"); SURL=$(echo "$R" | j "['url']") && ok "upload s/ -> $SURL" || bad "upload s/: $R"
[ "$(curl -s "$SURL")" = "hello share" ] && ok "serve s/" || bad "serve s/"
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
d1 --command "UPDATE users SET role='staff' WHERE username='$STAFF'" > /dev/null
R=$(curl -s -X DELETE -H "Authorization: Bearer $TS" "$A/api/v1/uploads/${AURL#*/_files/}?reason=copyright"); echo "$R" | grep -q copyright && ok "staff removes a/" || bad "staff delete: $R"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$AURL")" = "410" ] && ok "removed a/ -> 410" || bad "removed a/ status"
# expiry: backdate the b/ build, run the cron
d1 --command "UPDATE files SET expires_at='2000-01-01T00:00:00.000Z' WHERE path LIKE 'b/threepipe/pr-$U/%'" > /dev/null
curl -s -o /dev/null "$A/cdn-cgi/handler/scheduled?cron=17+3+*+*+*"; sleep 1
[ "$(curl -s -o /dev/null -w '%{http_code}' "$A/_files/b/threepipe/pr-$U/examples/a.txt")" = "404" ] && ok "cron deletes expired build" || bad "cron"
# --- drive ---
H0="Authorization: Bearer $TOK"
UID1=$(echo "$SIGN" | j "['record']['id']")
echo '{"asset":{"version":"2.0"}}' > $TMP/scene.gltf; echo "bin" > $TMP/scene.bin
R=$(curl -s -X PUT -H "$H0" --data-binary @$TMP/scene.gltf "$A/api/v1/uploads/d/$U/proj/scene.gltf"); echo "$R" | grep -q '"visibility":"private"' && ok "drive upload, private by default" || bad "drive upload: $R"
curl -s -o /dev/null -X PUT -H "$H0" --data-binary @$TMP/scene.bin "$A/api/v1/uploads/d/$U/proj/scene.bin"
[ "$(code "$A/_files/d/$U/proj/scene.gltf")" = "404" ] && ok "private drive file is not served" || bad "private drive file served"
[ "$(code -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/uploads/d/$U2/x.txt")" = "403" ] && ok "cannot write another user's drive" || bad "other drive write"
[ "$(code -X POST -H "$H0" -H 'content-type: application/json' -d "{\"username\":\"$U-new\"}" "$A/api/v1/table/users/edit/$UID1")" != "200" ] && ok "username cannot change" || bad "username changed"
curl -s -H "$H0" "$A/api/v1/uploads/d/$U/proj/scene.gltf" | grep -q asset && ok "owner reads drive file through the API" || bad "drive API read"
R=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"path\":\"d/$U/proj/\"}" "$A/api/v1/drive/sign"); FS=$(echo "$R" | j "['url']") || bad "sign folder: $R"
[ "$(curl -s "${FS}scene.bin")" = "bin" ] && curl -s "${FS}scene.gltf" | grep -q asset && ok "signed folder URL serves the folder (relative links work)" || bad "signed folder: $FS"
R=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"path\":\"d/$U/proj/scene.gltf\"}" "$A/api/v1/drive/sign"); FF=$(echo "$R" | j "['url']")
[ "$(code "$FF")" = "200" ] && [ "$(code "${FF%scene.gltf}scene.bin")" = "403" ] && ok "signed file URL serves only that file" || bad "signed file: $FF"
TAMPER=$(echo "$FS" | sed -E 's#(/t/[0-9]+\.[0-9]+\.)[A-Za-z0-9_-]#\1x#')
[ "$(code "${TAMPER}scene.bin")" = "403" ] && ok "tampered signature -> 403" || bad "tampered: $TAMPER"
curl -s -o /dev/null -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"visibility":"public"}' "$A/api/v1/uploads/d/$U/proj/scene.gltf"
[ "$(code "$A/_files/d/$U/proj/scene.gltf")" = "200" ] && ok "public drive file served at its path" || bad "public drive file"
curl -s -o /dev/null -X PATCH -H "$H0" -H 'content-type: application/json' -d '{"visibility":"private"}' "$A/api/v1/uploads/d/$U/proj/scene.gltf"
[ "$(code "$A/_files/d/$U/proj/scene.gltf")" = "404" ] && ok "private again" || bad "private again"
R=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"path\":\"d/$U/proj/\"}" "$A/api/v1/drive-links"); FL=$(echo "$R" | j "['url']"); FLID=$(echo "$R" | j "['id']")
[ "$(curl -s "${FL}scene.bin")" = "bin" ] && ok "folder share link" || bad "folder share link: $R"
R=$(curl -s -X POST -H "$H0" -H 'content-type: application/json' -d "{\"path\":\"d/$U/proj/scene.gltf\"}" "$A/api/v1/drive-links"); FL2=$(echo "$R" | j "['url']")
case "$FL2" in *scene.gltf) [ "$(code "$FL2")" = "200" ] && ok "file share link ends with the file name" || bad "file link: $FL2";; *) bad "file link url: $R";; esac
curl -s -o /dev/null -X DELETE -H "$H0" "$A/api/v1/drive-links/$FLID"
[ "$(code "${FL}scene.bin")" = "404" ] && ok "deleted share link -> 404" || bad "deleted share link"
R=$(curl -s -X PATCH -H "$H0" -H 'content-type: application/json' -d "{\"move_to\":\"d/$U/proj2/scene.gltf\"}" "$A/api/v1/uploads/d/$U/proj/scene.gltf")
[ "$(code -H "$H0" "$A/api/v1/uploads/d/$U/proj/scene.gltf")" = "404" ] && curl -s -H "$H0" "$A/api/v1/uploads/d/$U/proj2/scene.gltf" | grep -q asset && ok "move a drive file" || bad "move: $R"
curl -s -H "$H0" "$A/api/v1/drive" | grep -q "d/$U/proj2/scene.gltf" && ok "list the drive" || bad "list drive"
d1 --command "INSERT INTO files (id, owner_id, bucket, prefix, path, size) VALUES ('q$U', '$UID1', 'cloud', 'd', 'd/$U/big', 1073741824)" > /dev/null
[ "$(code -X PUT -H "$H0" --data-binary @$TMP/a.txt "$A/api/v1/uploads/d/$U/over.txt")" = "413" ] && ok "drive quota -> 413" || bad "quota"
d1 --command "DELETE FROM files WHERE id = 'q$U'" > /dev/null
[ "$(code -X DELETE -H "$H0" "$A/api/v1/uploads/d/$U/proj/scene.bin")" = "200" ] && [ "$(code -H "$H0" "$A/api/v1/uploads/d/$U/proj/scene.bin")" = "404" ] && ok "delete a drive file" || bad "drive delete"

# --- app sign-in (connect) ---
CK="Cookie: tp_cloud_auth=$TOK"
APP="$A/_files/p/$U-page/index.html"
CON="$A/api/v1/connect?return=$(enc "$APP")"
curl -s "$CON" | grep -q "Sign in with GitHub" && ok "connect: signed out -> sign-in page" || bad "connect signed out"
curl -s -H "$CK" "$CON" | grep -q "Connect p/$U-page" && ok "connect: consent page" || bad "connect consent"
[ "$(code -X POST -H "$CK" --data-urlencode "return=$APP" "$A/api/v1/connect")" = "403" ] && ok "connect: cookie post without our Origin -> 403" || bad "connect csrf"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -X POST -H "$CK" -H "Origin: $A" --data-urlencode "return=$APP" "$A/api/v1/connect")
AK=$(python3 -c "import sys,urllib.parse as u;print(u.parse_qs(sys.argv[1].split('#',1)[1])['tp_cloud_key'][0])" "$LOC" 2>/dev/null) && ok "connect: approve -> back to the app with a key" || bad "connect approve: $LOC"
echo "$LOC" | grep -q "tp_cloud_folder=d%2F$U%2Fapps%2F$U%2Fp%2F$U-page%2F" && ok "connect: folder d/$U/apps/$U/p/$U-page/" || bad "connect folder: $LOC"
HA="Authorization: Bearer $AK"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/d/$U/apps/$U/p/$U-page/save.txt")" = "200" ] && ok "app key writes its folder" || bad "app key write"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/d/$U/other.txt")" = "403" ] && ok "app key: rest of the drive -> 403" || bad "app key outside folder"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/s/$U-app/a.txt")" = "403" ] && ok "app key: s/ -> 403" || bad "app key s/"
[ "$(code -H "$HA" "$A/api/v1/table/files/select")" = "403" ] && ok "app key: teenybase routes -> 403" || bad "app key teenybase"
[ "$(code -X POST -H "$HA" "$A/api/v1/access-links")" = "403" ] && ok "app key: no access links" || bad "app key access links"
R=$(curl -s -H "$HA" "$A/api/v1/drive"); echo "$R" | grep -q save.txt && ! echo "$R" | grep -q proj2 && ok "app key lists only its folder" || bad "app key list: $R"
LOC2=$(curl -s -o /dev/null -w '%{redirect_url}' -H "$CK" "$CON"); echo "$LOC2" | grep -q "#tp_cloud_key=" && ok "connect: approved before -> straight back with a key" || bad "connect silent: $LOC2"
d1 --command "UPDATE files SET owner_id = (SELECT id FROM users WHERE username = '$U2') WHERE path LIKE 'p/$U-page/%'" > /dev/null
curl -s -H "$CK" "$CON" | grep -q "@$U2" && ok "connect: app with a new owner -> consent again" || bad "connect new owner"
d1 --command "UPDATE files SET owner_id = '$UID1' WHERE path LIKE 'p/$U-page/%'" > /dev/null
[ "$(code -H "$CK" "$A/api/v1/connect?return=$(enc "$A/_files/p/none-$U/")")" = "400" ] && ok "connect: unknown app -> 400" || bad "connect unknown app"
[ "$(code -H "$CK" "$A/api/v1/connect?return=$(enc "https://example.com/app/")")" = "400" ] && ok "connect: other sites -> 400" || bad "connect other site"
curl -s -H "$CK" "$A/api/v1/connect?return=$(enc "http://localhost:5173/")" | grep -q "localhost/5173" && ok "connect: localhost app folder" || bad "connect localhost"
curl -s -o /dev/null -X POST -H "$H0" -H 'content-type: application/json' -d "{\"where\":\"app == 'p/$U-page'\"}" "$A/api/v1/table/access_links/delete"
[ "$(code -X PUT -H "$HA" --data-binary @$TMP/a.txt "$A/api/v1/uploads/d/$U/apps/$U/p/$U-page/save.txt")" = "401" ] && ok "revoked app -> 401" || bad "revoked app"
echo "failures: $FAILS"
[ $FAILS -eq 0 ]
