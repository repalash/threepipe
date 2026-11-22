import {
    getFileContent, getToken, getViewedStates, GitHubError, loadChangeSet, paramsToTarget, parseTarget,
    listPullRequests, searchMyPullRequests, setFileViewed, setToken, targetToParams,
} from './github.js'
import {ensureLanguage, languageForPath, languageName, loadMonaco, MONACO_THEME} from './editor.js'
import {SideBySideViewer} from './sbs.js'
import {FileTree} from './tree.js'
import {fileIcon, icons, isImagePath} from './icons.js'
import {formatWhen, LogView} from './log.js'
import {onDoubleShift, Palette} from './palette.js'

const $ = (s, el = document) => el.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])
const short = (sha) => (sha || '').slice(0, 8)
const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

// --- small persistent settings (per browser; everything works without storage) ---

const store = {
    get(key, def) {
        try { const v = localStorage.getItem('prv.' + key); return v === null ? def : JSON.parse(v) } catch { return def }
    },
    set(key, v) {
        try { localStorage.setItem('prv.' + key, JSON.stringify(v)) } catch { /* no storage */ }
    },
}

const mobileQuery = window.matchMedia('(max-width: 760px)')
const settings = {
    view: store.get('view', null), // null: side-by-side on wide screens, unified on phones
    align: store.get('align', false), // "Align Changes In Side-by-Side Diff"
    syncScroll: store.get('syncScroll', true),
    ignore: store.get('ignore', 'none'), // 'none' | 'trim' | 'all'
    highlight: store.get('highlight', 'words'), // 'words' | 'lines' | 'none'
    collapseUnchanged: store.get('collapseUnchanged', false),
    wordWrap: store.get('wordWrap', false),
    fontSize: store.get('fontSize', null),
}
const viewMode = () => settings.view || (mobileQuery.matches ? 'unified' : 'sbs')
/** Which viewer renders: the JetBrains-style side-by-side, or Monaco's diff editor (unified, or aligned side-by-side). */
const renderer = () => viewMode() === 'sbs' && !settings.align ? 'sbs' : 'monaco'
const fontSize = () => settings.fontSize || (mobileQuery.matches ? 12 : 13)
const lineHeight = () => Math.round(fontSize() * 1.54)

// --- toasts, menus, dialogs ---

function toast(message, kind = 'info', ms = 4000) {
    const el = document.createElement('div')
    el.className = `toast toast-${kind}`
    el.textContent = message
    $('#toasts').appendChild(el)
    setTimeout(() => el.classList.add('out'), ms)
    setTimeout(() => el.remove(), ms + 400)
}

function openMenu(anchor, items, {align = 'left', search = null} = {}) {
    const menu = $('#menu')
    menu.innerHTML = (search ? `<label class="menu-search">${icons.search}<input placeholder="${esc(search)}" spellcheck="false" autocomplete="off"></label>` : '') + items.map((it, i) => it === '-' ? '<div class="menu-sep"></div>'
        : it.html ? `<div class="menu-html">${it.html}</div>`
            : `<button class="menu-item${it.checked ? ' checked' : ''}${it.active ? ' active' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
                <span class="menu-check">${it.checked ? icons.check : ''}</span>
                <span class="menu-label">${it.label}</span>${it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : ''}</button>`).join('')
    menu.hidden = false
    const r = anchor.getBoundingClientRect()
    const mw = Math.min(menu.offsetWidth, window.innerWidth - 16)
    let x = align === 'right' ? r.right - mw : r.left
    x = Math.max(8, Math.min(x, window.innerWidth - mw - 8))
    menu.style.left = x + 'px'
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - 60) + 'px'
    menu.style.maxHeight = (window.innerHeight - r.bottom - 16) + 'px'
    const input = $('.menu-search input', menu)
    if (input) {
        input.oninput = () => {
            const q = input.value.trim().toLowerCase()
            for (const b of menu.querySelectorAll('.menu-item')) b.hidden = !!q && !b.textContent.toLowerCase().includes(q)
        }
        if (!mobileQuery.matches) input.focus()
    }
    menu.onclick = (e) => {
        const b = e.target.closest('.menu-item')
        if (!b) return
        const it = items[+b.dataset.i]
        if (!it.keepOpen) closeMenu()
        it.action?.()
    }
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
    function outside(e) {
        if (menu.contains(e.target)) return
        document.removeEventListener('pointerdown', outside, true)
        closeMenu()
    }
}

function closeMenu() {
    $('#menu').hidden = true
}

function tokenDialog() {
    const dlg = $('#dialog')
    const has = !!getToken()
    dlg.innerHTML = `
        <form class="dlg" method="dialog">
            <h2>GitHub token</h2>
            <p>Needed for private repositories and to sync the <b>Viewed</b> checkboxes with GitHub. It is kept in this
            browser's storage only and sent only to <code>api.github.com</code>.</p>
            <p class="dim">Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
            with <i>Contents: read</i> and <i>Pull requests: read and write</i> (write is only for Viewed) on the repositories you review,
            or a <a href="https://github.com/settings/tokens/new?scopes=repo&description=PR%20diff%20viewer" target="_blank" rel="noopener">classic token</a> with <code>repo</code>.</p>
            <input type="password" id="tok" placeholder="${has ? 'A token is saved. Paste a new one to replace it' : 'github_pat_… or ghp_…'}" autocomplete="off" spellcheck="false">
            <div class="dlg-actions">
                ${has ? '<button type="button" id="tok-clear" class="btn btn-ghost">Remove token</button>' : ''}
                <span class="spacer"></span>
                <button type="button" id="tok-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Save</button>
            </div>
        </form>`
    dlg.showModal()
    $('#tok', dlg).focus()
    $('#tok-cancel', dlg).onclick = () => dlg.close()
    const clear = $('#tok-clear', dlg)
    if (clear) clear.onclick = () => { setToken(''); dlg.close(); toast('Token removed'); reloadTarget() }
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        const v = $('#tok', dlg).value.trim()
        if (v) { setToken(v); toast('Token saved') }
        dlg.close()
        if (v) reloadTarget()
    }
}

// --- landing page ---

function recents() { return store.get('recent', []) }
function addRecent(target, title) {
    const key = targetToParams(target).toString()
    const list = recents().filter((r) => r.key !== key)
    list.unshift({key, title, label: labelForTarget(target), at: Date.now()})
    store.set('recent', list.slice(0, 15))
}
function labelForTarget(t) {
    if (t.type === 'pr') return `${t.owner}/${t.repo}#${t.number}`
    if (t.type === 'commit') return `${t.owner}/${t.repo}@${short(t.sha)}`
    return `${t.owner}/${t.repo} ${t.base}...${t.head}`
}

