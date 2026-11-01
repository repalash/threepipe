/* The drive page: the signed-in user's folders and items, from /api/v1/drive (src/drive.ts), with the session cookie.
   The URL hash is the folder id (none: the top). Names are user input: every one goes through esc(), and the page binds
   events by data attributes, never with an API string in a handler. */
'use strict'
const S = {folder: '', data: null, err: '', item: null, busy: ''}
const el = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const idOf = s => /^[\w-]{1,64}$/.test(String(s || '')) ? String(s) : ''
const bytes = n => { n = Number(n) || 0; return n < 1e3 ? n + ' B' : n < 1e6 ? Math.round(n / 1e3) + ' KB' : n < 1e9 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e9).toFixed(2) + ' GB' }
const stamp = s => { const t = Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')); return isNaN(t) ? '' : new Date(t).toLocaleString() }

/* ---------- the API (same origin, the session cookie) ---------- */
async function api(path, init) {
    const r = await fetch('/api/v1/drive' + path, {...init, credentials: 'same-origin'})
    if (r.status === 401) { signedOut(); throw new Error('signed out') }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status))
    return j
}
const send = (method, path, body) => api(path, {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body || {})})
const status = s => { el('status').textContent = s || '' }

function signedOut() {
    el('app').hidden = true; el('login').hidden = false
    fetch('/login', {method: 'HEAD'}).then(r => { el('devLogin').hidden = !r.ok }).catch(() => undefined)
}
async function logout() {
    await fetch('/api/v1/table/users/auth/logout', {method: 'POST', credentials: 'same-origin'}).catch(() => undefined)
    signedOut()
}

/* ---------- the folder ---------- */
async function load() {
    S.folder = idOf(decodeURIComponent(location.hash.slice(1)))
    try {
        S.data = await api('?folder=' + encodeURIComponent(S.folder)); S.err = ''
        el('login').hidden = true; el('app').hidden = false
    } catch (e) { if (e.message === 'signed out') return; S.data = null; S.err = e.message }
    if (S.item && !S.data?.items.some(i => i.id === S.item.id)) S.item = null
    render(); if (S.item) openItem(S.item.id)
}
function render() {
    const d = S.data
    if (!d) { el('list').innerHTML = '<p class="err">' + esc(S.err || 'Reading…') + '</p>'; return }
    const crumbs = '<a data-go="">Drive</a>' + d.path.map(f => ' / <a data-go="' + esc(idOf(f.id)) + '">' + esc(f.name) + '</a>').join('')
    const folders = d.folders.map(f => '<div class="row" data-go="' + esc(idOf(f.id)) + '"><span class="icon">▸</span><div class="main"><div class="t">' + esc(f.name) + '</div></div>'
        + '<span class="actions"><button data-rename-folder="' + esc(idOf(f.id)) + '">Rename</button><button data-move-folder="' + esc(idOf(f.id)) + '">Move</button><button data-delete-folder="' + esc(idOf(f.id)) + '">Delete</button></span></div>').join('')
    const items = d.items.map(i => '<div class="row' + (S.item && S.item.id === i.id ? ' on' : '') + '" data-item="' + esc(idOf(i.id)) + '"><span class="icon">' + (i.files_count > 1 ? '▣' : '▢') + '</span>'
        + '<div class="main"><div class="t">' + esc(i.name) + '</div><div class="sub">' + esc(bytes(i.size)) + (i.files_count > 1 ? ' · ' + i.files_count + ' files' : '') + ' · ' + esc(stamp(i.updated)) + '</div></div>'
        + '<span class="pill' + (i.visibility === 'link' ? ' link' : '') + '">' + (i.visibility === 'link' ? 'anyone with the link' : 'private') + '</span></div>').join('')
    el('list').innerHTML = '<p class="crumbs">' + crumbs + '</p>' + (folders + items || '<p class="meta">Empty. Upload files, or drop them here.</p>')
}

