// Copied from ijewel-mono crm/index.html @ 54d43285 (the Support → Reports view, IJ-564), on a page of its own with a
// staff token in place of the CRM's Google sign-in.
/* The reports from threepipe apps, read from /staff/reports (src/routes/staff.ts). The list is read
   one page at a time, newest first (`next` is the cursor for `before`); one report is read when its
   drawer opens.
   EVERY FIELD IS USER INPUT: the text, the summary, the log, the cause, the route, the file names, the
   note, the email, every key and value of environment and context, the user agent. Each one goes
   through esc() on render, and no API string is put into an inline handler: the page binds events by
   data attributes. The email is typed by the sender and NOT verified. The screenshot and the files need
   the Authorization header, so they come as blobs and the token never goes into a URL. */
'use strict'
const REP_STATUS = {new: 'New', in_progress: 'In progress', waiting_reporter: 'Waiting on reporter', closed: 'Closed', spam: 'Spam'}
const REP_STATUSES = Object.keys(REP_STATUS)
const REP_C = {new: '#9AA4B0', in_progress: '#5D62F6', waiting_reporter: '#D9A50F', closed: '#178A50', spam: '#C43D3D'}
const REP_TYPE = {bug: 'Bug', question: 'Question', idea: 'Idea'}
const REP_TYPE_C = {bug: '#C43D3D', question: '#1379B5', idea: '#178A50'}
const REP_PAGE = 50
const REP_FLAT_MAX = 200
const TOKEN_KEY = 'threepipeStaffToken'
const S = {token: '', reps: null, repsErr: '', repsBusy: false, repSeq: 0, f: {status: '', type: '', q: '', deleted: false}, rep: null}

const el = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
/* a value of one of the maps above for an API string, never an inherited property ('constructor') */
const repOwn = (m, k) => Object.prototype.hasOwnProperty.call(m, String(k)) ? m[String(k)] : undefined
/* a report id as the server makes it ('R-' and six characters), else '' */
const repId = s => /^R-[0-9A-Z]{6}$/.test(String(s || '')) ? String(s) : ''
/* a plain address, as the worker accepts it: no '?', '=' or '&', so a mailto: link cannot gain headers */
const repEmail = s => /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i.test(String(s || '')) ? String(s) : ''
/* the first line of the user's text that has words in it */
function repFirstLine(s) { return (String(s || '').split(/\r?\n/).map(x => x.trim()).find(Boolean) || '').slice(0, 160) }
function repBytes(n) {
    n = Math.max(0, Math.round(Number(n) || 0))
    if (n < 1000) return n + ' B'
    if (n < 999500) return Math.round(n / 1e3) + ' KB'
    if (n < 9.95e6) return (n / 1e6).toFixed(1) + ' MB'
    return Math.round(n / 1e6) + ' MB'
}
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
    return '/staff/reports?' + p.join('&')
}
const stamp = s => { const t = Date.parse(s); return isNaN(t) ? '' : new Date(t).toLocaleString() }

/* ---------- the API: the Authorization header, never the token in a URL ---------- */
async function api(path, init) {
    const r = await fetch(path, {...init, headers: {...(init && init.headers), authorization: 'Bearer ' + S.token}})
    if (r.status === 401) { signOut('The token was not accepted.'); throw new Error('unauthorized') }
    const ct = r.headers.get('content-type') || ''
    if (!r.ok) { const j = ct.includes('json') ? await r.json().catch(() => ({})) : {}; throw new Error(j.error || ('HTTP ' + r.status)) }
    return ct.includes('json') ? r.json() : r.blob()
}
const send = (method, path, body) => api(path, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined})

/* ---------- sign-in ---------- */
function signOut(msg) {
    sessionStorage.removeItem(TOKEN_KEY); S.token = ''
    el('app').hidden = true; el('login').hidden = false; el('loginErr').textContent = msg || ''
}
function signIn() {
    const t = el('token').value.trim(); if (!t) return
    S.token = t; sessionStorage.setItem(TOKEN_KEY, t)
    el('login').hidden = true; el('app').hidden = false
    repReload()
}