function showLanding(error) {
    document.title = 'PR Diff Viewer'
    $('#app').hidden = true
    const el = $('#landing')
    el.hidden = false
    const rec = recents()
    el.innerHTML = `
        <div class="land">
            <div class="land-head">${icons.changes}<h1>PR Diff Viewer</h1></div>
            <p class="dim">Review GitHub pull requests the way the JetBrains IDE diff shows them: a file tree of the changes and a full-file
            side-by-side diff with TextMate highlighting (Material Darker). Works on phones too.</p>
            <form id="open-form" class="land-form">
                <input id="open-input" placeholder="https://github.com/owner/repo/pull/123" autocomplete="off" spellcheck="false" autofocus>
                <button class="btn btn-primary" type="submit">Open</button>
            </form>
            <p class="dim small">Also takes <code>owner/repo#123</code>, commit URLs and compare URLs (<code>…/compare/main...feature</code>).</p>
            ${error ? `<div class="land-error">${esc(error)}</div>` : ''}
            <div class="land-row">
                <button class="btn btn-ghost" id="land-token">${icons.lock} ${getToken() ? 'GitHub token saved: change' : 'Add a GitHub token (private repositories)'}</button>
            </div>
            <div id="land-mine"></div>
            ${rec.length ? `<h3>Recent</h3><div class="land-list">${rec.map((r) => `
                <a class="land-item" href="?${esc(r.key)}"><span class="li-label">${esc(r.label)}</span><span class="li-title">${esc(r.title || '')}</span></a>`).join('')}</div>` : ''}
        </div>`
    $('#open-form').onsubmit = (e) => {
        e.preventDefault()
        const t = parseTarget($('#open-input').value)
        if (!t) return toast('Paste a GitHub pull request, commit or compare URL', 'error')
        navigate(t)
    }
    $('#land-token').onclick = tokenDialog
    if (getToken()) {
        $('#land-mine').innerHTML = '<h3>Your open pull requests</h3><div class="land-list dim small">Loading…</div>'
        searchMyPullRequests().then((prs) => {
            $('#land-mine').innerHTML = `<h3>Your open pull requests</h3><div class="land-list">${prs.length ? prs.map((p) => `
                <a class="land-item" href="?pr=${esc(`${p.owner}/${p.repo}/${p.number}`)}"><span class="li-label">${esc(`${p.owner}/${p.repo}#${p.number}`)}${p.draft ? ' <i>draft</i>' : ''}</span><span class="li-title">${esc(p.title)}</span></a>`).join('')
                : '<div class="dim small">None</div>'}</div>`
        }).catch((e) => { $('#land-mine').innerHTML = `<div class="dim small">Could not list your pull requests: ${esc(e.message)}</div>` })
    }
}

// --- app state ---

const state = {
    target: null,
    cs: null, // the loaded change set
    order: [], // files in tree order
    index: -1,
    viewed: new Set(),
    viewedRemote: null, // {id} when Viewed syncs with GitHub
    monaco: null,
    sbs: null,
    unified: null,
    differ: null,
    models: [],
    loadId: 0,
    fileLoadId: 0,
    tree: null,
}

function navigate(target, file) {
    const p = targetToParams(target)
    if (file) p.set('file', file)
    history.pushState(null, '', '?' + p.toString())
    route()
}

function reloadTarget() {
    if (state.target) route(true)
}

async function route(force = false) {
    const params = new URLSearchParams(location.search)
    const target = paramsToTarget(params)
    if (!target) {
        state.cs = null
        state.key = null
        return showLanding()
    }
    const file = params.get('file')
    const key = targetToParams(target).toString()
    if (!force && state.cs && state.key === key) {
        if (file && file !== state.order[state.index]?.path) selectFile(file, false)
        return
    }
    state.key = key
    await openTarget(target, file)
}

async function openTarget(target, file) {
    const id = ++state.loadId
    state.target = target
    $('#landing').hidden = true
    $('#app').hidden = false
    buildShell()
    setLoading(true)
    $('#title').textContent = labelForTarget(target)
    $('#tree').innerHTML = '<div class="tree-msg dim">Loading changes…</div>'
    showMessage('')
    let cs
    try {
        ;[cs] = await Promise.all([loadChangeSet(target), ensureMonaco()])
    } catch (e) {
        if (id !== state.loadId) return
        setLoading(false)
        console.error(e)
        return showLanding(e instanceof GitHubError ? `${labelForTarget(target)}: ${e.message}` : String(e.message || e))
    }
    if (id !== state.loadId) return
    state.cs = cs
    addRecent(target, cs.title)
    document.title = `${cs.title} · ${labelForTarget(target)}`
    renderHeader()
    state.tree.setFiles(cs.files)
    state.order = state.tree.order
    loadViewed()
    if (!cs.files.length) {
        setLoading(false)
        updateToolbar()
        return showMessage('No changed files')
    }
    const start = file ? state.order.findIndex((f) => f.path === file) : 0
    await openFileAt(start >= 0 ? start : 0, false)
}

async function ensureMonaco() {
    if (state.monaco) return state.monaco
    state.monaco = await loadMonaco()
    return state.monaco
}

// --- shell ---

