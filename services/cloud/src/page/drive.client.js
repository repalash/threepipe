/* The drive page: the signed-in user's folders and items, from /api/v1/drive (src/drive.ts), with the session cookie.
   The URL hash is the folder id (none: the top). Names are user input: every one goes through esc(), and the page binds
   events by data attributes, never with an API string in a handler. Shared parts (side bar, dialogs, icons): ui.client.js.
   Loaded as a module: its names stay out of window (a top-level function open() would replace window.open). */
'use strict'
const {el, esc, bytes, icon, toast, stamp, short} = UI
/* `sel`: the selected row, {kind: 'folder' | 'item', id}; `item`: the selected item as GET /items/<id> gives it (with its
   files); `inside`: what the selected folder holds. One click selects and shows it in the panel, a double click opens. */
const S = {folder: '', data: null, err: '', sel: null, item: null, inside: null}
const idOf = s => /^[\w-]{1,64}$/.test(String(s || '')) ? String(s) : ''

/* ---------- the API (same origin, the session cookie) ---------- */
async function api(path, init) {
    const r = await fetch('/api/v1/drive' + path, {...init, credentials: 'same-origin'})
    if (r.status === 401) { signedOut(); throw new Error('signed out') }
    const j = await r.json().catch(() => ({}))
    if (UI.handleGate(r.status, j)) throw new Error('signed out')
    if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status))
    return j
}
const send = (method, path, body) => api(path, {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body || {})})
const status = s => { el('status').textContent = s || '' }

function signedOut() {
    el('app').hidden = true; el('login').hidden = false
    UI.login(el('login'), {title: 'Sign in to your drive', text: 'Your files on threepipe cloud: what you and your apps saved.', redirect: '/drive'})
}

/* ---------- the folder ---------- */
let sideDone = false
async function load() {
    S.folder = idOf(decodeURIComponent(location.hash.slice(1)))
    try {
        S.data = await api('?folder=' + encodeURIComponent(S.folder)); S.err = ''
        el('login').hidden = true; el('app').hidden = false
    } catch (e) { if (e.message === 'signed out') return; S.data = null; S.err = e.message }
    const there = S.sel && S.data && (S.sel.kind === 'item' ? S.data.items : S.data.folders).some(x => x.id === S.sel.id)
    if (!there) { S.sel = null; S.item = null; S.inside = null }
    UI.side('drive', '', sideDone); sideDone = true
    render(); if (S.sel) selectRow(S.sel.kind, S.sel.id); else drawPanel()
}
function render() {
    const d = S.data
    if (!d) { el('crumbs').innerHTML = '<a data-go="">Drive</a>'; el('list').innerHTML = '<div class="empty"><p class="err">' + esc(S.err || 'Reading…') + '</p></div>'; return }
    el('crumbs').innerHTML = '<a data-go="">Drive</a>' + d.path.map(f => '<span class="sep">/</span><a data-go="' + esc(idOf(f.id)) + '">' + esc(f.name) + '</a>').join('')
    if (!d.folders.length && !d.items.length) {
        el('list').innerHTML = '<div class="empty"><span class="big">' + icon('upload') + '</span><b>' + (d.path.length ? 'This folder is empty' : 'Your drive is empty') + '</b>'
            + '<span>Drop files here, or</span><span class="row"><button data-upload-files class="primary">' + icon('upload') + 'Upload files</button><button data-new-folder>' + icon('folderPlus') + 'New folder</button></span></div>'
        return
    }
    const on = (kind, id) => S.sel && S.sel.kind === kind && S.sel.id === id ? ' on' : ''
    const folders = d.folders.map(f => { const id = idOf(f.id)
        return '<tr class="' + on('folder', f.id) + '" data-folder="' + esc(id) + '" tabindex="0"><td><div class="name"><span class="ft folder">' + icon('folder') + '</span><div><div class="t">' + esc(f.name) + '</div></div></div></td>'
        + '<td class="hide-sm">—</td><td class="hide-sm"></td><td></td></tr>' }).join('')
    const items = d.items.map(i => { const id = idOf(i.id), shared = i.visibility === 'link'
        return '<tr class="' + on('item', i.id) + '" data-item="' + esc(id) + '" tabindex="0"><td><div class="name"><span class="ft">' + icon(i.files_count > 1 ? 'cube' : 'file') + '</span>'
        + '<div><div class="t">' + esc(i.name) + '</div>' + (i.files_count > 1 ? '<div class="s">' + Number(i.files_count) + ' files</div>' : '') + '</div></div></td>'
        + '<td class="hide-sm">' + esc(bytes(i.size)) + '</td><td class="hide-sm" title="' + esc(stamp(i.updated)) + '">' + esc(short(i.updated)) + '</td>'
        + '<td>' + (shared ? '<span class="pill accent">' + icon('globe') + 'Link</span>' : '<span class="pill">' + icon('lock') + 'Private</span>') + '</td></tr>' }).join('')
    el('list').innerHTML = '<table class="list"><colgroup><col><col class="hide-sm w90"><col class="hide-sm w130"><col class="w96"></colgroup>'
        + '<thead><tr><th>Name</th><th class="hide-sm">Size</th><th class="hide-sm">Changed</th><th>Access</th></tr></thead><tbody>' + folders + items + '</tbody></table>'
        + '<p class="intro">Click to see details, double-click to open.</p>'
}

