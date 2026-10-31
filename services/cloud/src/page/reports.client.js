// From #104's staff page, copied from ijewel-mono crm/index.html @ 54d43285 (the Support → Reports view, IJ-564).
// Changed for threepipe cloud: the session cookie (GitHub sign-in) instead of a staff token, and one project at a time
// (the URL hash is its slug); the projects you are a member of are listed first.
/* The reports of a project, read from /api/v1/projects/<slug>/reports (src/projects.ts). The list is read
   one page at a time, newest first (`next` is the cursor for `before`); one report is read when its
   drawer opens.
   EVERY FIELD IS USER INPUT: the text, the summary, the log, the cause, the route, the file names, the
   note, the email, every key and value of environment and context, the user agent. Each one goes
   through esc() on render, and no API string is put into an inline handler: the page binds events by
   data attributes. The email is typed by the sender and NOT verified. The screenshot and the files come
   as blobs from fetch, so the page's own CSP (img-src blob:) is enough. */
'use strict'
const REP_STATUS = {new: 'New', in_progress: 'In progress', waiting_reporter: 'Waiting on reporter', closed: 'Closed', spam: 'Spam'}
const REP_STATUSES = Object.keys(REP_STATUS)
const REP_TYPE = {bug: 'Bug', question: 'Question', idea: 'Idea', other: 'Other'}
const REP_PAGE = 50
const REP_FLAT_MAX = 200
const S = {project: '', role: '', projects: null, reps: null, repsErr: '', repsBusy: false, repSeq: 0, f: {status: '', type: '', q: '', deleted: false}, rep: null, settings: null}

const {el, esc, icon, stamp} = UI
/* a value of one of the maps above for an API string, never an inherited property ('constructor') */
const repOwn = (m, k) => Object.prototype.hasOwnProperty.call(m, String(k)) ? m[String(k)] : undefined
/* a project slug as the server makes it, else '' */
const slugOf = s => /^[a-z][a-z0-9-]{1,39}$/.test(String(s || '')) ? String(s) : ''
const base = () => '/api/v1/projects/' + encodeURIComponent(S.project) + '/reports'
/* a report id as the server makes it ('R-' and six characters), else '' */
const repId = s => /^R-[0-9A-Z]{6}$/.test(String(s || '')) ? String(s) : ''
/* a plain address, as the worker accepts it: no '?', '=' or '&', so a mailto: link cannot gain headers */
const repEmail = s => /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i.test(String(s || '')) ? String(s) : ''
/* the first line of the user's text that has words in it */
function repFirstLine(s) { return (String(s || '').split(/\r?\n/).map(x => x.trim()).find(Boolean) || '').slice(0, 160) }
/* any JSON value as one line of text (the caller escapes it) */
function repVal(v) {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    try { return JSON.stringify(v) } catch (e) { return String(v) }
}
/* an object as [key path, text] pairs: {gpu:{renderer:'X'}} → [['gpu.renderer','X']]. Four levels, REP_FLAT_MAX pairs. */
function repFlat(v, pre, out, depth) {
    out = out || []; pre = pre || ''; depth = depth || 0
    if (out.length >= REP_FLAT_MAX) return out
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) {
        const ks = Object.keys(v)
        if (!ks.length && pre) out.push([pre, ''])
        for (const k of ks) { if (out.length >= REP_FLAT_MAX) break; repFlat(v[k], pre ? pre + '.' + k : k, out, depth + 1) }
    } else if (pre) out.push([pre, repVal(v)])
    return out
}
/* the list request for the filters f; before = the cursor of the next page */
function repQuery(f, before) {
    const p = [], add = (k, v) => { if (v) p.push(k + '=' + encodeURIComponent(v)) }
    add('status', f.status); add('type', f.type); add('q', f.q)
    if (f.deleted) p.push('deleted=1')
    p.push('limit=' + REP_PAGE)
    add('before', before)
    return base() + '?' + p.join('&')
}