let shellBuilt = false
function buildShell() {
    if (shellBuilt) return
    shellBuilt = true
    const app = $('#app')
    app.innerHTML = `
        <header class="titlebar">
            <button class="tb-btn only-mobile" id="btn-drawer" title="Changed files">${icons.menu}</button>
            <a class="proj" id="proj" href="./" title="Open another pull request"><span class="proj-badge" id="proj-badge"></span><span class="proj-name" id="proj-name"></span></a>
            <span class="branch hide-mobile" id="branch"></span>
            <span class="tb-title" id="title"></span>
            <span class="state-pill" id="state-pill"></span>
            <span class="spacer"></span>
            <button class="tb-btn" id="btn-search" title="Search Everywhere (Double Shift)">${icons.search}</button>
            <a class="tb-btn" id="btn-github" target="_blank" rel="noopener" title="Open on GitHub">${icons.github}</a>
            <button class="tb-btn" id="btn-token" title="GitHub token">${icons.lock}</button>
        </header>
        <div class="main">
            <nav class="strip hide-mobile">
                <button class="strip-btn active" id="strip-changes" title="Changes">${icons.commit}</button>
                <button class="strip-btn" id="strip-prs" title="Pull requests of the repository">${icons.pr}</button>
                <button class="strip-btn" id="strip-home" title="Open another pull request">${icons.folder}</button>
            </nav>
            <aside class="side" id="side">
                <div class="side-head">
                    <button class="side-title" id="side-title" title="Choose a commit"><span id="side-title-text">Changes</span>${icons.chevronDown}</button>
                    <button class="tb-btn only-mobile" id="btn-drawer-close" title="Close">${icons.close}</button>
                </div>
                <div class="pr-head" id="pr-head" hidden>
                    <div class="pr-title" id="pr-title"></div>
                    <a class="pr-link" id="pr-link" target="_blank" rel="noopener">View on GitHub</a>
                    <div class="pr-from"><span>Changes from</span>
                        <button class="pr-commits" id="pr-commits"></button>
                        <span class="pr-branch" id="pr-branch"></span>
                    </div>
                </div>
                <div class="side-tools">
                    <button class="tb-btn" id="btn-expand" title="Expand All">${icons.expand}</button>
                    <button class="tb-btn" id="btn-collapse" title="Collapse All">${icons.collapse}</button>
                    <button class="tb-btn" id="btn-reload" title="Reload">${icons.refresh}</button>
                    <span class="spacer"></span>
                    <span class="viewed-count" id="viewed-count" title="Files marked as viewed"></span>
                </div>
                <div class="tree" id="tree"></div>
                <div class="prl" id="prl" hidden>
                    <div class="prl-tools">
                        <label class="log-search">${icons.search}<input id="prl-search" placeholder="Search pull requests" spellcheck="false" autocomplete="off"></label>
                    </div>
                    <div class="prl-filters"><button class="prl-state" id="prl-state"></button><span class="spacer"></span><button class="tb-btn" id="prl-reload" title="Reload">${icons.refresh}</button></div>
                    <div class="prl-list" id="prl-list"></div>
                </div>
            </aside>
            <div class="splitter hide-mobile" id="splitter"></div>
            <div class="scrim only-mobile" id="scrim"></div>
            <section class="content">
                <div class="tabs">
                    <button class="tab" id="tab-log" title="Commits">${icons.log}<span>Log</span></button>
                    <button class="tab active" id="tab-changes">${icons.changes}<span id="tab-label">Changes</span></button>
                </div>
                <div class="log-host" id="log-host" hidden></div>
                <div class="toolbar" id="toolbar">
                    <button class="tb-btn" id="btn-prev-diff" title="Previous Difference (Shift+F7)">${icons.up}</button>
                    <button class="tb-btn" id="btn-next-diff" title="Next Difference (F7)">${icons.down}</button>
                    <a class="tb-btn hide-mobile" id="btn-open-file" target="_blank" rel="noopener" title="Open the file on GitHub">${icons.pencil}</a>
                    <button class="tb-btn" id="btn-prev-file" title="Previous File (Alt+←)">${icons.left}</button>
                    <span class="file-pos" id="file-pos"></span>
                    <button class="tb-btn" id="btn-next-file" title="Next File (Alt+→)">${icons.right}</button>
                    <span class="spacer"></span>
                    <label class="viewed-toggle" title="Mark the file as viewed (V)"><input type="checkbox" id="chk-viewed"><span>Viewed</span></label>
                    <span class="diff-count" id="diff-count"></span>
                    <div class="seg">
                        <button class="tb-btn" id="btn-sbs" title="Side-by-side viewer">${icons.sideBySide}</button>
                        <button class="tb-btn" id="btn-unified" title="Unified viewer">${icons.unified}</button>
                    </div>
                    <button class="tb-btn" id="btn-settings" title="Settings">${icons.gear}</button>
                </div>
                <div class="viewer" id="viewer" data-hl="${settings.highlight}">
                    <div class="view" id="view-sbs"></div>
                    <div class="view" id="view-unified">
                        <div class="uni-head" id="uni-head"><span id="uni-left"></span><span id="uni-right"></span></div>
                        <div class="uni-ed" id="uni-ed"></div>
                    </div>
                    <div class="view view-msg" id="view-msg"></div>
                    <div class="loading-bar" id="loading-bar"></div>
                </div>
            </section>
        </div>
        <footer class="statusbar hide-mobile">
            <span id="st-lang"></span><span class="spacer"></span><span id="st-stat"></span><span id="st-pos"></span>
        </footer>`

    state.tree = new FileTree($('#tree'), {
        onSelect: (path) => { selectFile(path); closeDrawer() },
        onToggleViewed: (path) => { const f = state.order.find((x) => x.path === path); if (f) toggleViewed(f, !state.viewed.has(path)) },
    })
    $('#pr-commits').onclick = (e) => commitMenu(e.currentTarget)
    $('#strip-prs').onclick = () => setSidePanel(state.sidePanel === 'prs' ? 'changes' : 'prs')
    $('#prl-state').onclick = (e) => openMenu(e.currentTarget, ['open', 'closed', 'merged', 'all'].map((v) => ({
        label: v[0].toUpperCase() + v.slice(1), checked: state.prlState === v, action: () => { state.prlState = v; loadPrList() },
    })))
    $('#prl-reload').onclick = () => loadPrList()
    let prlTimer
    $('#prl-search').oninput = () => { clearTimeout(prlTimer); prlTimer = setTimeout(loadPrList, 450) }
    $('#prl-list').onclick = (e) => {
        const a = e.target.closest('.prl-item')
        if (!a) return
        e.preventDefault()
        setSidePanel('changes')
        closeDrawer()
        navigate({type: 'pr', owner: state.target.owner, repo: state.target.repo, number: +a.dataset.n})
    }
    $('#btn-prev-diff').onclick = () => stepDiff(-1)
    $('#btn-next-diff').onclick = () => stepDiff(1)
    $('#btn-prev-file').onclick = () => stepFile(-1)
    $('#btn-next-file').onclick = () => stepFile(1)
    $('#btn-sbs').onclick = () => setView('sbs')
    $('#btn-unified').onclick = () => setView('unified')
    $('#btn-settings').onclick = (e) => settingsMenu(e.currentTarget)
    $('#btn-token').onclick = tokenDialog
    $('#btn-expand').onclick = () => state.tree.collapseAll(false)
    $('#btn-collapse').onclick = () => state.tree.collapseAll(true)
    $('#btn-reload').onclick = () => reloadTarget()
    $('#tab-log').onclick = () => setTab('log')
    $('#tab-changes').onclick = () => setTab('changes')
    $('#side-title').onclick = (e) => state.sidePanel !== 'prs' && commitMenu(e.currentTarget)
    $('#chk-viewed').onchange = (e) => toggleViewed(state.order[state.index], e.target.checked)
    $('#btn-drawer').onclick = openDrawer
    $('#btn-drawer-close').onclick = closeDrawer
    $('#scrim').onclick = closeDrawer
    $('#strip-changes').onclick = () => {
        if (state.sidePanel === 'prs') return setSidePanel('changes')
        document.body.classList.toggle('side-hidden')
    }
    $('#strip-home').onclick = () => { history.pushState(null, '', './'); route() }
    // the project chip opens the repository's pull requests, as the IDE's Pull Requests tool window
    $('#proj').onclick = (e) => { e.preventDefault(); setSidePanel('prs'); openDrawer() }
    setupSplitter()
    setupPalette()
    window.addEventListener('keydown', onKey, true)
    mobileQuery.addEventListener('change', () => {
        if (!settings.view) applyView()
        applyFont()
    })
}