/* ---------- the selection, in the panel ---------- */
/* selects a folder or an item of this folder and reads what the panel shows */
async function selectRow(kind, id) {
    id = idOf(id); if (!id) return
    S.sel = {kind, id}; S.item = null; S.inside = null
    markRows(); drawPanel()
    try {
        if (kind === 'item') { const it = await api('/items/' + encodeURIComponent(id)); if (S.sel?.id === id) S.item = it }
        else { const j = await api('?folder=' + encodeURIComponent(id)); if (S.sel?.id === id) S.inside = {folders: j.folders.length, items: j.items.length} }
    } catch (e) { if (e.message !== 'signed out') toast(e.message, true); return }
    if (S.sel?.id === id) drawPanel()
}
function deselect() { S.sel = null; S.item = null; S.inside = null; markRows(); drawPanel() }
function markRows() {
    for (const tr of el('list').querySelectorAll('tr[data-folder],tr[data-item]'))
        tr.classList.toggle('on', !!S.sel && (tr.dataset.folder || tr.dataset.item) === S.sel.id)
}
/* double click, Enter: a folder opens in the list, an item's entry file in a new tab */
function openRow(kind, id) {
    if (kind === 'folder') { location.hash = '#' + idOf(id); return }
    const i = S.data.items.find(x => x.id === idOf(id))
    if (i) fileUrl(i, i.entry || '', 3600).then(u => window.open(u, '_blank', 'noopener'), err => toast(err.message, true))
}
const selectedFolder = () => S.sel?.kind === 'folder' ? S.data.folders.find(f => f.id === S.sel.id) : null
function drawPanel() {
    if (!S.sel) { el('panel').innerHTML = ''; return }
    if (S.sel.kind === 'item') { drawItem(); return }
    const f = selectedFolder(); if (!f) { el('panel').innerHTML = ''; return }
    const n = S.inside, count = (k, w) => k + ' ' + w + (k === 1 ? '' : 's')
    el('panel').innerHTML = '<div class="ph"><h2>' + esc(f.name) + '<span class="sub">Folder</span></h2><button class="icon" data-close title="Close" aria-label="Close">' + icon('x') + '</button></div>'
        + '<div class="sec"><div class="sb pad">'
        + '<div class="kv"><b>Location</b><span>/' + esc(S.data.path.map(p => p.name).concat(f.name).join('/')) + '</span></div>'
        + '<div class="kv"><b>Contains</b><span>' + (n ? (n.folders || n.items ? esc([n.folders && count(n.folders, 'folder'), n.items && count(n.items, 'item')].filter(Boolean).join(', ')) : 'Nothing') : '…') + '</span></div>'
        + '<div class="acts-row"><button class="primary" data-go="' + esc(idOf(f.id)) + '">' + icon('folder') + 'Open</button><button data-rename-folder>' + icon('edit') + 'Rename</button><button data-move-folder>' + icon('move') + 'Move</button></div></div></div>'
        + '<div class="sec"><div class="sb pad"><button class="danger" data-delete-folder' + (n && (n.folders || n.items) ? ' disabled title="Only an empty folder can be deleted"' : '') + '>' + icon('trash') + 'Delete folder</button></div></div>'
}