/* ---------- one item, in the drawer ---------- */
async function openItem(id) {
    id = idOf(id); if (!id) return
    try { S.item = await api('/items/' + encodeURIComponent(id)) } catch (e) { alert(e.message); return }
    render(); drawItem()
}
function drawItem() {
    const i = S.item
    if (!i) { el('drawer').innerHTML = ''; return }
    const kv = (k, v) => '<div class="kv"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>'
    el('drawer').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;overflow-wrap:anywhere">' + esc(i.name) + '</h2><button data-close>✕</button></div>'
        + '<div class="box"><h3>Sharing</h3><p>' + (i.visibility === 'link'
            ? '<span class="pill link">Anyone with the link</span> can open it. <button data-visibility="private">Make private</button>'
            : '<span class="pill">Private</span>: only you, and links you sign. <button data-visibility="link">Share: anyone with the link</button>') + '</p>'
        + '<div class="actions"><button data-copy-link>' + (i.visibility === 'link' ? 'Copy link' : 'Copy a link for 1 day') + '</button><button data-open-entry>Open</button>'
        + '<button data-new-id title="Copies the item under a new id: every link given out before stops working">New link</button></div></div>'
        + '<div class="box"><h3>Item</h3>' + kv('Size', bytes(i.size)) + kv('Files', i.files_count) + kv('Opens', i.entry || '') + kv('Created', stamp(i.created)) + kv('Changed', stamp(i.updated))
        + '<div class="actions" style="margin-top:6px"><button data-rename-item>Rename</button><button data-move-item>Move</button><button data-delete-item style="color:var(--lost)">Delete</button></div></div>'
        + '<div class="box"><h3>Files</h3>' + (i.files || []).map((f, n) => '<div class="kv"><b>' + esc(bytes(f.size)) + '</b><span><a href="#" data-file="' + n + '">' + esc(f.path) + '</a></span></div>').join('') + '</div>'
}
/* a URL that opens the item's file `path`: the item URL when shared, else signed (`ttl` seconds) */
async function fileUrl(path, ttl) {
    const i = S.item
    if (i.visibility === 'link') return i.url.slice(0, i.url.indexOf('/' + i.id + '/') + i.id.length + 2) + path.split('/').map(encodeURIComponent).join('/')
    const {url} = await send('POST', '/items/' + encodeURIComponent(i.id) + '/sign', {ttl})
    return url + path.split('/').map(encodeURIComponent).join('/')
}

/* ---------- changes ---------- */
async function act(label, f) {
    status(label + '…')
    try { await f(); status('') } catch (e) { status(''); if (e.message !== 'signed out') alert(label + ' failed: ' + e.message) }
    await load()
}
/* a folder id for a path typed by the user ('/' or '' is the top) */
async function folderAt(path) {
    const r = await api('/resolve?path=' + encodeURIComponent(path))
    if (!r.folder) throw new Error(path + ' is not a folder')
    return r.folder.id
}
const ask = (q, v) => { const a = prompt(q, v); return a === null ? null : a.trim() }

async function upload(files, asFolder) {
    files = [...files].filter(f => !f.webkitRelativePath.split('/').some(p => p.startsWith('.') || p === 'node_modules'))
    if (!files.length) return
    if (asFolder) {
        const top = files[0].webkitRelativePath.split('/')[0]
        const rel = f => f.webkitRelativePath.split('/').slice(1).join('/')
        const entry = (files.find(f => /^index\.html?$/i.test(rel(f))) || files.find(f => /\.(gltf|glb)$/i.test(rel(f))) || files[0])
        const item = await send('POST', '/items', {name: top, folder: S.folder, entry: rel(entry)})
        let n = 0
        for (const f of files) { status('Uploading ' + (++n) + ' / ' + files.length); await api('/items/' + encodeURIComponent(item.id) + '/' + rel(f).split('/').map(encodeURIComponent).join('/'), {method: 'PUT', body: f}) }
    } else {
        let n = 0
        for (const f of files) { status('Uploading ' + (++n) + ' / ' + files.length); await api('/files?folder=' + encodeURIComponent(S.folder) + '&name=' + encodeURIComponent(f.name), {method: 'PUT', body: f}) }
    }
}