/* ---------- the API: the session cookie (same origin) ---------- */
async function api(path, init) {
    const r = await fetch(path, {...init, credentials: 'same-origin'})
    if (r.status === 401) { signOut(''); throw new Error('signed out') }
    const ct = r.headers.get('content-type') || ''
    if (!r.ok) {
        const j = ct.includes('json') ? await r.json().catch(() => ({})) : {}
        if (UI.handleGate(r.status, j)) throw new Error('signed out')
        throw new Error(j.error || j.message || ('HTTP ' + r.status))
    }
    return ct.includes('json') ? r.json() : r.blob()
}
const send = (method, path, body) => api(path, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined})

/* ---------- sign-in and projects ---------- */
function show(id) { for (const x of ['login', 'app']) el(x).hidden = x !== id }
function signOut(msg) {
    show('login')
    UI.login(el('login'), {title: 'Sign in to see reports', text: 'The reports people send from your apps. Sign in to see the projects you are a member of.', redirect: '/reports', message: msg})
}
/* the hash names the project; no hash: the list of your projects */
async function route() {
    repRelease(); S.settings = null; drawReport()
    const slug = slugOf(decodeURIComponent(location.hash.slice(1)))
    const fresh = !S.projects
    if (fresh) {
        try { S.projects = (await api('/api/v1/projects')).projects || [] } catch (e) { if (String(e.message) !== 'signed out') signOut('Could not read your projects: ' + e.message); return }
    }
    show('app')
    let p = slug && S.projects.find(x => x.slug === slug)
    // not in your list: staff manage every project; anyone else gets a 404
    if (slug && !p) p = await api('/api/v1/projects/' + encodeURIComponent(slug)).catch(() => null)
    UI.side('reports', p ? p.slug : '', fresh)
    if (!p) { S.project = ''; renderProjects(slug); return }
    S.project = p.slug; S.role = p.role; S.f = {status: '', type: '', q: '', deleted: false}
    renderFrame(p); repReload()
}
function renderProjects(missing) {
    el('main').innerHTML = '<div class="toolbar"><h1>Projects</h1><span class="grow"></span><button class="primary" data-create>' + icon('plus') + 'New project</button></div>'
        + '<div class="scroll">' + (missing ? '<p class="intro err">You are not a member of ' + esc(missing) + ', or it does not exist.</p>' : '')
        + (S.projects.length
            ? '<table class="list"><colgroup><col><col class="w160 hide-sm"><col class="w110"></colgroup><thead><tr><th>Name</th><th class="hide-sm">Slug</th><th>Role</th></tr></thead><tbody>'
                + S.projects.map(p => '<tr data-project="' + esc(slugOf(p.slug)) + '"><td><div class="name"><span class="ft">' + icon('hash') + '</span><div><div class="t">' + esc(p.name) + '</div></div></div></td>'
                    + '<td class="hide-sm"><code>' + esc(p.slug) + '</code></td><td>' + esc(p.role === 'manager' ? 'Manager' : 'Reader') + '</td></tr>').join('') + '</tbody></table>'
            : '<div class="empty"><span class="big">' + icon('inbox') + '</span><b>No projects yet</b><span>Create one for your app, then send reports to it with @threepipe/plugin-cloud.</span>'
                + '<span class="row"><button class="primary" data-create>' + icon('plus') + 'New project</button></span></div>')
        + '</div>'
}
async function createProject() {
    const v = await UI.dialog({title: 'New project', text: 'Reports from your apps go to a project. The slug is in the app\'s config and cannot change.', ok: 'Create',
        body: '<input data-new-slug placeholder="Slug: my-editor" autocomplete="off" spellcheck="false"><input data-new-name placeholder="Name: My editor" autocomplete="off"><p class="err" data-err></p>',
        result: (d, finish) => {
            const slug = String(d.querySelector('[data-new-slug]').value || '').trim(), name = String(d.querySelector('[data-new-name]').value || '').trim()
            send('POST', '/api/v1/projects', {slug, name}).then(() => {
                finish(true); S.projects = null
                if (location.hash === '#' + slug) route(); else location.hash = '#' + slug
            },
                e => { d.querySelector('[data-err]').textContent = e.message })
            return undefined // stays open until the project is made
        }})
    return v
}