/* the selected item: its link, its details and files */
function drawItem() {
    const i = S.item
    if (!i) { el('panel').innerHTML = '<div class="ph"><h2>…</h2><button class="icon" data-close title="Close" aria-label="Close">' + icon('x') + '</button></div>'; return }
    const kv = (k, v) => '<div class="kv"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>'
    const shared = i.visibility === 'link', files = i.files || []
    el('panel').innerHTML = '<div class="ph"><h2>' + esc(i.name) + '<span class="sub">' + esc(bytes(i.size)) + (i.files_count > 1 ? ' · ' + Number(i.files_count) + ' files' : '') + '</span></h2>'
        + '<button class="icon" data-close title="Close" aria-label="Close">' + icon('x') + '</button></div>'
        + '<div class="sec"><div class="sh">Share</div><div class="sb">'
        + '<div class="share' + (shared ? ' on' : '') + '">' + icon(shared ? 'globe' : 'lock') + '<div><b>' + (shared ? 'Anyone with the link' : 'Private') + '</b>'
        + (shared ? 'can open it' : 'Only you, and links you sign') + '</div><button data-visibility="' + (shared ? 'private' : 'link') + '">' + (shared ? 'Make private' : 'Share') + '</button></div>'
        + '<div class="acts-row fill"><button data-copy-link title="' + (shared ? 'The item\'s link' : 'A signed link that works for one day') + '">' + icon('copy') + (shared ? 'Copy link' : 'Copy 1-day link') + '</button>'
        + '<button data-open-entry>' + icon('open') + 'Open</button></div></div></div>'
        + '<details class="sec" open><summary>Item</summary><div class="sb">' + kv('Opens', i.entry || '') + kv('Size', bytes(i.size)) + kv('Files', i.files_count) + kv('Created', stamp(i.created)) + kv('Changed', stamp(i.updated))
        + '<div class="acts-row"><button data-rename-item>' + icon('edit') + 'Rename</button><button data-move-item>' + icon('move') + 'Move</button>'
        + '<button data-new-id title="The item gets a new id: every link given out before stops working">' + icon('link') + 'New link</button></div></div></details>'
        + '<details class="sec" open><summary>Files <span class="n">' + files.length + '</span></summary><div class="sb files">'
        + files.map((f, n) => '<div class="kv"><b>' + esc(bytes(f.size)) + '</b><span><a data-file="' + n + '">' + esc(f.path) + '</a></span></div>').join('') + '</div></details>'
        + '<div class="sec"><div class="sb pad"><button class="danger" data-delete-item>' + icon('trash') + 'Delete item</button></div></div>'
}
/* a URL that opens the item's file `path`: the item URL when shared, else signed (`ttl` seconds) */
async function fileUrl(item, path, ttl) {
    if (item.visibility === 'link') return item.url.slice(0, item.url.indexOf('/' + item.id + '/') + item.id.length + 2) + path.split('/').map(encodeURIComponent).join('/')
    const {url} = await send('POST', '/items/' + encodeURIComponent(item.id) + '/sign', {ttl})
    return url + path.split('/').map(encodeURIComponent).join('/')
}

/* ---------- changes ---------- */
async function act(label, f, done) {
    status(label + '…')
    try { await f(); status(''); if (done) toast(done) } catch (e) { status(''); if (e.message !== 'signed out') toast(label + ' failed: ' + e.message, true) }
    await load()
}
/* a folder picked in a dialog: its id ('' is the top), or null */
function pickFolder(title) {
    let at = '', path = []
    const draw = async d => {
        const box = d.querySelector('.picker'), crumbs = d.querySelector('[data-where]')
        box.innerHTML = '<div class="none">Reading…</div>'
        try {
            const j = await api('?folder=' + encodeURIComponent(at)); path = j.path
            crumbs.textContent = '/' + path.map(f => f.name).join('/')
            box.innerHTML = (path.length ? '<a class="up" data-pick="' + esc(idOf(path.length > 1 ? path[path.length - 2].id : '')) + '">' + icon('folderUp') + '..</a>' : '')
                + (j.folders.map(f => '<a data-pick="' + esc(idOf(f.id)) + '">' + icon('folder') + esc(f.name) + '</a>').join('') || '<div class="none">No folders in here.</div>')
        } catch (e) { box.innerHTML = '<div class="none err">' + esc(e.message) + '</div>' }
    }
    return UI.dialog({title, ok: 'Move here', body: '<p data-where>/</p><div class="picker"></div>',
        mount: d => { d.querySelector('.picker').addEventListener('click', e => { const a = e.target.closest('[data-pick]'); if (a) { at = idOf(a.dataset.pick); draw(d) } }); draw(d) },
        result: () => at})
}

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