document.addEventListener('click', e => {
    const t = e.target.closest('button,[data-go],[data-item],a[data-file]')
    if (!t) return
    const d = t.dataset
    if (t.matches('button')) e.stopPropagation()
    if ('signout' in d) logout()
    else if ('newFolder' in d) { const n = ask('New folder name'); if (n) act('Creating the folder', () => send('POST', '/folders', {name: n, parent: S.folder})) }
    else if ('uploadFiles' in d) el('files').click()
    else if ('uploadFolder' in d) el('folder').click()
    else if ('renameFolder' in d) { const f = S.data.folders.find(x => x.id === d.renameFolder); const n = f && ask('Rename the folder', f.name); if (n) act('Renaming', () => send('PATCH', '/folders/' + encodeURIComponent(f.id), {name: n})) }
    else if ('moveFolder' in d) { const p = ask('Move into the folder at this path (/ is the top)', '/'); if (p !== null) act('Moving', async() => send('PATCH', '/folders/' + encodeURIComponent(idOf(d.moveFolder)), {parent: await folderAt(p)})) }
    else if ('deleteFolder' in d) { if (confirm('Delete this empty folder?')) act('Deleting', () => send('DELETE', '/folders/' + encodeURIComponent(idOf(d.deleteFolder)))) }
    else if ('go' in d) { location.hash = idOf(d.go) ? '#' + idOf(d.go) : '' }
    else if ('item' in d) openItem(d.item)
    else if ('close' in d) { S.item = null; drawItem(); render() }
    else if ('visibility' in d) act('Changing who can open it', () => send('PATCH', '/items/' + encodeURIComponent(S.item.id), {visibility: d.visibility === 'link' ? 'link' : 'private'}))
    else if ('copyLink' in d) fileUrl(S.item.entry || '', 86400).then(u => navigator.clipboard.writeText(u)).then(() => status('Link copied'), err => alert(err.message))
    else if ('openEntry' in d) fileUrl(S.item.entry || '', 3600).then(u => window.open(u, '_blank', 'noopener'), err => alert(err.message))
    else if ('file' in d) { e.preventDefault(); const f = S.item.files[Number(d.file)]; if (f) fileUrl(f.path, 3600).then(u => window.open(u, '_blank', 'noopener')) }
    else if ('newId' in d) { if (confirm('Give the item a new link? Every link to it given out before stops working.')) act('Making a new link', async() => { S.item = await send('POST', '/items/' + encodeURIComponent(S.item.id) + '/new-id') }) }
    else if ('renameItem' in d) { const n = ask('Rename (the link keeps its first name)', S.item.name); if (n) act('Renaming', () => send('PATCH', '/items/' + encodeURIComponent(S.item.id), {name: n})) }
    else if ('moveItem' in d) { const p = ask('Move into the folder at this path (/ is the top)', '/'); if (p !== null) act('Moving', async() => send('PATCH', '/items/' + encodeURIComponent(S.item.id), {folder: await folderAt(p)})) }
    else if ('deleteItem' in d) { if (confirm('Delete "' + S.item.name + '" and its ' + S.item.files_count + ' file(s) for good?')) act('Deleting', async() => { await send('DELETE', '/items/' + encodeURIComponent(S.item.id)); S.item = null; drawItem() }) }
})
el('files').addEventListener('change', e => { const f = e.target.files; act('Uploading', () => upload(f, false)); e.target.value = '' })
el('folder').addEventListener('change', e => { const f = e.target.files; act('Uploading', () => upload(f, true)); e.target.value = '' })
const list = el('list')
list.addEventListener('dragover', e => { e.preventDefault(); list.classList.add('drop') })
list.addEventListener('dragleave', () => list.classList.remove('drop'))
list.addEventListener('drop', e => { e.preventDefault(); list.classList.remove('drop'); const f = e.dataTransfer.files; if (f.length) act('Uploading', () => upload(f, false)) })
window.addEventListener('hashchange', load)
load()