/* ---------- the list ---------- */
const cls = s => String(s || '').replace(/[^a-z_]/g, '')
function repStatusPill(st) { return '<span class="pill c-' + cls(st) + '"><span class="dot c-' + cls(st) + '"></span>' + esc(repOwn(REP_STATUS, st) || st || '?') + '</span>' }
function repTypePill(t) { return '<span class="pill c-' + cls(t) + '">' + esc(repOwn(REP_TYPE, t) || t || '?') + '</span>' }
function repOriginPill(o) { return o ? '<span class="pill" title="The page it was sent from">' + esc(o) + '</span>' : '' }
function repRow(r) {
    const st = String(r.status || 'new'), gone = !!r.deleted_at
    const line = gone ? 'Deleted by ' + (r.deleted_by || '?') + ' · ' + stamp(r.deleted_at) : repFirstLine(r.summary)
    const n = Number(r.files_count) || 0
    return '<tr class="' + (gone ? 'gone ' : '') + (S.rep && S.rep.id === r.id ? 'on' : '') + '" data-open="' + esc(repId(r.id)) + '" data-report-row>'
        + '<td><div class="name"><span class="dot c-' + cls(st) + '"></span><div><div class="t">' + (line ? esc(line) : '<span class="muted">No text</span>') + '</div>'
        + '<div class="s">' + esc(r.id) + ' · ' + esc(stamp(r.created_at)) + (r.surface ? ' · ' + esc(r.surface) : '') + (r.cause ? ' · ' + esc(r.cause) : '')
        + (!gone && r.email ? ' · ' + esc(r.email) + ' (not verified)' : '') + '</div></div></div></td>'
        + '<td>' + repTypePill(r.type) + '</td>'
        + '<td class="hide-sm hide-panel"><div class="pills">' + repOriginPill(r.origin) + (r.user_id ? '<span class="pill">Signed in</span>' : '') + (r.has_image ? '<span class="pill" title="Screenshot">' + icon('image') + '</span>' : '')
        + (n ? '<span class="pill">' + icon('file') + n + ' · ' + esc(UI.bytes(r.files_bytes)) + '</span>' : '') + '</div></td>'
        + '<td>' + repStatusPill(st) + '</td></tr>'
}
/* the frame of one project: the title bar and the filters (rendered once; renderFilters marks the chosen ones) */
function renderFrame(p) {
    el('main').innerHTML = '<div class="toolbar"><div class="crumbs"><a data-home>Projects</a><span class="sep">/</span><a>' + esc(p.name || p.slug) + '</a></div><span class="grow"></span>'
        + '<input data-q type="search" placeholder="Report id or email, then Enter" autocomplete="off" class="w200">'
        + '<button class="icon" data-reload title="Reload" aria-label="Reload">' + icon('refresh') + '</button>'
        + '<button data-settings title="Members, Discord, name">' + icon('settings') + '<span class="hide-sm">Settings</span></button></div>'
        + '<div class="toolbar" id="filters"></div><div class="scroll" id="list"></div>'
}
function renderFilters() {
    const f = S.f
    const opts = (list, cur, all, lab) => '<option value="">' + all + '</option>' + list.map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(lab(v)) + '</option>').join('')
    el('filters').innerHTML = '<div class="seg"><button data-status="" class="' + (f.status ? '' : 'on') + '">All</button>'
        + REP_STATUSES.map(st => '<button data-status="' + st + '" class="' + (f.status === st ? 'on' : '') + '">' + esc(REP_STATUS[st]) + '</button>').join('') + '</div>'
        + '<span class="sel"><select data-type-filter>' + opts(Object.keys(REP_TYPE), f.type, 'All types', t => REP_TYPE[t]) + '</select></span>'
        + '<label class="check"><input type="checkbox" data-deleted' + (f.deleted ? ' checked' : '') + '>Show deleted</label>'
}
function renderList() {
    if (!el('filters')) return
    renderFilters()
    let h
    if (!S.reps) h = '<div class="empty"><span>' + (S.repsErr ? '<span class="err">Could not read the reports: ' + esc(S.repsErr) + '</span>' : 'Reading the reports…') + '</span></div>'
    else {
        h = S.reps.rows.length
            ? '<table class="list"><colgroup><col><col class="w90"><col class="w200 hide-sm hide-panel"><col class="w160"></colgroup><thead><tr><th>Report</th><th>Type</th><th class="hide-sm hide-panel"></th><th>Status</th></tr></thead><tbody>' + S.reps.rows.map(repRow).join('') + '</tbody></table>'
            : '<div class="empty"><span class="big">' + icon('inbox') + '</span><b>No reports</b><span>' + (S.f.status || S.f.type || S.f.q || S.f.deleted ? 'None match these filters.' : 'Reports people send from the apps of this project show up here.') + '</span></div>'
        if (S.reps.next) h += '<div class="more"><button data-more' + (S.repsBusy ? ' disabled' : '') + '>' + (S.repsBusy ? 'Reading…' : 'Load more') + '</button></div>'
        if (S.repsErr) h += '<p class="intro err">Could not read more: ' + esc(S.repsErr) + '</p>'
    }
    el('list').innerHTML = h + '<p class="intro">Everything in a report is user input; the email is typed and nobody verified it.</p>'
}
/* one page of the list. A newer read (a filter changed) wins over an older one still on its way. */
async function loadReports(more) {
    const seq = ++S.repSeq, before = more && S.reps ? S.reps.next : ''
    S.repsBusy = true; S.repsErr = ''
    try {
        const j = await api(repQuery(S.f, before))
        if (seq !== S.repSeq) return
        const rows = Array.isArray(j.rows) ? j.rows : []
        if (more && S.reps) { const seen = new Set(S.reps.rows.map(r => r.id)); S.reps.rows = S.reps.rows.concat(rows.filter(r => !seen.has(r.id))) }
        else S.reps = {rows}
        S.reps.next = j.next || ''
    } catch (e) {
        if (seq !== S.repSeq) return
        S.repsErr = String(e && e.message || e)
    }
    S.repsBusy = false
    renderList()
}
function repReload() { S.reps = null; S.repsErr = ''; renderList(); loadReports(false) }