document.addEventListener('click', async e => {
    const t = e.target.closest('button,[data-go],[data-folder],[data-item],a[data-file]')
    if (!t || t.closest('dialog,#side')) return
    const d = t.dataset
    if (t.matches('button')) e.stopPropagation()
    const f = selectedFolder(), i = S.item
    if ('newFolder' in d) { const n = await UI.prompt('New folder', '', {placeholder: 'Folder name', ok: 'Create'}); if (n) act('Creating the folder', () => send('POST', '/folders', {name: n, parent: S.folder})) }
    else if ('uploadFiles' in d) el('files').click()
    else if ('uploadFolder' in d) el('folder').click()
    else if ('go' in d) { location.hash = idOf(d.go) ? '#' + idOf(d.go) : '' }
    else if ('folder' in d) selectRow('folder', d.folder)
    else if ('item' in d) selectRow('item', d.item)
    else if ('close' in d) deselect()
    else if ('renameFolder' in d && f) { const n = await UI.prompt('Rename folder', f.name); if (n) act('Renaming', () => send('PATCH', '/folders/' + encodeURIComponent(f.id), {name: n})) }
    else if ('moveFolder' in d && f) { const p = await pickFolder('Move "' + f.name + '"'); if (p !== null) act('Moving', () => send('PATCH', '/folders/' + encodeURIComponent(f.id), {parent: p}), 'Moved') }
    else if ('deleteFolder' in d && f) { if (await UI.confirm('Delete "' + f.name + '"?', 'The folder is empty; it goes for good.')) act('Deleting', () => send('DELETE', '/folders/' + encodeURIComponent(f.id)), 'Deleted') }
    else if (!i) return
    else if ('visibility' in d) act('Changing who can open it', () => send('PATCH', '/items/' + encodeURIComponent(i.id), {visibility: d.visibility === 'link' ? 'link' : 'private'}), d.visibility === 'link' ? 'Anyone with the link can open it' : 'Private')
    else if ('copyLink' in d) fileUrl(i, i.entry || '', 86400).then(u => navigator.clipboard.writeText(u)).then(() => toast('Link copied'), err => toast(err.message, true))
    else if ('openEntry' in d) openRow('item', i.id)
    else if ('file' in d) { e.preventDefault(); const file = i.files[Number(d.file)]; if (file) fileUrl(i, file.path, 3600).then(u => window.open(u, '_blank', 'noopener'), err => toast(err.message, true)) }
    else if ('newId' in d) { if (await UI.confirm('Give it a new link?', 'Every link to "' + i.name + '" given out before stops working.', {ok: 'New link', danger: false})) act('Making a new link', async() => { const n = await send('POST', '/items/' + encodeURIComponent(i.id) + '/new-id'); S.sel = {kind: 'item', id: n.id} }, 'New link made') }
    else if ('renameItem' in d) { const n = await UI.prompt('Rename', i.name, {text: 'The link keeps working.'}); if (n) act('Renaming', () => send('PATCH', '/items/' + encodeURIComponent(i.id), {name: n})) }
    else if ('moveItem' in d) { const p = await pickFolder('Move "' + i.name + '"'); if (p !== null) act('Moving', () => send('PATCH', '/items/' + encodeURIComponent(i.id), {folder: p}), 'Moved') }
    else if ('deleteItem' in d) { if (await UI.confirm('Delete "' + i.name + '"?', 'Its ' + i.files_count + ' file' + (i.files_count === 1 ? '' : 's') + ' and every link to it go for good.')) act('Deleting', () => send('DELETE', '/items/' + encodeURIComponent(i.id)), 'Deleted') }
})
document.addEventListener('dblclick', e => {
    const t = e.target.closest('tr[data-folder],tr[data-item]')
    if (t) openRow(t.dataset.folder ? 'folder' : 'item', t.dataset.folder || t.dataset.item)
})
document.addEventListener('keydown', e => {
    const t = e.target.closest && e.target.closest('tr[data-folder],tr[data-item]')
    if (t && e.key === 'Enter') openRow(t.dataset.folder ? 'folder' : 'item', t.dataset.folder || t.dataset.item)
    else if (t && e.key === ' ') { e.preventDefault(); t.click() }
    else if (e.key === 'Escape' && S.sel && !document.querySelector('dialog[open]')) deselect()
})
el('files').addEventListener('change', e => { const f = e.target.files; act('Uploading', () => upload(f, false), 'Uploaded'); e.target.value = '' })
el('folder').addEventListener('change', e => { const f = e.target.files; act('Uploading', () => upload(f, true), 'Uploaded'); e.target.value = '' })
const list = el('list')
list.addEventListener('dragover', e => { e.preventDefault(); list.classList.add('drop') })
list.addEventListener('dragleave', e => { if (!list.contains(e.relatedTarget)) list.classList.remove('drop') })
list.addEventListener('drop', e => { e.preventDefault(); list.classList.remove('drop'); const f = e.dataTransfer.files; if (f.length) act('Uploading', () => upload(f, false), 'Uploaded') })
document.querySelector('.toolbar [data-new-folder]').innerHTML = icon('folderPlus') + '<span class="hide-sm">New folder</span>'
document.querySelector('.toolbar [data-upload-folder]').innerHTML = icon('folder') + '<span class="hide-sm">Upload folder</span>'
document.querySelector('.toolbar [data-upload-files]').innerHTML = icon('upload') + 'Upload'
window.addEventListener('hashchange', load)
load()
