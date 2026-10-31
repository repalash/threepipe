import type {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {CloudEnv} from './env'
import {apiOrigin, filesOrigin, jsonBody, randomCode, sha256Hex} from './env'
import {mintKey, requireUser} from './auth'
import {ACCESS_KEY_SECONDS, BUILD_DAYS, DAY, LABEL_MAX, SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS, sizeText, UPLOAD_MAX_BYTES} from './limits'

/**
 * Access links: a signed-in user creates one per agent/machine and copies its URL. The agent reads agents.md from it,
 * which says where to get the key. The key is the user's JWT with `meta.link`; deleting the link revokes it (src/auth.ts).
 *
 *   POST   /api/v1/access-links {name?}   → {id, name, url}         (signed in, not with a key)
 *   GET    /api/v1/access-links           → {links}: agents' links and the apps you connected (src/connect.ts)
 *   DELETE /api/v1/access-links/<id>      revokes it: its keys stop working at once
 *   GET  /api/v1/access/<code>/agents.md                              (the code is the credential)
 *   GET  /api/v1/access/<code>/key      → the key, text/plain
 *
 * The /account page lists and revokes them. (teenybase's /api/v1/table/access_links/… works too, owner only.)
 */
export function accessRoutes(app: Hono<CloudEnv>) {
    app.post('/api/v1/access-links', async (c) => {
        const user = await requireUser(c)
        if (user.link) throw new HTTPException(403, {message: 'an access key cannot create access links'})
        const body = await jsonBody<{name?: unknown}>(c)
        const name = typeof body.name === 'string' ? body.name.slice(0, LABEL_MAX) : ''
        const code = randomCode()
        const id = crypto.randomUUID()
        await c.env.PRIMARY_DB.prepare('INSERT INTO access_links (id, owner_id, name, code_hash) VALUES (?, ?, ?, ?)')
            .bind(id, user.id, name, await sha256Hex(code)).run()
        return c.json({id, name, url: `${apiOrigin(c)}/api/v1/access/${code}/agents.md`})
    })

    app.get('/api/v1/access-links', async (c) => {
        const user = await requireUser(c)
        if (user.link) throw new HTTPException(403, {message: 'an access key cannot list access links'})
        const {results} = await c.env.PRIMARY_DB.prepare(`SELECT l.id, l.name, l.app, l.scope, l.created, l.last_used, o.username AS app_owner, f.name AS folder_name
                FROM access_links l LEFT JOIN users o ON o.id = l.app_owner LEFT JOIN drive_folders f ON f.id = l.scope AND f.owner_id = l.owner_id
                WHERE l.owner_id = ? ORDER BY l.created DESC`).bind(user.id)
            .all<{id: string, name: string | null, app: string | null, scope: string | null, created: string, last_used: string | null, app_owner: string | null, folder_name: string | null}>()
        return c.json({links: results.map(l => ({id: l.id, name: l.name || '', created: l.created, last_used: l.last_used,
            ...l.app ? {app: l.app, app_owner: l.app_owner, access: l.scope === '*' ? 'drive' : 'folder', folder: l.scope === '*' ? null : {id: l.scope, name: l.folder_name}} : {}}))})
    })

    app.delete('/api/v1/access-links/:id', async (c) => {
        const user = await requireUser(c)
        if (user.link) throw new HTTPException(403, {message: 'an access key cannot revoke access links'})
        const r = await c.env.PRIMARY_DB.prepare('DELETE FROM access_links WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), user.id).run()
        if (!r.meta.changes) throw new HTTPException(404, {message: 'no such access link'})
        return c.json({deleted: c.req.param('id')})
    })

    app.get('/api/v1/access/:code/agents.md', async (c) => {
        const link = await findLink(c.env, c.req.param('code'))
        const origin = apiOrigin(c)
        return c.text(agentsMd(origin, filesOrigin(c.env, origin), c.req.param('code'), link.username), 200, {
            'content-type': 'text/markdown; charset=utf-8',
            'cache-control': 'no-store',
        })
    })

    app.get('/api/v1/access/:code/key', async (c) => {
        const link = await findLink(c.env, c.req.param('code'))
        const key = await mintKey(c, {id: link.owner_id, email: link.email}, link.id, ACCESS_KEY_SECONDS)
        return c.text(key, 200, {'cache-control': 'no-store'})
    })
}

async function findLink(env: CloudflareBindings, code: string) {
    const link = await env.PRIMARY_DB.prepare(`SELECT l.id, l.owner_id, u.email, u.username FROM access_links l JOIN users u ON u.id = l.owner_id WHERE l.code_hash = ? AND l.app IS NULL`)
        .bind(await sha256Hex(code)).first<{id: string, owner_id: string, email: string, username: string}>()
    if (!link) throw new HTTPException(404, {message: 'unknown or revoked access link'})
    return link
}

function agentsMd(api: string, files: string, code: string, username: string): string {
    return `# threepipe cloud

Download your key from ${api}/api/v1/access/${code}/key and save it as \`TP_CLOUD_KEY=<key>\` in \`/tmp/.env\`. Send it with every request as \`Authorization: Bearer $TP_CLOUD_KEY\`. The key acts as the user \`${username}\` and is valid for ${ACCESS_KEY_SECONDS / DAY} days; fetch it again from the same URL when it expires.

## Upload a file

\`PUT ${api}/api/v1/uploads/<prefix>/<path>\` with the file as the request body (max ${sizeText(UPLOAD_MAX_BYTES)} per file). Upload a folder as one PUT per file. The answer is JSON with the public \`url\`.

| prefix | for | lifetime | overwrite | path |
|---|---|---|---|---|
| \`s\` | temporary shares | ${SHARE_DEFAULT_DAYS} days, \`?ttl=<days>\` up to ${SHARE_MAX_DAYS} | yes, owner | \`s/<slug>/<file path>\` |
| \`a\` | permanent assets (docs images, videos) | permanent | never | \`a/<file name>\`, send \`x-content-sha256: <hex sha256 of the file>\` |
| \`b\` | builds and previews of a PR or commit | ${BUILD_DAYS} days after the last upload | yes, owner | \`b/<repo>/<pr-123 or sha>/<file path>\` |
| \`p\` | permanent named pages | permanent | yes, owner | \`p/<name>/<file path>\` |

The first part of the path after \`s\`, \`p\` (and \`<repo>/<ref>\` after \`b\`) belongs to whoever uploads there first.
Files are served at \`${files}/<prefix>/<path>\`; a folder URL ending in \`/\` serves its \`index.html\`.

\`\`\`bash
set -a; . /tmp/.env; set +a
curl -sS -X PUT -H "Authorization: Bearer $TP_CLOUD_KEY" --data-binary @render.png ${api}/api/v1/uploads/s/my-render/render.png
curl -sS -X PUT -H "Authorization: Bearer $TP_CLOUD_KEY" -H "x-content-sha256: $(sha256sum diagram.png | cut -d' ' -f1)" --data-binary @diagram.png ${api}/api/v1/uploads/a/diagram.png
\`\`\`

## Delete a file

\`DELETE ${api}/api/v1/uploads/<prefix>/<path>\` (your own \`s\`, \`b\`, \`p\` files).

## Drive

Your own files, private unless you share them (quota). Each upload is an **item** (a file, or a folder of files that belong together) with a fixed id; folders and names are labels you can change.

- Save a file: \`PUT ${api}/api/v1/drive/files?name=<name>&folder=<folder id>\` with the file as the body (no folder: the top). The answer is the item.
- A folder of files (a .gltf with its .bin and textures): \`POST ${api}/api/v1/drive/items\` \`{"name": "lamp", "entry": "lamp.gltf"}\`, then \`PUT ${api}/api/v1/drive/items/<id>/<relative path>\` for each file.
- List: \`GET ${api}/api/v1/drive?folder=<id>\`. By path: \`GET ${api}/api/v1/drive/resolve?path=/folder/name\`. New folder: \`POST ${api}/api/v1/drive/folders\` \`{"name", "parent"}\`.
- Rename, move, share: \`PATCH ${api}/api/v1/drive/items/<id>\` \`{"name"?, "folder"?, "visibility": "link" | "private"}\`. With \`link\`, the item's \`url\` works for anyone.
- Read a private item: \`POST ${api}/api/v1/drive/items/<id>/sign\` \`{"ttl": <seconds>}\` gives a URL ending in \`/\`; add the file path (relative files load too).
- Delete: \`DELETE ${api}/api/v1/drive/items/<id>\`. New id (old URLs stop working): \`POST ${api}/api/v1/drive/items/<id>/new-id\`.

## Your files

\`GET ${api}/api/v1/table/files/select?select=path,size,expires_at&where=deleted_at%20%3D%3D%20null\` (drive items: \`GET ${api}/api/v1/drive\`)
`
}