function setupSplitter() {
    const side = $('#side')
    const w = store.get('sideWidth', 300)
    side.style.width = w + 'px'
    const sp = $('#splitter')
    sp.addEventListener('pointerdown', (e) => {
        sp.setPointerCapture(e.pointerId)
        const startX = e.clientX, startW = side.offsetWidth
        const move = (ev) => { side.style.width = Math.max(180, Math.min(700, startW + ev.clientX - startX)) + 'px' }
        const up = () => {
            sp.removeEventListener('pointermove', move)
            sp.removeEventListener('pointerup', up)
            store.set('sideWidth', side.offsetWidth)
        }
        sp.addEventListener('pointermove', move)
        sp.addEventListener('pointerup', up)
    })
}

function setSidePanel(which) {
    state.sidePanel = which
    const prs = which === 'prs'
    document.body.classList.remove('side-hidden')
    $('#strip-changes').classList.toggle('active', !prs)
    $('#strip-prs').classList.toggle('active', prs)
    $('#prl').hidden = !prs
    for (const id of ['#tree', '.side-tools']) $(id).hidden = prs
    $('#pr-head').hidden = prs || !state.cs?.pr
    $('.side-head').classList.toggle('prs', prs)
    $('#side-title-text').textContent = prs ? `Pull Requests · ${state.target.repo}` : sideTitle()
    $('#side-title').classList.toggle('no-menu', prs || !state.cs?.commits?.length)
    if (prs) loadPrList()
}

async function loadPrList() {
    const t = state.target
    state.prlState ??= 'open'
    $('#prl-state').innerHTML = `${state.prlState[0].toUpperCase() + state.prlState.slice(1)} ${icons.chevronDown}`
    const id = (state.prlLoad = (state.prlLoad || 0) + 1)
    const list = $('#prl-list')
    list.innerHTML = '<div class="tree-msg dim">Loading…</div>'
    try {
        const prs = await listPullRequests(t.owner, t.repo, {state: state.prlState, text: $('#prl-search').value})
        if (id !== state.prlLoad) return
        list.innerHTML = prs.map((p) => `
            <a class="prl-item${t.type === 'pr' && t.number === p.number ? ' sel' : ''}" data-n="${p.number}" href="?pr=${esc(`${t.owner}/${t.repo}/${p.number}`)}">
                <div class="prl-row"><span class="prl-title">${esc(p.title)}</span>${p.draft ? '<span class="prl-draft">DRAFT</span>' : ''}
                    <span class="prl-com" title="Comments">${icons.comment}${p.comments}</span></div>
                <div class="prl-meta">#${p.number} · created ${esc(dayOf(p.created))}, by ${esc(p.user || '')}${p.state !== 'open' ? ` · ${p.state}` : ''}</div>
            </a>`).join('') || '<div class="tree-msg dim">No pull requests</div>'
    } catch (e) {
        if (id === state.prlLoad) list.innerHTML = `<div class="tree-msg dim">${esc(e.message)}</div>`
    }
}

function dayOf(iso) {
    const d = new Date(iso), now = new Date()
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const days = Math.round((day(now) - day(d)) / 86400000)
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, {year: '2-digit', month: '2-digit', day: '2-digit'})
}

function openDrawer() { document.body.classList.add('drawer-open') }
function closeDrawer() { document.body.classList.remove('drawer-open') }

function renderHeader() {
    const {cs, target} = state
    const initials = target.repo.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'R'
    $('#proj-badge').textContent = initials
    $('#proj-name').textContent = target.repo
    $('#proj').title = `${target.owner}/${target.repo}: open another pull request`
    const pr = cs.pr
    $('#branch').innerHTML = pr ? `${icons.branch}<span>${esc(pr.head.ref)}</span>` : ''
    $('#branch').title = pr ? `${pr.head.label} → ${pr.base.label}` : ''
    $('#title').innerHTML = pr ? `<span class="dim">#${pr.number}</span> ${esc(cs.title)}` : esc(cs.title)
    $('#title').title = cs.title
    const pill = $('#state-pill')
    if (pr) {
        const s = pr.merged_at ? 'merged' : pr.draft ? 'draft' : pr.state
        pill.textContent = s[0].toUpperCase() + s.slice(1)
        pill.className = `state-pill st-${s}`
    } else pill.className = 'state-pill hidden'
    $('#btn-github').href = cs.htmlUrl + (pr && !cs.commit ? '/files' : '')
    const what = cs.range ? `Commits ${short(cs.range[0])}..${short(cs.range[1])}` : cs.commit ? `Commit ${short(cs.headSha)}` : `Changes Between ${short(cs.baseSha) || '∅'} and ${short(cs.headSha)}`
    $('#tab-log').hidden = !cs.commits?.length
    if (cs.commits?.length) {
        state.log ??= new LogView($('#log-host'), {onOpen: openCommitSpec})
        state.log.setCommits(cs.commits, {owner: target.owner, repo: target.repo, selected: target.commit || (target.type === 'commit' ? target.sha : null), headRef: pr?.head.ref})
    }
    state.sideTitle = what
    $('#side-title-text').textContent = state.sidePanel === 'prs' ? $('#side-title-text').textContent : what
    $('#side-title').classList.toggle('no-menu', !(cs.commits?.length))
    // the IDE's PR view: the title, then "Changes from N commits ▾" and the branch
    $('#side').classList.toggle('is-pr', !!pr)
    $('#pr-head').hidden = !pr || state.sidePanel === 'prs'
    if (pr) {
        $('#pr-title').innerHTML = `${esc(pr.title)} <span class="dim">#${pr.number}</span>`
        $('#pr-link').href = pr.html_url
        const n = cs.commits?.length || 0
        $('#pr-commits').innerHTML = (cs.range ? `${short(cs.range[0])}..${short(cs.range[1])}`
            : cs.commit ? `commit ${short(cs.headSha)}` : `${n} commit${n === 1 ? '' : 's'}`) + icons.chevronDown
        $('#pr-branch').innerHTML = `${icons.tag}<span>${esc(pr.head.ref)}</span>`
        $('#pr-branch').title = `${pr.head.label} → ${pr.base.label}`
    }
}

function sideTitle() {
    return state.sideTitle || 'Changes'
}

function commitMenu(anchor) {
    const {cs, target} = state
    if (!cs?.commits?.length) return
    const items = []
    if (target.type === 'pr') {
        items.push({label: `All commits (${cs.commits.length})`, checked: !target.commit, action: () => navigate({...target, commit: undefined})})
        items.push('-')
    }
    for (const c of cs.commits) {
        const msg = c.commit.message.split('\n')[0]
        items.push({
            label: `${esc(msg)}<div class="menu-sub">${esc(c.author?.login || c.commit.author?.name || '')}, ${esc(formatWhen(c.commit.author?.date || c.commit.committer?.date))} · <code>${short(c.sha)}</code></div>`,
            checked: !!(target.commit || (target.type === 'commit' && target.sha)) && c.sha.startsWith(target.commit || target.sha),
            action: () => target.type === 'pr' ? navigate({...target, commit: c.sha}) : navigate({type: 'commit', owner: target.owner, repo: target.repo, sha: c.sha}),
        })
    }
    openMenu(anchor, items, {search: 'Search commits'})
}