/* ---------- one report, in the panel ---------- */
const kv = (k, v) => v === undefined || v === null || v === '' ? '' : '<div class="kv w"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>'
/* a section like a tweakpane folder; `open` false: folded */
const box = (title, body, open, n) => '<details class="sec"' + (open === false ? '' : ' open') + '><summary>' + esc(title) + (n !== undefined ? ' <span class="n">' + esc(n) + '</span>' : '') + '</summary><div class="sb">' + body + '</div></details>'
async function openReport(id) {
    id = repId(id); if (!id) return
    repRelease(); S.settings = null
    S.rep = {id, busy: true, err: '', row: null, files: [], report: null, img: ''}
    drawReport(); markRow()
    await repLoad()
}
function markRow() { for (const tr of document.querySelectorAll('[data-report-row]')) tr.classList.toggle('on', !!S.rep && tr.getAttribute('data-open') === S.rep.id) }
async function repLoad() {
    const r = S.rep; if (!r) return
    try {
        const j = await api(base() + '/' + encodeURIComponent(r.id))
        if (S.rep !== r) return
        r.row = j.row || {}; r.files = Array.isArray(j.files) ? j.files : []; r.report = j.report || null
    } catch (e) { if (S.rep === r) r.err = String(e && e.message || e) }
    r.busy = false
    drawReport()
    if (r.row && r.row.has_image && !r.img) {
        try {
            const b = await api(base() + '/' + encodeURIComponent(r.id) + '/image')
            if (S.rep !== r) return
            r.img = URL.createObjectURL(b); drawReport()
        } catch (e) { /* the image box says it is missing */ }
    }
}
/* the panel closes or shows another report: the image URL goes */
function repRelease() { const r = S.rep; S.rep = null; if (r && r.img) URL.revokeObjectURL(r.img) }
function drawReport() {
    const r = S.rep
    if (!r) { if (S.settings) drawSettings(); else el('panel').innerHTML = ''; markRow(); return }
    const row = r.row || {}, rep = r.report || {}, gone = !!row.deleted_at
    let h = '<div class="ph"><h2>Report ' + esc(r.id) + (row.created_at ? '<span class="sub">Sent ' + esc(stamp(row.created_at)) + '</span>' : '') + '</h2><button class="icon" data-close title="Close" aria-label="Close">' + icon('x') + '</button></div>'
    if (r.busy) { el('panel').innerHTML = h + '<div class="sec"><div class="sb pad muted">Reading the report…</div></div>'; return }
    if (r.err) { el('panel').innerHTML = h + '<div class="sec"><div class="sb pad err">Could not read the report: ' + esc(r.err) + '</div></div>'; return }
    h += '<div class="sec"><div class="sb pad"><div class="acts-row">' + repTypePill(row.type) + repStatusPill(row.status) + repOriginPill(row.origin) + '</div></div></div>'
    if (gone) {
        el('panel').innerHTML = h + box('Deleted', '<p class="note">Deleted by ' + esc(row.deleted_by || '?') + ' on ' + esc(stamp(row.deleted_at)) + '. The text, the log, the screenshot and the files are gone. The row keeps the id and the dates.</p>'
            + kv('Type', row.type) + kv('Surface', row.surface) + kv('Cause', row.cause) + kv('Status', repOwn(REP_STATUS, row.status) || row.status))
        return
    }
    const stOpts = REP_STATUSES.map(s => '<option value="' + s + '"' + (s === row.status ? ' selected' : '') + '>' + esc(REP_STATUS[s]) + '</option>').join('')
    if (S.role === 'manager') h += box('Status', '<div class="field"><span class="sel grow"><select data-set-status>' + stOpts + '</select></span></div><p class="note">' + (row.status_by ? 'Set by ' + esc(row.status_by) + ' · ' + esc(stamp(row.status_at)) : 'Nobody changed the status yet.') + '</p>'
        + '<textarea id="repNote" maxlength="2000" rows="3" placeholder="A note for the team; the sender does not see it">' + esc(row.note || '') + '</textarea>'
        + '<div class="acts-row"><button data-save-note>Save note</button><span class="grow"></span><button class="danger" data-delete>' + icon('trash') + 'Delete report</button></div>')
    else if (row.note) h += box('Note', '<div class="text">' + esc(row.note) + '</div>')
    h += box('What the sender wrote', (rep.text ? '<div class="text">' + esc(rep.text) + '</div>' : '<p class="note">No text.</p>')
        + kv('Email', rep.email ? rep.email + ' (typed, not verified)' : '') + (repEmail(rep.email) ? '<div><a class="btn" data-mailto href="mailto:' + esc(repEmail(rep.email)) + '?subject=' + encodeURIComponent('Your threepipe report ' + r.id) + '">Reply by e-mail</a></div>' : '')
        + kv('Surface', row.surface) + kv('Route', rep.route) + kv('Site', row.origin) + kv('Signed-in sender', row.user_id ? 'yes (user id ' + row.user_id + ')' : 'no'))
    const c = rep.cause && typeof rep.cause === 'object' ? rep.cause : {}
    if (c.kind) h += box('Cause', kv('Kind', c.kind) + kv('File type', c.ext ? '.' + c.ext : '') + kv('Message', c.message) + kv('Top frame', c.frame))
    h += box('Screenshot', r.img ? '<img class="shot" alt="The screenshot the sender attached" src="' + esc(r.img) + '">' : '<p class="note">' + (row.has_image ? 'Reading the screenshot…' : 'No screenshot came with this report.') + '</p>')
    h += box('Files', r.files.length ? r.files.map(f => '<div class="kv w"><b>' + esc(f.name || '(name removed)') + '</b><span>' + esc(UI.bytes(f.size)) + ' · ' + esc(f.state)
        + (f.state === 'done' ? ' <button class="ghost" data-file="' + Number(f.idx) + '">' + icon('download') + 'Download</button>' : '') + '</span></div>').join('') : '<p class="note">No files came with this report.</p>', true, r.files.length)
    const log = Array.isArray(rep.log) ? rep.log : []
    h += box('Log', log.length ? '<pre data-log>' + esc(log.map(repVal).join('\n')) + '</pre>' : '<p class="note">No log lines.</p>', log.length > 0, log.length)
    h += box('Versions', repFlat(row.versions || rep.versions || {}).map(x => kv(x[0], x[1])).join('') || '<p class="note">None sent.</p>', false)
    for (const [title, v] of [['Environment', rep.environment], ['Context', rep.context]]) {
        const p = repFlat(v); h += box(title, p.length ? p.map(x => kv(x[0], x[1])).join('') : '<p class="note">Nothing sent.</p>', false)
    }
    const q = rep.request && typeof rep.request === 'object' ? rep.request : {}
    h += box('Request', kv('Cloudflare ray', q.ray) + kv('Country', q.country) + kv('Browser', q.user_agent) + kv('Page origin', rep.origin) + kv('Discord card', row.discord_state), false)
    el('panel').innerHTML = h
}
/* ---------- the project's settings, in the panel: name, members, Discord ---------- */
const pbase = () => '/api/v1/projects/' + encodeURIComponent(S.project)
async function openSettings() {
    repRelease(); markRow()
    S.settings = {busy: true, err: '', project: null, members: []}
    drawSettings()
    const st = S.settings
    try {
        const [p, m] = await Promise.all([api(pbase()), api(pbase() + '/members')])
        if (S.settings !== st) return
        st.project = p; st.members = Array.isArray(m.members) ? m.members : []
    } catch (e) { if (S.settings === st) st.err = String(e && e.message || e) }
    st.busy = false
    if (S.settings === st) drawSettings()
}
const ROLE_LABEL = {owner: 'Owner', manager: 'Manager', reader: 'Reader'}
function drawSettings() {
    const st = S.settings
    let h = '<div class="ph"><h2>Settings<span class="sub">' + esc(S.project) + '</span></h2><button class="icon" data-close title="Close" aria-label="Close">' + icon('x') + '</button></div>'
    if (st.busy) { el('panel').innerHTML = h + '<div class="sec"><div class="sb pad muted">Reading…</div></div>'; return }
    if (st.err) { el('panel').innerHTML = h + '<div class="sec"><div class="sb pad err">' + esc(st.err) + '</div></div>'; return }
    const p = st.project, manager = p.role === 'manager'
    h += box('Project', manager
        ? '<div class="field"><input data-project-name maxlength="100" value="' + esc(p.name) + '"><button data-save-name>Save</button></div>'
        : kv('Name', p.name))
    const rows = st.members.map(m => '<div class="member"><span class="avatar">' + esc(String(m.username || '?').slice(0, 1)) + '</span><span class="grow">@' + esc(m.username) + '</span>'
        + (m.role === 'owner' || !manager ? '<span class="muted">' + esc(ROLE_LABEL[m.role] || m.role) + '</span>'
            : '<span class="sel"><select data-member-role="' + esc(m.username) + '">' + ['reader', 'manager'].map(r => '<option value="' + r + '"' + (r === m.role ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>').join('') + '</select></span>'
              + '<button class="icon" data-member-remove="' + esc(m.username) + '" title="Remove" aria-label="Remove @' + esc(m.username) + '">' + icon('x') + '</button>')
        + '</div>').join('')
    h += box('Members', rows + (manager ? '<div class="field"><input data-member-new placeholder="Username" autocomplete="off" spellcheck="false"><span class="sel"><select data-member-new-role><option value="reader">Reader</option><option value="manager">Manager</option></select></span><button data-member-add>Add</button></div>'
        + '<p class="note">Readers see the reports; managers also change their status, add notes, delete them and edit this.</p>' : ''), true, st.members.length)
    h += box('Discord', '<p class="note">' + (p.discord_webhook ? 'Each new report posts a card to your Discord channel.' : 'Off. With a webhook, each new report posts a card to a Discord channel.') + '</p>'
        + (manager ? '<div class="field"><input data-webhook placeholder="https://discord.com/api/webhooks/…" autocomplete="off" spellcheck="false"><button data-save-webhook>' + (p.discord_webhook ? 'Replace' : 'Save') + '</button></div>'
            + (p.discord_webhook ? '<div><button class="danger" data-clear-webhook>Turn off</button></div>' : '') + '<p class="note">The URL is a secret: it is kept, never shown again.</p>' : ''))
    el('panel').innerHTML = h
}
/* a settings change: `f` calls the API; then the panel and the side bar (a new name) read again */
async function settingsChange(label, f, done) {
    try { await f(); if (done) UI.toast(done) } catch (e) { if (e.message !== 'signed out') UI.toast(label + ' failed: ' + e.message, true); return }
    if (S.settings) await openSettings()
}
const field = sel => String((document.querySelector(sel) || {}).value || '').trim()

/* PATCH {status} or {note}; the answer is the report as GET gives it. The actor is the member's username, set by the worker. */
async function repPatch(body) {
    const r = S.rep; if (!r) return
    try {
        const j = await send('PATCH', base() + '/' + encodeURIComponent(r.id), body)
        if (S.rep !== r) return
        r.row = j.row || r.row; r.files = j.files || r.files; r.report = j.report || r.report
        if (S.reps) S.reps.rows = S.reps.rows.map(x => x.id === r.id ? {...x, status: r.row.status, note: r.row.note} : x)
        renderList(); drawReport()
    } catch (e) { UI.toast('Save failed: ' + e.message, true) }
}
async function repFileGet(i) {
    const r = S.rep; if (!r) return
    const f = r.files.find(x => Number(x.idx) === i); if (!f) return
    try {
        const b = await api(base() + '/' + encodeURIComponent(r.id) + '/files/' + i)
        const url = URL.createObjectURL(new Blob([b], {type: 'application/octet-stream'}))
        const a = document.createElement('a')
        a.href = url; a.download = r.id + '-' + String(f.name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { UI.toast('Download failed: ' + e.message, true) }
}
async function repDelete() {
    const r = S.rep; if (!r || !r.row) return
    if (!await UI.confirm('Delete report ' + r.id + '?', 'The text, the log, the screenshot and the files go now. The row stays with the id, the dates and your name as the person who deleted it.')) return
    try { await send('DELETE', base() + '/' + encodeURIComponent(r.id)) } catch (e) { UI.toast('Delete failed: ' + e.message, true); return }
    repRelease(); drawReport(); repReload(); UI.toast('Report ' + r.id + ' deleted')
}

/* ---------- events: by data attributes, never an API string in a handler ---------- */
document.addEventListener('click', e => {
    const t = e.target.closest('[data-open],[data-status],[data-reload],[data-more],[data-close],[data-save-note],[data-delete],[data-file],[data-project],[data-create],[data-home],[data-settings],[data-save-name],[data-member-add],[data-member-remove],[data-save-webhook],[data-clear-webhook]')
    if (!t || t.closest('dialog')) return
    if (t.hasAttribute('data-project')) location.hash = '#' + slugOf(t.getAttribute('data-project'))
    else if (t.hasAttribute('data-home')) { e.preventDefault(); location.hash = '' }
    else if (t.hasAttribute('data-create')) createProject()
    else if (t.hasAttribute('data-open')) openReport(t.getAttribute('data-open'))
    else if (t.hasAttribute('data-status')) { const v = t.getAttribute('data-status'); S.f.status = REP_STATUSES.includes(v) ? v : ''; repReload() }
    else if (t.hasAttribute('data-reload')) repReload()
    else if (t.hasAttribute('data-more')) { if (!S.repsBusy && S.reps && S.reps.next) loadReports(true) }
    else if (t.hasAttribute('data-close')) { repRelease(); S.settings = null; drawReport() }
    else if (t.hasAttribute('data-settings')) openSettings()
    else if (t.hasAttribute('data-save-name')) { const name = field('[data-project-name]'); if (name) settingsChange('Renaming', () => send('PATCH', pbase(), {name}), 'Renamed').then(() => {
        const crumb = document.querySelector('.crumbs a:last-child'); if (crumb) crumb.textContent = name
        S.projects = null; UI.side('reports', S.project, true); api('/api/v1/projects').then(j => { S.projects = j.projects || [] }, () => undefined)
    }) }
    else if (t.hasAttribute('data-member-add')) { const username = field('[data-member-new]'); if (username) settingsChange('Adding', () => send('POST', pbase() + '/members', {username, role: field('[data-member-new-role]') === 'manager' ? 'manager' : 'reader'}), '@' + username + ' added') }
    else if (t.hasAttribute('data-member-remove')) { const u = t.getAttribute('data-member-remove'); UI.confirm('Remove @' + u + '?', 'They stop seeing the reports of ' + S.project + '.', {ok: 'Remove'}).then(ok => ok && settingsChange('Removing', () => send('DELETE', pbase() + '/members/' + encodeURIComponent(u)), '@' + u + ' removed')) }
    else if (t.hasAttribute('data-save-webhook')) { const hook = field('[data-webhook]'); if (hook) settingsChange('Saving the webhook', () => send('PATCH', pbase(), {discord_webhook: hook}), 'Discord cards on') }
    else if (t.hasAttribute('data-clear-webhook')) settingsChange('Turning Discord off', () => send('PATCH', pbase(), {discord_webhook: null}), 'Discord cards off')
    else if (t.hasAttribute('data-save-note')) { const v = el('repNote').value.trim(); repPatch({note: v || null}) }
    else if (t.hasAttribute('data-delete')) repDelete()
    else if (t.hasAttribute('data-file')) repFileGet(Number(t.getAttribute('data-file')))
})
document.addEventListener('change', e => {
    const t = e.target
    if (t.matches('[data-type-filter]')) { S.f.type = repOwn(REP_TYPE, t.value) ? t.value : ''; repReload() }
    else if (t.matches('[data-deleted]')) { S.f.deleted = t.checked; repReload() }
    else if (t.matches('[data-set-status]') && REP_STATUSES.includes(t.value)) repPatch({status: t.value})
    else if (t.matches('[data-member-role]')) { const u = t.getAttribute('data-member-role'); settingsChange('Changing the role', () => send('POST', pbase() + '/members', {username: u, role: t.value === 'manager' ? 'manager' : 'reader'}), '@' + u + ' is now a ' + (t.value === 'manager' ? 'manager' : 'reader')) }
})
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    if (e.target.matches('[data-q]')) { S.f.q = String(e.target.value || '').trim().slice(0, 200); repReload() }
})
window.addEventListener('hashchange', route)
window.addEventListener('DOMContentLoaded', route)