/* ---------- the list ---------- */
function repStatusPill(st) { return '<span class="pill" style="color:' + (repOwn(REP_C, st) || 'inherit') + ';font-weight:700">' + esc(repOwn(REP_STATUS, st) || st || '?') + '</span>' }
function repTypePill(t) { return '<span class="pill" style="color:' + (repOwn(REP_TYPE_C, t) || 'inherit') + '">' + esc(repOwn(REP_TYPE, t) || t || '?') + '</span>' }
function repEnvPill(env) { const e = String(env || ''); return e === 'prod' ? '' : '<span class="pill" title="Not the production site">' + esc(e || '?') + '</span>' }
function repRow(r) {
    const st = String(r.status || 'new'), gone = !!r.deleted_at
    const line = gone ? 'Deleted by ' + (r.deleted_by || '?') + ' · ' + stamp(r.deleted_at) : repFirstLine(r.summary)
    const n = Number(r.files_count) || 0
    return '<div class="row' + (gone ? ' gone' : '') + '" data-open="' + esc(repId(r.id)) + '" data-report-row>'
        + '<span class="dot" style="background:' + (repOwn(REP_C, st) || '#9AA4B0') + '"></span>'
        + '<div class="main"><div class="t">' + (line ? esc(line) : '<span class="meta">no text</span>') + '</div>'
        + '<div class="sub"><b>' + esc(r.id) + '</b> · ' + esc(stamp(r.created_at)) + ' · ' + esc(repOwn(REP_TYPE, r.type) || r.type || '') + ' · ' + esc(r.surface || '')
        + (r.cause ? ' · ' + esc(r.cause) : '') + (!gone && r.email ? ' · ' + esc(r.email) + ' (not verified)' : '') + '</div></div>'
        + repEnvPill(r.env) + (r.has_image ? '<span class="pill">screenshot</span>' : '') + (n ? '<span class="pill">' + n + ' file' + (n === 1 ? '' : 's') + ' · ' + esc(repBytes(r.files_bytes)) + '</span>' : '')
        + repStatusPill(st) + '</div>'
}
function renderFilters() {
    const f = S.f
    const opts = (list, cur, all, lab) => '<option value="">' + all + '</option>' + list.map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(lab(v)) + '</option>').join('')
    el('filters').innerHTML = '<h1>threepipe reports</h1>'
        + '<button data-status="" class="' + (f.status ? '' : 'on') + '">All</button>'
        + REP_STATUSES.map(st => '<button data-status="' + st + '" class="' + (f.status === st ? 'on' : '') + '">' + esc(REP_STATUS[st]) + '</button>').join('')
        + '<select data-type-filter>' + opts(Object.keys(REP_TYPE), f.type, 'All types', t => REP_TYPE[t]) + '</select>'
        + '<input data-q placeholder="Report id or email, then Enter" autocomplete="off" value="' + esc(f.q) + '">'
        + '<button data-deleted class="' + (f.deleted ? 'on' : '') + '">Show deleted</button>'
        + '<button data-reload>↻</button><button data-signout>Sign out</button>'
}
function renderList() {
    renderFilters()
    let h
    if (!S.reps) h = '<p class="meta">' + (S.repsErr ? 'Could not read the reports: ' + esc(S.repsErr) : 'Reading the reports…') + '</p>'
    else {
        h = S.reps.rows.length ? S.reps.rows.map(repRow).join('') : '<p class="meta">No reports match these filters.</p>'
        if (S.reps.next) h += '<button data-more style="width:100%"' + (S.repsBusy ? ' disabled' : '') + '>' + (S.repsBusy ? 'Reading…' : 'Load more') + '</button>'
        if (S.repsErr) h += '<p class="err">Could not read more: ' + esc(S.repsErr) + '</p>'
    }
    el('list').innerHTML = '<p class="meta">Reports that people send from threepipe apps. Everything in a report is user input; the email is typed and nobody verified it.</p>' + h
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

/* ---------- one report, in the drawer ---------- */
const kv = (k, v) => v === undefined || v === null || v === '' ? '' : '<div class="kv"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>'
const box = (title, body) => '<div class="box"><h3>' + esc(title) + '</h3>' + body + '</div>'
async function openReport(id) {
    id = repId(id); if (!id) return
    repRelease()
    S.rep = {id, busy: true, err: '', row: null, files: [], report: null, img: ''}
    drawReport()
    await repLoad()
}
async function repLoad() {
    const r = S.rep; if (!r) return
    try {
        const j = await api('/staff/reports/' + encodeURIComponent(r.id))
        if (S.rep !== r) return
        r.row = j.row || {}; r.files = Array.isArray(j.files) ? j.files : []; r.report = j.report || null
    } catch (e) { if (S.rep === r) r.err = String(e && e.message || e) }
    r.busy = false
    drawReport()
    if (r.row && r.row.has_image && !r.img) {
        try {
            const b = await api('/staff/reports/' + encodeURIComponent(r.id) + '/image')
            if (S.rep !== r) return
            r.img = URL.createObjectURL(b); drawReport()
        } catch (e) { /* the image box says it is missing */ }
    }
}
/* the drawer closes or shows another report: the image URL goes */
function repRelease() { const r = S.rep; S.rep = null; if (r && r.img) URL.revokeObjectURL(r.img) }
function drawReport() {
    const r = S.rep
    if (!r) { el('drawer').innerHTML = ''; return }
    const row = r.row || {}, rep = r.report || {}, gone = !!row.deleted_at
    let h = '<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Report ' + esc(r.id) + '</h2><button data-close>✕</button></div>'
    if (r.busy) { el('drawer').innerHTML = h + '<p class="meta">Reading the report…</p>'; return }
    if (r.err) { el('drawer').innerHTML = h + '<p class="err">Could not read the report: ' + esc(r.err) + '</p>'; return }
    h += '<p>' + repTypePill(row.type) + repEnvPill(row.env) + repStatusPill(row.status) + '<span class="meta">sent ' + esc(stamp(row.created_at)) + '</span></p>'
    if (gone) {
        el('drawer').innerHTML = h + box('Deleted', '<p>Deleted by ' + esc(row.deleted_by || '?') + ' on ' + esc(stamp(row.deleted_at)) + '. The text, the log, the screenshot and the files are gone. The row keeps the id and the dates.</p>'
            + kv('Type', row.type) + kv('Surface', row.surface) + kv('Cause', row.cause) + kv('Status', repOwn(REP_STATUS, row.status) || row.status))
        return
    }
    const stOpts = REP_STATUSES.map(s => '<option value="' + s + '"' + (s === row.status ? ' selected' : '') + '>' + esc(REP_STATUS[s]) + '</option>').join('')
    h += box('Status', '<p><select data-set-status>' + stOpts + '</select> <span class="meta">' + (row.status_by ? 'Set by ' + esc(row.status_by) + ' · ' + esc(stamp(row.status_at)) : 'Nobody changed the status yet.') + '</span></p>'
        + '<textarea id="repNote" maxlength="2000" rows="3" style="width:100%" placeholder="A note for the team; the sender does not see it">' + esc(row.note || '') + '</textarea>'
        + '<p><button data-save-note>Save note</button> <button data-delete style="color:var(--lost)">Delete report</button></p>')
    h += box('What the sender wrote', (rep.text ? '<div class="text">' + esc(rep.text) + '</div>' : '<p class="meta">No text.</p>')
        + kv('Email', rep.email ? rep.email + ' (typed, not verified)' : '') + (repEmail(rep.email) ? '<p><a data-mailto href="mailto:' + esc(repEmail(rep.email)) + '?subject=' + encodeURIComponent('Your threepipe report ' + r.id) + '">Reply by e-mail</a></p>' : '')
        + kv('Surface', row.surface) + kv('Route', rep.route) + kv('Site', row.env))
    const c = rep.cause && typeof rep.cause === 'object' ? rep.cause : {}
    if (c.kind) h += box('Cause', kv('Kind', c.kind) + kv('File type', c.ext ? '.' + c.ext : '') + kv('Message', c.message) + kv('Top frame', c.frame))
    h += box('Screenshot', r.img ? '<img class="shot" alt="The screenshot the sender attached" src="' + esc(r.img) + '">' : '<p class="meta">' + (row.has_image ? 'Reading the screenshot…' : 'No screenshot came with this report.') + '</p>')
    h += box('Files · ' + r.files.length, r.files.length ? r.files.map(f => '<div class="kv"><b>' + esc(f.name || '(name removed)') + '</b><span>' + esc(repBytes(f.size)) + ' · ' + esc(f.state)
        + (f.state === 'done' ? ' <button data-file="' + Number(f.idx) + '">Download</button>' : '') + '</span></div>').join('') : '<p class="meta">No files came with this report.</p>')
    h += box('Versions', repFlat(row.versions || rep.versions || {}).map(x => kv(x[0], x[1])).join('') || '<p class="meta">None sent.</p>')
    for (const [title, v] of [['Environment', rep.environment], ['Context', rep.context]]) {
        const p = repFlat(v); h += box(title, p.length ? p.map(x => kv(x[0], x[1])).join('') : '<p class="meta">Nothing sent.</p>')
    }
    const log = Array.isArray(rep.log) ? rep.log : []
    h += box('Log · ' + log.length + ' line' + (log.length === 1 ? '' : 's'), log.length ? '<pre data-log>' + esc(log.map(repVal).join('\n')) + '</pre>' : '<p class="meta">No log lines.</p>')
    const q = rep.request && typeof rep.request === 'object' ? rep.request : {}
    h += box('Request', kv('Cloudflare ray', q.ray) + kv('Country', q.country) + kv('Browser', q.user_agent) + kv('Page origin', rep.origin) + kv('Discord card', row.discord_state))
    el('drawer').innerHTML = h
}
/* PATCH {status} or {note}; the answer is the report as GET gives it. The actor is the token's name, set by the worker. */
async function repPatch(body) {
    const r = S.rep; if (!r) return
    try {
        const j = await send('PATCH', '/staff/reports/' + encodeURIComponent(r.id), body)
        if (S.rep !== r) return
        r.row = j.row || r.row; r.files = j.files || r.files; r.report = j.report || r.report
        if (S.reps) S.reps.rows = S.reps.rows.map(x => x.id === r.id ? {...x, status: r.row.status, note: r.row.note} : x)
        renderList(); drawReport()
    } catch (e) { alert('Save failed: ' + e.message) }
}
async function repFileGet(i) {
    const r = S.rep; if (!r) return
    const f = r.files.find(x => Number(x.idx) === i); if (!f) return
    try {
        const b = await api('/staff/reports/' + encodeURIComponent(r.id) + '/files/' + i)
        const url = URL.createObjectURL(new Blob([b], {type: 'application/octet-stream'}))
        const a = document.createElement('a')
        a.href = url; a.download = r.id + '-' + String(f.name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { alert('Download failed: ' + e.message) }
}
async function repDelete() {
    const r = S.rep; if (!r || !r.row) return
    if (!confirm('Delete report ' + r.id + ' for good?\n\nThe text, the log, the screenshot and the files go now. The row stays with the id, the dates and your name as the person who deleted it.')) return
    try { await send('DELETE', '/staff/reports/' + encodeURIComponent(r.id)) } catch (e) { alert('Delete failed: ' + e.message); return }
    repRelease(); drawReport(); repReload()
}

/* ---------- events: by data attributes, never an API string in a handler ---------- */
document.addEventListener('click', e => {
    const t = e.target.closest('[data-open],[data-status],[data-deleted],[data-reload],[data-signout],[data-more],[data-close],[data-save-note],[data-delete],[data-file],[data-staff-signin]')
    if (!t) return
    if (t.hasAttribute('data-staff-signin')) signIn()
    else if (t.hasAttribute('data-open')) openReport(t.getAttribute('data-open'))
    else if (t.hasAttribute('data-status')) { const v = t.getAttribute('data-status'); S.f.status = REP_STATUSES.includes(v) ? v : ''; repReload() }
    else if (t.hasAttribute('data-deleted')) { S.f.deleted = !S.f.deleted; repReload() }
    else if (t.hasAttribute('data-reload')) repReload()
    else if (t.hasAttribute('data-signout')) signOut('')
    else if (t.hasAttribute('data-more')) { if (!S.repsBusy && S.reps && S.reps.next) loadReports(true) }
    else if (t.hasAttribute('data-close')) { repRelease(); drawReport() }
    else if (t.hasAttribute('data-save-note')) { const v = el('repNote').value.trim(); repPatch({note: v || null}) }
    else if (t.hasAttribute('data-delete')) repDelete()
    else if (t.hasAttribute('data-file')) repFileGet(Number(t.getAttribute('data-file')))
})
document.addEventListener('change', e => {
    const t = e.target
    if (t.matches('[data-type-filter]')) { S.f.type = repOwn(REP_TYPE, t.value) ? t.value : ''; repReload() }
    else if (t.matches('[data-set-status]') && REP_STATUSES.includes(t.value)) repPatch({status: t.value})
})
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    if (e.target.matches('[data-q]')) { S.f.q = String(e.target.value || '').trim().slice(0, 200); repReload() }
    else if (e.target.matches('[data-staff-token]')) signIn()
})
window.addEventListener('DOMContentLoaded', () => {
    S.token = sessionStorage.getItem(TOKEN_KEY) || ''
    if (S.token) { el('app').hidden = false; repReload() } else el('login').hidden = false
})