function settingsMenu(anchor) {
    const set = (k, v) => { settings[k] = v; store.set(k, v) }
    const ignore = (v) => ({label: {none: 'None', trim: 'Trim whitespaces', all: 'Ignore whitespaces'}[v], checked: settings.ignore === v, action: () => { set('ignore', v); reopenFile(true) }})
    const hl = (v) => ({label: {lines: 'Lines', words: 'Words', none: 'None'}[v], checked: settings.highlight === v, action: () => { set('highlight', v); applyHighlight() }})
    openMenu(anchor, [
        {label: 'Align Changes In Side-by-Side Diff', checked: settings.align, action: () => { set('align', !settings.align); applyView() }},
        {label: 'Synchronize Scrolling', checked: settings.syncScroll, disabled: renderer() !== 'sbs', action: () => { set('syncScroll', !settings.syncScroll); state.sbs?.setOptions({syncScroll: settings.syncScroll}) }},
        {label: `${icons.external} Show Diff on GitHub`, action: () => window.open($('#btn-github').href, '_blank', 'noopener')},
        '-',
        {html: 'Ignore Differences'},
        ignore('none'), ignore('trim'), ignore('all'),
        '-',
        {html: 'Highlighting Differences'},
        hl('lines'), hl('words'), hl('none'),
        '-',
        {label: 'Collapse Unchanged Fragments', checked: settings.collapseUnchanged, disabled: renderer() !== 'monaco', action: () => { set('collapseUnchanged', !settings.collapseUnchanged); applyMonacoOptions() }},
        {label: 'Soft-Wrap', checked: settings.wordWrap, disabled: renderer() !== 'monaco', action: () => { set('wordWrap', !settings.wordWrap); applyMonacoOptions() }},
        {label: `Increase Font Size <span class="dim">(${fontSize()}px)</span>`, hint: `${MOD}=`, action: () => changeFont(1)},
        {label: 'Decrease Font Size', hint: `${MOD}−`, action: () => changeFont(-1)},
        {label: 'Reset Font Size', hint: `${MOD}0`, action: () => changeFont(0)},
        '-',
        {label: 'GitHub Token…', action: tokenDialog},
        {label: `F7 / ⇧F7 differences · Alt+→ / Alt+← files · V viewed · ${MOD}= / ${MOD}− / ${MOD}0 editor font`, disabled: true},
    ], {align: 'right'})
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** Editor text size only (code and diff line numbers); the rest of the UI keeps its size. 0 resets. */
function changeFont(delta) {
    settings.fontSize = delta === 0 ? null : Math.max(8, Math.min(24, fontSize() + delta))
    store.set('fontSize', settings.fontSize)
    applyFont()
    toast(`Editor font ${fontSize()}px`, 'info', 1200)
}

function applyHighlight() {
    $('#viewer').dataset.hl = settings.highlight
    state.sbs?.setOptions({highlight: settings.highlight})
}

function setTab(tab) {
    const log = tab === 'log'
    $('#tab-log').classList.toggle('active', log)
    $('#tab-changes').classList.toggle('active', !log)
    $('#log-host').hidden = !log
    $('#toolbar').hidden = log
    $('#viewer').hidden = log
}

/** Opens a commit (or 'a..b' range) of the PR picked in the Log, optionally at a file. */
function openCommitSpec(spec, file) {
    const t = state.target
    const next = t.type === 'pr' ? {...t, commit: spec}
        : spec.includes('..') ? {type: 'compare', owner: t.owner, repo: t.repo, base: spec.split('..')[0] + '^', head: spec.split('..')[1]}
            : {type: 'commit', owner: t.owner, repo: t.repo, sha: spec}
    setTab('changes')
    navigate(next, file)
}

// --- viewed state ---

const viewedKey = () => `viewed.${state.target.owner}/${state.target.repo}/${state.target.type === 'pr' ? '#' + state.target.number : state.cs.headSha}`

async function loadViewed() {
    state.viewedRemote = null
    state.viewed = new Set(store.get(viewedKey(), []))
    renderViewed()
    const t = state.target
    if (t.type !== 'pr' || !getToken()) return
    const id = state.loadId
    try {
        const {id: prId, states} = await getViewedStates(t.owner, t.repo, t.number)
        if (id !== state.loadId) return
        state.viewedRemote = {id: prId}
        state.viewed = new Set([...states].filter(([, s]) => s === 'VIEWED').map(([p]) => p))
        renderViewed()
    } catch (e) {
        console.warn('Viewed state from GitHub unavailable; keeping it in this browser', e)
    }
}

function renderViewed() {
    state.tree.setViewed(state.viewed)
    const total = state.cs?.files.length || 0
    const n = state.cs ? state.cs.files.filter((f) => state.viewed.has(f.path)).length : 0
    $('#viewed-count').innerHTML = total ? `${icons.eye}<span>${n} / ${total} viewed</span>` : ''
    $('#viewed-count').title = state.viewedRemote ? 'Viewed files (synced with GitHub)' : 'Viewed files (kept in this browser; add a token to sync with GitHub)'
    const f = state.order[state.index]
    $('#chk-viewed').checked = !!f && state.viewed.has(f.path)
}

async function toggleViewed(file, viewed) {
    if (!file) return
    viewed ? state.viewed.add(file.path) : state.viewed.delete(file.path)
    renderViewed()
    if (state.viewedRemote) {
        try {
            await setFileViewed(state.viewedRemote.id, file.path, viewed)
        } catch (e) {
            toast(`GitHub did not save Viewed: ${e.message}`, 'error')
            viewed ? state.viewed.delete(file.path) : state.viewed.add(file.path)
            renderViewed()
        }
    } else store.set(viewedKey(), [...state.viewed])
}

// --- files ---

function selectFile(path, push = true) {
    const i = state.order.findIndex((f) => f.path === path)
    if (i >= 0) openFileAt(i, push)
}

function stepFile(dir) {
    const i = state.index + dir
    if (i >= 0 && i < state.order.length) openFileAt(i)
}

function reopenFile(keepScroll = true) {
    if (state.index >= 0) openFileAt(state.index, false, keepScroll)
}

async function contentOf(ref, path) {
    if (!ref) return {text: ''}
    return getFileContent(state.target.owner, state.target.repo, ref, path)
}

async function openFileAt(i, push = true, keepScroll = false) {
    if (!state.cs) return
    const f = state.order[i]
    if (!f) return
    const id = ++state.fileLoadId
    state.index = i
    state.tree.select(f.path)
    if (push) {
        const p = targetToParams(state.target)
        p.set('file', f.path)
        history.replaceState(null, '', '?' + p.toString())
    }
    const name = f.path.split('/').pop()
    $('#tab-label').textContent = state.target.type === 'pr' ? `Diff for Pull Request #${state.target.number}` : `Changes: ${name}`
    $('#tab-label').title = f.path
    $('#file-pos').textContent = `${i + 1}/${state.order.length} files`
    $('#st-lang').innerHTML = `${fileIcon(f.path)}<span>${esc(languageName(languageForPath(f.path)))}</span>`
    $('#st-stat').innerHTML = `<span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span>`
    $('#btn-open-file').href = f.status === 'removed'
        ? `https://github.com/${state.target.owner}/${state.target.repo}/blob/${state.cs.baseSha}/${f.path}`
        : `https://github.com/${state.target.owner}/${state.target.repo}/blob/${state.cs.headSha}/${f.path}`
    renderViewed()
    updateToolbar()
    setLoading(true)

    const {cs} = state
    const origPath = f.prevPath || f.path
    let orig, mod
    try {
        ;[orig, mod] = await Promise.all([
            f.status === 'added' ? {text: ''} : contentOf(cs.baseSha, origPath),
            f.status === 'removed' ? {text: ''} : contentOf(cs.headSha, f.path),
        ])
    } catch (e) {
        if (id !== state.fileLoadId) return
        setLoading(false)
        return showMessage(`Could not load ${esc(f.path)}<div class="dim small">${esc(e.message)}</div>`)
    }
    if (id !== state.fileLoadId) return

    const leftLabel = `${icons.lock}<span class="sha">${f.status === 'added' ? '∅' : short(cs.baseSha) || '∅'}</span><span class="path">${esc(origPath)}</span>`
    const rightLabel = `${f.status === 'added' ? icons.lock : ''}<span class="sha">${f.status === 'removed' ? 'Deleted' : short(cs.headSha)}</span>${state.target.type === 'pr' && !cs.commit && !cs.range ? '<span class="dim">Head of the pull request</span>' : ''}${f.prevPath ? `<span class="path">${esc(f.path)}</span>` : ''}${f.status === 'added' ? '<span class="tag tag-add">new file</span>' : ''}`

    if (orig.binary || mod.binary) {
        setLoading(false)
        return showBinary(f, orig, mod)
    }

    const monaco = state.monaco
    const lang = await ensureLanguage(monaco, languageForPath(f.path))
    if (id !== state.fileLoadId) return
    const old = state.models
    const uri = (side) => monaco.Uri.parse(`prv-${side}://${id}/${f.path.split('/').map(encodeURIComponent).join('/')}`)
    const original = monaco.editor.createModel(orig.text, lang, uri('a'))
    const modified = monaco.editor.createModel(mod.text, lang, uri('b'))
    state.models = [original, modified]
    // tokenize up front: deleted lines in the unified view otherwise can render before their colors exist
    for (const m of state.models) if (m.getLineCount() < 20000) m.tokenization.forceTokenization(m.getLineCount())

    try {
        if (renderer() === 'sbs') {
            const changes = f.status === 'added' ? [wholeInsert(modified)]
                : f.status === 'removed' ? [wholeDelete(original)]
                    : await computeDiff(original, modified)
            if (id !== state.fileLoadId) return
            showView('sbs')
            state.unified?.setModel(null)
            ensureSbs().setModels(original, modified, changes, {left: leftLabel, right: rightLabel})
            if (changes.length && !keepScroll) state.sbs.goTo(0)
        } else {
            showView('unified')
            $('#uni-left').innerHTML = leftLabel
            $('#uni-right').innerHTML = rightLabel
            $('#uni-head').classList.toggle('aligned', viewMode() === 'sbs')
            const de = ensureUnified()
            de.updateOptions(monacoOptions())
            const updated = waitForDiff(de)
            de.setModel({original, modified})
            await updated
            if (id !== state.fileLoadId) return
            if (!keepScroll && de.getLineChanges()?.length) de.revealFirstDiff?.()
        }
    } finally {
        old.forEach((m) => setTimeout(() => m.dispose(), 0))
    }
    setLoading(false)
    updateToolbar()
    prefetch(i + 1)
}

function prefetch(i) {
    const f = state.order[i]
    if (!f) return
    const {cs} = state
    if (f.status !== 'added' && cs.baseSha && !isImagePath(f.path)) contentOf(cs.baseSha, f.prevPath || f.path).catch(() => {})
    if (f.status !== 'removed' && !isImagePath(f.path)) contentOf(cs.headSha, f.path).catch(() => {})
}

function wholeInsert(model) {
    return {originalStartLineNumber: 0, originalEndLineNumber: 0, modifiedStartLineNumber: 1, modifiedEndLineNumber: model.getLineCount()}
}
function wholeDelete(model) {
    return {originalStartLineNumber: 1, originalEndLineNumber: model.getLineCount(), modifiedStartLineNumber: 0, modifiedEndLineNumber: 0}
}

function waitForDiff(de) {
    return new Promise((resolve) => {
        const d = de.onDidUpdateDiff(() => { d.dispose(); clearTimeout(t); resolve() })
        const t = setTimeout(() => { d.dispose(); resolve() }, 15000)
    })
}

/** Line changes from Monaco's diff algorithm (VS Code's), computed by a diff editor that is never shown. */
async function computeDiff(original, modified) {
    const monaco = state.monaco
    if (!state.differ) {
        const host = document.createElement('div')
        host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:400px;visibility:hidden'
        document.body.appendChild(host)
        state.differ = monaco.editor.createDiffEditor(host, {readOnly: true, renderSideBySide: true, maxComputationTime: 20000, automaticLayout: false})
    }
    const de = state.differ
    de.updateOptions({ignoreTrimWhitespace: settings.ignore === 'trim'})
    let a = original, b = modified
    if (settings.ignore === 'all') {
        // diff with all whitespace removed from each line (line numbers stay the same); word highlights would not map back
        const strip = (m) => monaco.editor.createModel(m.getLinesContent().map((l) => l.replace(/\s+/g, '')).join('\n'), 'plaintext')
        a = strip(original)
        b = strip(modified)
    }
    const updated = waitForDiff(de)
    de.setModel({original: a, modified: b})
    await updated
    const changes = de.getLineChanges() || []
    de.setModel(null) // models are disposed when the next file opens; a diff editor must not hold them then
    if (a !== original) {
        a.dispose()
        b.dispose()
        changes.forEach((c) => { c.charChanges = undefined })
    }
    return changes
}

function ensureSbs() {
    if (!state.sbs) {
        state.sbs = new SideBySideViewer($('#view-sbs'), state.monaco, {fontSize: fontSize(), lineHeight: lineHeight(), fontFamily: FONT})
        state.sbs.onScroll = () => updateToolbar()
        state.sbs.setOptions({syncScroll: settings.syncScroll, highlight: settings.highlight})
    }
    return state.sbs
}

function monacoOptions() {
    const sideBySide = viewMode() === 'sbs'
    return {
        renderSideBySide: sideBySide,
        renderOverviewRuler: !mobileQuery.matches,
        ignoreTrimWhitespace: settings.ignore !== 'none',
        hideUnchangedRegions: {enabled: settings.collapseUnchanged, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20},
        wordWrap: settings.wordWrap ? 'on' : 'off',
        diffWordWrap: settings.wordWrap ? 'on' : 'off',
        fontSize: fontSize(),
        lineHeight: lineHeight(),
    }
}

function ensureUnified() {
    if (!state.unified) {
        state.unified = state.monaco.editor.createDiffEditor($('#uni-ed'), {
            useInlineViewWhenSpaceIsLimited: false,
            enableSplitViewResizing: false,
            readOnly: true,
            domReadOnly: true,
            originalEditable: false,
            automaticLayout: true,
            minimap: {enabled: false},
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            folding: false,
            stickyScroll: {enabled: false},
            renderIndicators: true,
            renderMarginRevertIcon: false,
            renderGutterMenu: false,
            lineDecorationsWidth: 14,
            fontFamily: FONT,
            fontLigatures: false,
            contextmenu: false,
            hover: {enabled: false},
            occurrencesHighlight: 'off',
            selectionHighlight: false,
            matchBrackets: 'never',
            guides: {indentation: false},
            unicodeHighlight: {ambiguousCharacters: false, invisibleCharacters: false},
            renderValidationDecorations: 'off',
            scrollbar: {useShadows: false, verticalScrollbarSize: 12, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false},
            maxComputationTime: 20000,
            theme: MONACO_THEME,
            ...monacoOptions(),
        })
        state.unified.getModifiedEditor().onDidScrollChange(() => updateToolbar())
    }
    return state.unified
}

function applyMonacoOptions() {
    if (state.unified) state.unified.updateOptions(monacoOptions())
}

function applyFont() {
    state.sbs?.setFont(fontSize(), lineHeight())
    applyMonacoOptions()
}

function setView(mode) {
    settings.view = mode
    store.set('view', mode)
    applyView()
}

function applyView() {
    $('#btn-sbs').classList.toggle('on', viewMode() === 'sbs')
    $('#btn-unified').classList.toggle('on', viewMode() === 'unified')
    reopenFile()
}

function showView(which) {
    for (const v of ['sbs', 'unified', 'msg']) $('#view-' + v).classList.toggle('active', v === which)
    $('#btn-sbs').classList.toggle('on', viewMode() === 'sbs')
    $('#btn-unified').classList.toggle('on', viewMode() === 'unified')
}

function showMessage(html) {
    $('#view-msg').innerHTML = html ? `<div class="msg">${html}</div>` : ''
    if (html) showView('msg')
    updateToolbar()
}

function showBinary(f, orig, mod) {
    const {cs} = state
    const size = (c) => (c?.size != null ? `${(c.size / 1024).toFixed(1)} KB` : '')
    if (isImagePath(f.path)) {
        const img = (c, label) => c?.blob ? `<figure><figcaption>${label} <span class="dim">${size(c)}</span></figcaption><div class="img-box"><img src="${URL.createObjectURL(c.blob)}" alt=""></div></figure>`
            : `<figure><figcaption>${label}</figcaption><div class="img-box empty dim">none</div></figure>`
        showMessage(`<div class="img-diff">${img(orig.binary ? orig : null, short(cs.baseSha) || '∅')}${img(mod.binary ? mod : null, short(cs.headSha))}</div>`)
    } else {
        showMessage(`Binary file<div class="dim small">${size(orig) || '∅'} → ${size(mod) || '∅'}</div>`)
    }
    $('#view-msg').classList.add('active')
    updateToolbar()
}

// --- differences ---

function diffInfo() {
    if (!$('#view-msg').classList.contains('active')) {
        if (renderer() === 'sbs' && state.sbs) return {count: state.sbs.count, prev: state.sbs.canStep(-1), next: state.sbs.canStep(1)}
        if (renderer() === 'monaco' && state.unified) {
            const n = state.unified.getLineChanges()?.length || 0
            return {count: n, prev: n > 0, next: n > 0}
        }
    }
    return {count: 0, prev: false, next: false}
}

function stepDiff(dir) {
    if (renderer() === 'sbs' && state.sbs) {
        if (!state.sbs.step(dir)) {
            // past the last difference: go on to the next file, as the IDE does on a second F7
            if (dir > 0 && state.index < state.order.length - 1) stepFile(1)
            else if (dir < 0 && state.index > 0) stepFile(-1)
        }
    } else if (state.unified) {
        state.unified.goToDiff(dir > 0 ? 'next' : 'previous')
    }
    updateToolbar()
}

function updateToolbar() {
    if (!shellBuilt) return
    const d = diffInfo()
    const loading = $('#loading-bar').classList.contains('on')
    $('#diff-count').textContent = loading ? '' : d.count === 0 ? 'No differences' : `${d.count} difference${d.count === 1 ? '' : 's'}`
    $('#btn-prev-diff').disabled = !d.prev && state.index <= 0
    $('#btn-next-diff').disabled = !d.next && state.index >= state.order.length - 1
    $('#btn-prev-file').disabled = state.index <= 0
    $('#btn-next-file').disabled = state.index >= state.order.length - 1
    const cur = renderer() === 'sbs' ? state.sbs?.currentIndex() ?? -1 : -1
    $('#st-pos').textContent = cur >= 0 ? `Difference ${cur + 1} of ${d.count}` : ''
}

function setLoading(on) {
    $('#loading-bar')?.classList.toggle('on', on)
}

function onKey(e) {
    if ($('#dialog').open || state.palette?.isOpen) return
    const k = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && !e.altKey && ((e.shiftKey && k === 'a') || (!e.shiftKey && (k === 'p' || k === 'k')) || (e.shiftKey && k === 'o'))) {
        // Find Action (Ctrl/⌘+Shift+A), Go to File (Ctrl/⌘+P, Ctrl/⌘+Shift+O), Search Everywhere (Ctrl/⌘+K)
        e.preventDefault()
        return state.palette.open(k === 'a' ? 'actions' : k === 'k' ? 'all' : 'files')
    }
    if (e.target.closest?.('input, textarea') && !e.target.closest('.monaco-editor')) return
    const mod = e.metaKey || e.ctrlKey
    // the editor font: Ctrl/⌘ + = − 0 (instead of zooming the page), or Alt+Shift+. / , as in JetBrains IDEs
    if ((mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0'))
        || (e.altKey && e.shiftKey && (e.code === 'Period' || e.code === 'Comma'))) {
        e.preventDefault()
        return changeFont(e.key === '0' ? 0 : (e.key === '=' || e.key === '+' || e.code === 'Period') ? 1 : -1)
    }
    if (e.key === 'F7') {
        e.preventDefault()
        stepDiff(e.shiftKey ? -1 : 1)
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        stepFile(e.key === 'ArrowRight' ? 1 : -1)
    } else if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const f = state.order[state.index]
        if (f) { e.preventDefault(); toggleViewed(f, !state.viewed.has(f.path)) }
    } else if (e.key === 'Escape') {
        closeMenu()
        closeDrawer()
    }
}

// --- Search Everywhere (double Shift) ---

function setSetting(k, v) {
    settings[k] = v
    store.set(k, v)
}

function actionItems() {
    const s = settings
    const f = state.order[state.index]
    const t = state.target
    const A = (label, run, extra = {}) => ({label, run, icon: `<span class="fi fi-glyph pal-ai">${extra.ic || icons.gear}</span>`, ...extra})
    return [
        A('Next Difference', () => stepDiff(1), {hint: 'F7', ic: icons.down}),
        A('Previous Difference', () => stepDiff(-1), {hint: '⇧F7', ic: icons.up}),
        A('Next File', () => stepFile(1), {hint: 'Alt+→', ic: icons.right}),
        A('Previous File', () => stepFile(-1), {hint: 'Alt+←', ic: icons.left}),
        f && A(state.viewed.has(f.path) ? 'Unmark File as Viewed' : 'Mark File as Viewed', () => toggleViewed(f, !state.viewed.has(f.path)), {hint: 'V', ic: icons.check}),
        A('Side-by-Side Viewer', () => setView('sbs'), {toggle: viewMode() === 'sbs', ic: icons.sideBySide}),
        A('Unified Viewer', () => setView('unified'), {toggle: viewMode() === 'unified', ic: icons.unified}),
        A('Align Changes In Side-by-Side Diff', () => { setSetting('align', !s.align); applyView() }, {toggle: s.align}),
        A('Synchronize Scrolling', () => { setSetting('syncScroll', !s.syncScroll); state.sbs?.setOptions({syncScroll: s.syncScroll}) }, {toggle: s.syncScroll}),
        ...[['none', 'None'], ['trim', 'Trim Whitespaces'], ['all', 'Ignore Whitespaces']].map(([v, l]) =>
            A(`Ignore Differences: ${l}`, () => { setSetting('ignore', v); reopenFile(true) }, {toggle: s.ignore === v})),
        ...[['lines', 'Lines'], ['words', 'Words'], ['none', 'None']].map(([v, l]) =>
            A(`Highlighting Differences: ${l}`, () => { setSetting('highlight', v); applyHighlight() }, {toggle: s.highlight === v})),
        A('Collapse Unchanged Fragments', () => { setSetting('collapseUnchanged', !s.collapseUnchanged); applyMonacoOptions() }, {toggle: s.collapseUnchanged}),
        A('Soft-Wrap', () => { setSetting('wordWrap', !s.wordWrap); applyMonacoOptions() }, {toggle: s.wordWrap}),
        A('Increase Font Size', () => changeFont(1), {hint: `${MOD}=`, sub: `editor, now ${fontSize()}px`}),
        A('Decrease Font Size', () => changeFont(-1), {hint: `${MOD}−`}),
        A('Reset Font Size', () => changeFont(0), {hint: `${MOD}0`}),
        A('Expand All', () => state.tree.collapseAll(false), {ic: icons.expand}),
        A('Collapse All', () => state.tree.collapseAll(true), {ic: icons.collapse}),
        state.cs?.commits?.length && A('Show Log', () => setTab('log'), {ic: icons.log}),
        A('Show Diff', () => setTab('changes'), {ic: icons.changes}),
        A('Pull Requests', () => { setSidePanel('prs'); openDrawer() }, {sub: `${t.owner}/${t.repo}`, ic: icons.pr}),
        A('Changed Files', () => { setSidePanel('changes'); openDrawer() }, {ic: icons.commit}),
        A('Open on GitHub', () => window.open($('#btn-github').href, '_blank', 'noopener'), {ic: icons.github}),
        f && A('Open File on GitHub', () => window.open($('#btn-open-file').href, '_blank', 'noopener'), {ic: icons.external}),
        A('Reload', () => reloadTarget(), {ic: icons.refresh}),
        A('GitHub Token…', tokenDialog, {ic: icons.lock}),
        A('Open Another Pull Request', () => { history.pushState(null, '', location.pathname); route() }, {ic: icons.folder}),
    ].filter(Boolean)
}

function setupPalette() {
    const sources = {
        files: {
            title: 'Files', limit: 8,
            items: () => state.order.map((f) => {
                const parts = f.path.split('/')
                const name = parts.pop()
                return {label: name, sub: parts.join('/'), alt: f.path, icon: fileIcon(f.path), cls: `st-${f.status}`,
                    hint: state.viewed.has(f.path) ? '✓ viewed' : '', run: () => selectFile(f.path)}
            }),
        },
        actions: {title: 'Actions', limit: 8, items: actionItems},
        commits: {
            title: 'Commits', limit: 5,
            items: () => (state.cs?.commits || []).map((c) => ({
                label: c.commit.message.split('\n')[0],
                sub: `${short(c.sha)} · ${c.author?.login || c.commit.author?.name || ''} · ${formatWhen(c.commit.author?.date || c.commit.committer?.date)}`,
                alt: c.sha, icon: `<span class="fi fi-glyph pal-ai">${icons.commit}</span>`, run: () => openCommitSpec(c.sha),
            })),
        },
        prs: {
            title: 'Pull Requests', remote: true,
            items: async (q) => (await listPullRequests(state.target.owner, state.target.repo, {state: 'open', text: q})).map((p) => ({
                label: p.title, sub: `#${p.number} · ${p.user || ''}${p.draft ? ' · draft' : ''}`, icon: `<span class="fi fi-glyph pal-ai">${icons.pr}</span>`,
                run: () => navigate({type: 'pr', owner: state.target.owner, repo: state.target.repo, number: p.number}),
            })),
        },
    }
    state.palette = new Palette(sources, {tabs: [
        {key: 'all', title: 'All'}, {key: 'files', title: 'Files'}, {key: 'actions', title: 'Actions'},
        {key: 'commits', title: 'Commits'}, {key: 'prs', title: 'Pull Requests'},
    ]})
    onDoubleShift(() => { if (!$('#app').hidden && !$('#dialog').open) state.palette.toggle() })
    $('#btn-search').onclick = () => state.palette.open()
}

window.addEventListener('popstate', () => route())
route()
