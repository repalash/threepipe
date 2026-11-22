import {
    commitFiles, getFileContent, getPullHead, getTimeline, moveBranch, getToken, getViewedStates, GitHubError, loadChangeSet, paramsToTarget, parseTarget,
    listPullRequests, searchMyPullRequests, setFileViewed, setToken, targetToParams,
} from './github.js'
import {
    applyTheme, applyThemeCss, DEFAULT_THEME, ensureLanguage, fullWidthSelection, languageForPath, languageName, loadMonaco,
    MONACO_THEME, themeById, THEMES, DIFF_COLORS,
} from './editor.js'
import {SideBySideViewer} from './sbs.js'
import {FileTree} from './tree.js'
import {fileIcon, icons, isImagePath} from './icons.js'
import {formatWhen, LogView} from './log.js'
import {onDoubleShift, Palette} from './palette.js'
import {installTooltips} from './tooltip.js'
import {highlightBlocks, renderMarkdown, repoResolvers, richSource, sanitize} from './markdown.js'

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
    theme: store.get('theme', DEFAULT_THEME), // a Material Theme UI variant (themes.js)
    align: store.get('align', false), // "Align Changes In Side-by-Side Diff"
    syncScroll: store.get('syncScroll', true),
    ignore: store.get('ignore', 'none'), // 'none' | 'trim' | 'all'
    highlight: store.get('highlight', 'words'), // 'words' | 'lines' | 'none'
    collapseUnchanged: store.get('collapseUnchanged', false),
    wordWrap: store.get('wordWrap', false),
    mdPreview: store.get('mdPreview', true), // Markdown files show rendered in the diff
    fontSize: store.get('fontSize', null),
}
const viewMode = () => settings.view || (mobileQuery.matches ? 'unified' : 'sbs')
/** Which viewer renders: the JetBrains-style side-by-side, or Monaco's diff editor (unified, or aligned side-by-side). */
const renderer = () => viewMode() === 'sbs' && !settings.align ? 'sbs' : 'monaco'
const fontSize = () => settings.fontSize || (mobileQuery.matches ? 12 : 13)
const lineHeight = () => Math.round(fontSize() * 1.54)

// --- toasts, menus, dialogs ---

function toast(message, kind = 'info', ms = 4000, action = null) {
    const el = document.createElement('div')
    el.className = `toast toast-${kind}`
    el.textContent = message
    if (action) {
        const b = document.createElement('button')
        b.className = 'toast-action'
        b.textContent = action.label
        b.onclick = () => { el.remove(); action.run() }
        el.appendChild(b)
    }
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
    edits: new Map(), // path -> edited text of the PR head (state.editKey), not committed yet
    editKey: null,
    carryEdits: null, // edits not in the last commit, kept for the new head
    cmtExcluded: new Set(), // edited files unchecked in the Commit panel
    editing: false, // edit mode: the right side (the PR head) is editable
    editableFile: false,
    pristine: null, // the open file's text at the head
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
    const hk = headKey()
    if (hk && hk !== state.editKey) {
        if (state.carryEdits && state.carryKey === `${target.owner}/${target.repo}#${target.number}`) {
            // the files not in the last commit are the same at the new head
            state.edits = state.carryEdits
        } else if (state.edits.size) {
            toast(`Discarded ${state.edits.size} uncommitted edit${state.edits.size === 1 ? '' : 's'}: the pull request has a new head`, 'error', 6000)
            state.edits = new Map()
        }
        state.carryEdits = null
        state.editKey = hk
        saveEdits()
    }
    renderEdits()
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
    const monaco = await loadMonaco()
    await applyTheme(monaco, themeById(settings.theme))
    state.monaco = monaco
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
            <a class="tb-btn" id="btn-github" target="_blank" rel="noopener" title="Open the pull request on GitHub">${icons.github}</a>
            <button class="tb-btn" id="btn-app" title="Settings: theme, editor font, GitHub token">${icons.gear}</button>
        </header>
        <div class="main">
            <nav class="strip hide-mobile">
                <button class="strip-btn" id="strip-commit" title="Commit (edits made here)">${icons.commit}<i class="strip-badge" id="strip-badge" hidden></i></button>
                <button class="strip-btn active" id="strip-changes" title="Changes">${icons.changes}</button>
                <button class="strip-btn" id="strip-prs" title="Pull requests of the repository">${icons.pr}</button>
            </nav>
            <aside class="side" id="side">
                <div class="side-head">
                    <button class="side-title" id="side-title" title="Choose a commit"><span id="side-title-text">Changes</span>${icons.chevronDown}</button>
                    <button class="tb-btn only-mobile" id="btn-drawer-close" title="Close">${icons.close}</button>
                </div>
                <div class="pr-head" id="pr-head" hidden>
                    <div class="pr-title" id="pr-title"></div>
                    <div class="pr-links"><button class="pr-link" id="pr-timeline">View Timeline</button><a class="pr-link" id="pr-link" target="_blank" rel="noopener">Open PR on GitHub</a></div>
                    <div class="pr-from"><span>Changes from</span>
                        <button class="pr-commits" id="pr-commits"></button><button class="pr-clear" id="pr-clear" title="Show all commits" hidden>${icons.close}</button>
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
                <div class="cmt" id="cmt" hidden>
                    <div class="side-tools">
                        <button class="tb-btn" id="cmt-rollback" title="Rollback: discard the edits of the checked files">${icons.undo}</button>
                        <button class="tb-btn" id="cmt-expand" title="Expand All">${icons.expand}</button>
                        <button class="tb-btn" id="cmt-collapse" title="Collapse All">${icons.collapse}</button>
                    </div>
                    <div class="tree" id="cmt-tree"></div>
                    <div class="cmt-bottom">
                        <div class="cmt-opts">
                            <label class="cmt-amend" title="Replace the last commit of the branch (a force push)"><input type="checkbox" id="cmt-amend"><span>Amend last commit</span></label>
                            <span class="spacer"></span><span class="cmt-count" id="cmt-count"></span>
                        </div>
                        <textarea id="cmt-msg" placeholder="Commit Message" spellcheck="true"></textarea>
                        <div class="cmt-err" id="cmt-err" hidden></div>
                        <div class="cmt-actions">
                            <button class="btn btn-primary" id="cmt-go">Commit and Push</button>
                            <span class="cmt-to dim" id="cmt-to"></span>
                        </div>
                    </div>
                </div>
            </aside>
            <div class="splitter hide-mobile" id="splitter"></div>
            <div class="scrim only-mobile" id="scrim"></div>
            <section class="content">
                <div class="tabs">
                    <button class="tab" id="tab-log" title="Commits">${icons.log}<span>Log</span><i class="tab-x" data-close="log" title="Close">${icons.close}</i></button>
                    <button class="tab active" id="tab-changes">${icons.changes}<span id="tab-label">Changes</span></button>
                    <button class="tab" id="tab-timeline" hidden>${icons.comment}<span>Timeline</span><i class="tab-x" data-close="timeline" title="Close">${icons.close}</i></button>
                </div>
                <div class="log-host" id="log-host" hidden></div>
                <div class="timeline-host" id="timeline-host" hidden></div>
                <div class="toolbar" id="toolbar">
                    <button class="tb-btn" id="btn-prev-diff" title="Previous Difference (Shift+F7)">${icons.up}</button>
                    <button class="tb-btn" id="btn-next-diff" title="Next Difference (F7)">${icons.down}</button>
                    <button class="tb-btn hide-mobile" id="btn-open-file" title="Open the file on GitHub: the new or the old version, or its diff">${icons.external}</button>
                    <button class="tb-btn" id="btn-prev-file" title="Previous File (Alt+←)">${icons.left}</button>
                    <span class="file-pos" id="file-pos"></span>
                    <button class="tb-btn" id="btn-next-file" title="Next File (Alt+→)">${icons.right}</button>
                    <span class="spacer"></span>
                    <button class="btn btn-primary btn-commit" id="btn-commit" title="Commit the edits to the pull request's branch" hidden>${icons.commit}<span></span></button>
                    <button class="tb-btn" id="btn-edit" title="Edit the pull request's files (then commit to its branch)" hidden>${icons.pencil}</button>
                    <label class="viewed-toggle" title="Mark the file as viewed (V)"><input type="checkbox" id="chk-viewed"><span>Viewed</span></label>
                    <span class="diff-count" id="diff-count"></span>
                    <div class="seg seg-md" id="seg-md" hidden>
                        <button class="tb-btn tb-text" id="btn-md-preview" title="Show the Markdown rendered">${icons.eye}<span>Preview</span></button>
                        <button class="tb-btn tb-text" id="btn-md-code" title="Show the Markdown code">${icons.code}<span>Code</span></button>
                    </div>
                    <div class="seg">
                        <button class="tb-btn" id="btn-sbs" title="Side-by-side viewer">${icons.sideBySide}</button>
                        <button class="tb-btn" id="btn-unified" title="Unified viewer">${icons.unified}</button>
                    </div>
                    <button class="tb-btn" id="btn-settings" title="Diff settings">${icons.gear}</button>
                </div>
                <div class="viewer" id="viewer" data-hl="${settings.highlight}">
                    <div class="view" id="view-sbs"></div>
                    <div class="view" id="view-unified">
                        <div class="uni-head" id="uni-head"><span id="uni-left"></span><span id="uni-right"></span></div>
                        <div class="uni-ed" id="uni-ed"></div>
                    </div>
                    <div class="view view-md" id="view-md"></div>
                    <div class="view view-msg" id="view-msg"></div>
                    <div class="loading-bar" id="loading-bar"></div>
                </div>
            </section>
        </div>
        <footer class="statusbar hide-mobile">
            <span class="st-group" data-tab="changes"><span id="st-lang" class="st-item"></span><span class="spacer"></span><span id="st-stat"></span><span id="st-pos"></span></span>
            <span class="st-group" data-tab="log" hidden><span class="st-item" id="st-log-n"></span><span class="spacer"></span><span class="st-item" id="st-log-sel"></span></span>
            <span class="st-group" data-tab="timeline" hidden><span class="st-item" id="st-tl"></span><span class="spacer"></span><span class="st-item" id="st-tl-n"></span></span>
        </footer>`

    state.tree = new FileTree($('#tree'), {
        // a click shows the file; on a phone (the drawer closes) or with a double-click, the diff tab comes to the front
        onSelect: (path) => { selectFile(path); if (mobileQuery.matches) { setTab('changes'); closeDrawer() } },
        onOpen: () => setTab('changes'),
        onToggleViewed: (path) => { const f = state.order.find((x) => x.path === path); if (f) toggleViewed(f, !state.viewed.has(path)) },
    })
    $('#pr-commits').onclick = (e) => commitMenu(e.currentTarget)
    $('#pr-clear').onclick = () => { const t = state.target; navigate({...t, commit: undefined}, state.order[state.index]?.path) }
    $('#strip-prs').onclick = () => setSidePanel(state.sidePanel === 'prs' ? 'changes' : 'prs')
    $('#strip-commit').onclick = () => setSidePanel(state.sidePanel === 'commit' ? 'changes' : 'commit')
    state.cmtTree = new FileTree($('#cmt-tree'), {
        checks: true,
        rootLabel: 'Changes',
        onSelect: (path) => { selectFile(path); setTab('changes'); if (mobileQuery.matches) closeDrawer() },
        onToggleViewed: (path) => { state.cmtExcluded.has(path) ? state.cmtExcluded.delete(path) : state.cmtExcluded.add(path); renderCommitPanel() },
    })
    $('#cmt-expand').onclick = () => state.cmtTree.collapseAll(false)
    $('#cmt-collapse').onclick = () => state.cmtTree.collapseAll(true)
    $('#cmt-rollback').onclick = () => rollbackChecked()
    $('#cmt-amend').onchange = () => onAmendToggle()
    $('#cmt-msg').oninput = () => renderCommitPanel(false)
    $('#cmt-msg').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCommit() } }
    $('#cmt-go').onclick = () => doCommit()
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
    $('#btn-open-file').onclick = (e) => openMenu(e.currentTarget, openOnGitHubItems())
    $('#btn-app').onclick = (e) => appMenu(e.currentTarget)
    $('#btn-expand').onclick = () => state.tree.collapseAll(false)
    $('#btn-collapse').onclick = () => state.tree.collapseAll(true)
    $('#btn-reload').onclick = () => reloadTarget()
    $('#btn-edit').onclick = () => setEditing(!state.editing)
    $('#btn-commit').onclick = () => openCommitPanel()
    $('#tab-log').onclick = (e) => e.target.closest('.tab-x') ? closeTab('log') : setTab('log')
    $('#tab-changes').onclick = () => setTab('changes')
    $('#tab-timeline').onclick = (e) => e.target.closest('.tab-x') ? closeTab('timeline') : setTab('timeline')
    $('#pr-timeline').onclick = () => openTimeline()
    $('#timeline-host').onclick = (e) => {
        const li = e.target.closest('.tl-commits li[data-sha]')
        if (li) return openCommitSpec(li.dataset.sha)
        const p = e.target.closest('.tl-path')
        if (p) { setTab('changes'); selectFile(p.dataset.path) }
    }
    $('#btn-md-preview').onclick = () => !settings.mdPreview && toggleMdPreview()
    $('#btn-md-code').onclick = () => settings.mdPreview && toggleMdPreview()
    $('#side-title').onclick = (e) => state.sidePanel !== 'prs' && commitMenu(e.currentTarget)
    $('#chk-viewed').onchange = (e) => toggleViewed(state.order[state.index], e.target.checked)
    $('#btn-drawer').onclick = openDrawer
    $('#btn-drawer-close').onclick = closeDrawer
    $('#scrim').onclick = closeDrawer
    $('#strip-changes').onclick = () => {
        if (state.sidePanel && state.sidePanel !== 'changes') return setSidePanel('changes')
        document.body.classList.toggle('side-hidden')
    }
    // the project chip opens the repository's pull requests, as the IDE's Pull Requests tool window
    $('#proj').onclick = (e) => { e.preventDefault(); projectMenu(e.currentTarget) }
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
    const prs = which === 'prs', cmt = which === 'commit', other = prs || cmt
    document.body.classList.remove('side-hidden')
    $('#strip-changes').classList.toggle('active', !other)
    $('#strip-prs').classList.toggle('active', prs)
    $('#strip-commit').classList.toggle('active', cmt)
    $('#prl').hidden = !prs
    $('#cmt').hidden = !cmt
    for (const id of ['#tree', '#side > .side-tools']) $(id).hidden = other
    $('#pr-head').hidden = other || !state.cs?.pr
    $('.side-head').classList.toggle('prs', other)
    $('#side-title-text').textContent = prs ? `Pull Requests · ${state.target.repo}` : cmt ? 'Commit' : sideTitle()
    $('#side-title').classList.toggle('no-menu', other || !state.cs?.commits?.length)
    if (prs) loadPrList()
    if (cmt) renderCommitPanel()
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
    $('#proj').title = `${target.owner}/${target.repo}: recent and other pull requests`
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
    $('#tab-log').hidden = !cs.commits?.length || !!state.closedTabs?.has('log')
    if (cs.commits?.length) {
        state.log ??= new LogView($('#log-host'), {onOpen: openCommitSpec, onSelect: (html) => { $('#st-log-sel').innerHTML = html }})
        $('#st-log-n').innerHTML = `${icons.log}${cs.commits.length} commit${cs.commits.length === 1 ? '' : 's'}${pr ? ` on ${esc(pr.head.ref)}` : ''}`
        state.log.setCommits(cs.commits, {owner: target.owner, repo: target.repo, selected: target.commit || (target.type === 'commit' ? target.sha : null), headRef: pr?.head.ref})
    }
    state.sideTitle = what
    $('#side-title-text').textContent = state.sidePanel === 'prs' ? $('#side-title-text').textContent : what
    $('#side-title').classList.toggle('no-menu', !(cs.commits?.length))
    // the IDE's PR view: the title, then "Changes from N commits ▾" and the branch
    $('#side').classList.toggle('is-pr', !!pr)
    $('#pr-head').hidden = !pr || state.sidePanel === 'prs'
    const tlKey = pr ? `${target.owner}/${target.repo}#${pr.number}` : null
    if (state.timelineKey && state.timelineKey !== tlKey) {
        state.timelineKey = null
        $('#tab-timeline').hidden = true
        $('#timeline-host').innerHTML = ''
        if (state.tab === 'timeline') setTab('changes')
    }
    if (pr) {
        $('#pr-title').innerHTML = `${esc(pr.title)} <span class="dim">#${pr.number}</span>`
        $('#pr-link').href = pr.html_url
        const n = cs.commits?.length || 0
        $('#pr-commits').innerHTML = (cs.range ? `${short(cs.range[0])}..${short(cs.range[1])}`
            : cs.commit ? `commit ${short(cs.headSha)}` : `${n} commit${n === 1 ? '' : 's'}`) + icons.chevronDown
        $('#pr-clear').hidden = !(cs.commit || cs.range)
        $('#pr-branch').innerHTML = `${icons.tag}<span>${esc(pr.head.ref)}</span>`
        $('#pr-branch').title = `${pr.head.label} → ${pr.base.label}`
    }
}

function sideTitle() {
    return state.sideTitle || 'Changes'
}

/** The project chip, as the IDE's project switcher: recent pull requests, this repository's PRs, open another. */
function projectMenu(anchor) {
    const cur = state.target ? targetToParams(state.target).toString() : ''
    const rec = recents().filter((r) => r.key !== cur).slice(0, 8)
    openMenu(anchor, [
        {label: `${icons.pr} Pull Requests of ${esc(state.target.repo)}`, action: () => { setSidePanel('prs'); openDrawer() }},
        {label: `${icons.folder} Open Another Pull Request…`, action: openPrDialog},
        ...(rec.length ? ['-', {html: 'Recent'}] : []),
        ...rec.map((r) => ({label: `${esc(r.title || r.label)}<div class="menu-sub">${esc(r.label)}</div>`, action: () => { history.pushState(null, '', '?' + r.key); route() }})),
        '-',
        {label: 'Start Page', action: () => { history.pushState(null, '', './'); route() }},
    ])
}

/** A pull request, commit or compare URL (or owner/repo#n), opened without leaving the current view first. */
function openPrDialog() {
    const dlg = $('#dialog')
    dlg.innerHTML = `
        <form class="dlg" method="dialog">
            <h2>Open a pull request</h2>
            <p class="dim">A GitHub pull request, commit or compare URL, or <code>owner/repo#123</code>.</p>
            <input id="op-url" placeholder="https://github.com/owner/repo/pull/123" autocomplete="off" spellcheck="false">
            <div class="dlg-err" id="op-err" hidden></div>
            <div class="dlg-actions"><span class="spacer"></span>
                <button type="button" id="op-cancel" class="btn btn-ghost">Cancel</button>
                <button type="submit" class="btn btn-primary">Open</button></div>
        </form>`
    dlg.showModal()
    $('#op-url', dlg).focus()
    $('#op-cancel', dlg).onclick = () => dlg.close()
    $('form', dlg).onsubmit = (e) => {
        e.preventDefault()
        const t = parseTarget($('#op-url', dlg).value)
        if (!t) { $('#op-err', dlg).textContent = 'Not a pull request, commit or compare link'; $('#op-err', dlg).hidden = false; return }
        dlg.close()
        navigate(t)
    }
}

function commitMenu(anchor) {
    const {cs, target} = state
    if (!cs?.commits?.length) return
    const items = []
    if (target.type === 'pr') {
        items.push({label: `All commits (${cs.commits.length})`, checked: !target.commit, action: () => navigate({...target, commit: undefined})})
        items.push({label: `${icons.log} Show Log`, action: showLog})
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
        '-',
        {html: 'Ignore Differences'},
        ignore('none'), ignore('trim'), ignore('all'),
        '-',
        {html: 'Highlighting Differences'},
        hl('lines'), hl('words'), hl('none'),
        '-',
        {label: 'Collapse Unchanged Fragments', checked: settings.collapseUnchanged, disabled: renderer() !== 'monaco', action: () => { set('collapseUnchanged', !settings.collapseUnchanged); applyMonacoOptions() }},
        {label: 'Soft-Wrap', checked: settings.wordWrap, disabled: renderer() !== 'monaco', action: () => { set('wordWrap', !settings.wordWrap); applyMonacoOptions() }},
        {label: 'Markdown Files as Preview', checked: settings.mdPreview, action: () => toggleMdPreview()},
        '-',
        ...openOnGitHubItems(),
    ], {align: 'right'})
}

/** The app's settings (titlebar gear): theme, editor font, token, shortcuts. The diff's own settings are in its gear. */
function appMenu(anchor) {
    openMenu(anchor, [
        {html: 'Appearance'},
        {label: `Theme: ${esc(themeById(settings.theme).name)} ▸`, keepOpen: true, action: () => themeMenu(anchor)},
        '-',
        {html: `Editor font <span class="dim">(${fontSize()}px, code only)</span>`},
        {label: 'Increase Font Size', hint: `${MOD}=`, keepOpen: true, action: () => { changeFont(1); appMenu(anchor) }},
        {label: 'Decrease Font Size', hint: `${MOD}−`, keepOpen: true, action: () => { changeFont(-1); appMenu(anchor) }},
        {label: 'Reset Font Size', hint: `${MOD}0`, action: () => changeFont(0)},
        '-',
        {html: 'GitHub'},
        {label: `${icons.lock} ${getToken() ? 'Token saved: change or remove…' : 'Add a Token…'}`, action: tokenDialog},
        {label: `${icons.folder} Open Another Pull Request…`, action: openPrDialog},
        '-',
        {label: `Double Shift: Search Everywhere · F7 / ⇧F7: differences · Alt+→ / Alt+←: files · V: viewed`, disabled: true},
    ], {align: 'right'})
}

/** The current file on GitHub: the new version (PR head), the old one (base), or the file in the PR's diff. */
function openOnGitHubItems() {
    const f = state.order[state.index], cs = state.cs, t = state.target
    if (!f || !cs) return []
    const blob = (sha, path) => `https://github.com/${t.owner}/${t.repo}/blob/${sha}/${path}`
    const items = []
    if (f.status !== 'removed') items.push({label: `${icons.external} Open New Version on GitHub <span class="dim">${short(cs.headSha)}</span>`, action: () => window.open(blob(cs.headSha, f.path), '_blank', 'noopener')})
    if (f.status !== 'added' && cs.baseSha) items.push({label: `${icons.external} Open Old Version on GitHub <span class="dim">${short(cs.baseSha)}</span>`, action: () => window.open(blob(cs.baseSha, f.prevPath || f.path), '_blank', 'noopener')})
    items.push({label: `${icons.external} Show This File's Diff on GitHub`, action: async () => {
        const w = window.open('about:blank', '_blank')
        // GitHub's anchor for a file in a diff is the SHA-256 of its path
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.path)))].map((b) => b.toString(16).padStart(2, '0')).join('')
        const base = cs.pr && !cs.commit && !cs.range ? `${cs.htmlUrl}/files` : cs.htmlUrl
        if (w) w.location = `${base}#diff-${hash}`
    }})
    return items
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** Editor text size only (code and diff line numbers); the rest of the UI keeps its size. 0 resets. */
function changeFont(delta) {
    settings.fontSize = delta === 0 ? null : Math.max(8, Math.min(24, fontSize() + delta))
    store.set('fontSize', settings.fontSize)
    applyFont()
    toast(`Editor font ${fontSize()}px`, 'info', 1200)
}

function themeMenu(anchor) {
    const item = (t) => ({label: esc(t.name), checked: t.id === settings.theme, action: () => setThemeId(t.id)})
    openMenu(anchor, [
        {html: 'Dark'}, ...THEMES.filter((t) => t.dark).map(item),
        '-',
        {html: 'Light'}, ...THEMES.filter((t) => !t.dark).map(item),
    ], {align: 'right'})
}

/** Switches the Material variant: page colors at once, code colors once Monaco is there (the open file is retokenized). */
async function setThemeId(id) {
    const theme = themeById(id)
    settings.theme = theme.id
    store.set('theme', theme.id)
    applyThemeCss(theme)
    if (state.monaco) {
        await applyTheme(state.monaco, theme)
        state.sbs?.draw()
        reopenFile(true)
    }
    toast(theme.name, 'info', 1200)
}

function applyHighlight() {
    $('#viewer').dataset.hl = settings.highlight
    state.sbs?.setOptions({highlight: settings.highlight})
}

function closeTab(tab) {
    state.closedTabs ??= new Set()
    state.closedTabs.add(tab)
    $('#tab-' + tab).hidden = true
    if (state.tab === tab) setTab('changes')
}

function showLog() {
    state.closedTabs?.delete('log')
    $('#tab-log').hidden = false
    setTab('log')
    closeDrawer()
}

function setTab(tab) {
    state.tab = tab
    for (const k of ['log', 'changes', 'timeline']) $('#tab-' + k).classList.toggle('active', k === tab)
    $('#log-host').hidden = tab !== 'log'
    $('#timeline-host').hidden = tab !== 'timeline'
    $('#toolbar').hidden = tab !== 'changes'
    $('#viewer').hidden = tab !== 'changes'
    // the status bar tells about the tab in front
    for (const g of document.querySelectorAll('.statusbar .st-group')) g.hidden = g.dataset.tab !== tab
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

    renderViewed()
    state.editableFile = false
    applyEditable()
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
    state.editableFile = canEdit(f)
    state.pristine = mod.text
    const edited = state.editableFile && state.edits.has(f.path)
    const original = monaco.editor.createModel(orig.text, lang, uri('a'))
    const modified = monaco.editor.createModel(edited ? state.edits.get(f.path) : mod.text, lang, uri('b'))
    state.models = [original, modified]
    if (state.editableFile) modified.onDidChangeContent(() => onEdited(f, original, modified, id))
    // tokenize up front: deleted lines in the unified view otherwise can render before their colors exist
    for (const m of state.models) if (m.getLineCount() < 20000) m.tokenization.forceTokenization(m.getLineCount())

    $('#seg-md').hidden = !isMarkdown(f.path)
    $('#btn-md-preview').classList.toggle('on', mdPreviewOn(f))
    $('#btn-md-code').classList.toggle('on', !mdPreviewOn(f))
    try {
        if (mdPreviewOn(f)) {
            const changes = f.status === 'added' ? [wholeInsert(modified)]
                : f.status === 'removed' ? [wholeDelete(original)]
                    : await computeDiff(original, modified)
            if (id !== state.fileLoadId) return
            state.unified?.setModel(null)
            if (!await showMarkdownPreview(f, original.getValue(), modified.getValue(), changes, {left: leftLabel, right: rightLabel}, id, keepScroll)) return
        } else if (renderer() === 'sbs') {
            const changes = f.status === 'added' ? [wholeInsert(modified)]
                : f.status === 'removed' ? [wholeDelete(original)]
                    : await computeDiff(original, modified)
            if (id !== state.fileLoadId) return
            showView('sbs')
            state.unified?.setModel(null)
            const sc = keepScroll && state.sbs ? state.sbs.right.getScrollTop() : 0
            ensureSbs().setModels(original, modified, changes, {left: leftLabel, right: rightLabel})
            if (changes.length && !keepScroll) state.sbs.goTo(0)
            else if (sc) state.sbs.right.setScrollTop(sc)
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
    applyEditable()
    updateToolbar()
    prefetch(i + 1)
}

// --- Markdown preview ---

function isMarkdown(path) {
    return /\.(md|markdown|mdx)$/i.test(path)
}

function mdPreviewOn(f) {
    return isMarkdown(f.path) && settings.mdPreview && !(state.editing && state.editableFile) && !state.mdFailed
}

function toggleMdPreview() {
    setSetting('mdPreview', !settings.mdPreview)
    if (settings.mdPreview && state.editing) state.editing = false
    reopenFile(true)
}

/** Line sets of a diff: inserted / modified lines on the new side, deleted / modified on the old (1-based). */
function changedLines(lineChanges) {
    const r = {ins: new Set(), mod: new Set(), del: new Set(), modOld: new Set()}
    for (const c of lineChanges) {
        const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
        if (hasM) for (let l = c.modifiedStartLineNumber; l <= c.modifiedEndLineNumber; l++) (hasO ? r.mod : r.ins).add(l)
        if (hasO) for (let l = c.originalStartLineNumber; l <= c.originalEndLineNumber; l++) (hasM ? r.modOld : r.del).add(l)
    }
    return r
}

/** Shows a Markdown file rendered: old | new (side-by-side) or the new side, with the changed blocks marked. */
async function showMarkdownPreview(f, oldText, newText, lineChanges, labels, id, keepScroll) {
    const {cs, target: t} = state
    const L = changedLines(lineChanges)
    // blocks are marked by the change of their source lines; `map` gives the source line of each rendered line
    const classify = (mod, other, cls, map) => (a, b) => {
        let r = ''
        for (let i = a; i < b; i++) {
            const l = map[i]
            if (!l) continue
            if (mod.has(l)) return 'md-mod'
            if (other.has(l)) r = cls
        }
        return r
    }
    const sides = f.status === 'removed' ? ['old'] : f.status !== 'added' && viewMode() === 'sbs' ? ['old', 'new'] : ['new']
    const unified = sides.length === 1 && f.status === 'modified'
    const scroll = keepScroll ? $('#view-md .mdp-pane:last-child .mdp-body')?.scrollTop : 0
    let html
    try {
        html = await Promise.all(sides.map((s) => {
            const old = s === 'old'
            const whole = old ? f.status === 'removed' : f.status === 'added'
            const src = whole ? {text: old ? oldText : newText, map: null} : richSource(oldText, newText, lineChanges, s, unified)
            return renderMarkdown(src.text, {
                marks: !whole,
                map: src.map,
                classify: whole ? null : old ? classify(L.modOld, L.del, 'md-del', src.map) : classify(L.mod, L.ins, 'md-ins', src.map),
                ...(old ? repoResolvers(t.owner, t.repo, cs.baseSha, f.prevPath || f.path) : repoResolvers(t.owner, t.repo, cs.headSha, f.path)),
            })
        }))
    } catch (e) {
        console.error(e)
        toast(`The Markdown preview could not load (${e.message}); showing the code`, 'error')
        state.mdFailed = true
        if (id === state.fileLoadId) reopenFile(true)
        return false
    }
    if (id !== state.fileLoadId) return false
    const view = $('#view-md')
    const legend = f.status !== 'modified' ? `<span class="mdp-legend">${f.status === 'added' ? 'New file' : 'Deleted file'}</span>`
        : `<span class="mdp-legend" title="Blocks: a bar and tint on the left. Words: highlighted inside the text.">${sides.length > 1
            ? '<i class="lg-ins"></i>added <i class="lg-mod"></i>changed <i class="lg-del"></i>removed'
            : '<i class="lg-ins"></i>added <i class="lg-mod"></i>changed <i class="lg-del"></i>removed (struck through)'}</span>`
    view.innerHTML = `<div class="mdp${sides.length > 1 ? ' two' : ''}">${sides.map((s, i) => `
        ${i ? '<canvas class="mdp-div"></canvas>' : ''}<div class="mdp-pane mdp-${s}"><div class="mdp-head">${s === 'old' ? labels.left : labels.right}${i === sides.length - 1 ? legend : ''}</div>
            <div class="mdp-body"><article class="md">${html[i]}</article></div></div>`).join('')}</div>`
    showView('md')
    const main = $('.mdp-pane:last-child .mdp-body', view)
    state.mdMarks = [...main.querySelectorAll('.md-ins, .md-mod, .md-del')].filter((e) => !e.parentElement.closest('.md-ins, .md-mod, .md-del'))
    state.mdCur = -1
    if (scroll) main.scrollTop = scroll
    else if (state.mdMarks.length && f.status === 'modified') markCurrent(0, false)
    const bodies = [...view.querySelectorAll('.mdp-body')]
    if (bodies.length === 2) linkMarkdownPanes(view, bodies, lineChanges)
    for (const b of bodies) b.addEventListener('scroll', () => updateToolbar(), {passive: true})
    highlightBlocks(view).then(() => state.mdRefresh?.())
    return true
}

/**
 * Old | new Markdown: connectors between the blocks of each change in the middle (as the code diff's curves), and
 * scrolling that keeps matching changes side by side (piecewise linear between the changes).
 */
function linkMarkdownPanes(view, [ob, nb], lineChanges) {
    const cv = $('.mdp-div', view)
    const ctx = cv.getContext('2d')
    const blocks = (body) => [...body.querySelectorAll('[data-sl]')].map((e) => ({e, sl: +e.dataset.sl, el: +e.dataset.el}))
    const OB = blocks(ob), NB = blocks(nb)
    // a change's extent on one side, in the side's content coordinates: [top, bottom], or a point after line `at`
    const extent = (B, body, from, to, point) => {
        const base = body.getBoundingClientRect().top - body.scrollTop
        if (!point) {
            const hit = B.filter((b) => b.el >= from && b.sl <= to)
            if (!hit.length) return null
            return [Math.min(...hit.map((b) => b.e.getBoundingClientRect().top)) - base, Math.max(...hit.map((b) => b.e.getBoundingClientRect().bottom)) - base]
        }
        const prev = B.filter((b) => b.el <= from).pop(), next = B.find((b) => b.sl > from)
        const y = prev && next ? (prev.e.getBoundingClientRect().bottom + next.e.getBoundingClientRect().top) / 2 - base
            : prev ? prev.e.getBoundingClientRect().bottom - base : next ? next.e.getBoundingClientRect().top - base : 0
        return [y - 1, y + 1]
    }
    let links = []
    const measure = () => {
        links = []
        for (const c of lineChanges) {
            const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
            const o = extent(OB, ob, c.originalStartLineNumber, c.originalEndLineNumber, !hasO)
            const n = extent(NB, nb, c.modifiedStartLineNumber, c.modifiedEndLineNumber, !hasM)
            if (o && n) links.push({o, n, type: hasO && hasM ? 'modified' : hasM ? 'inserted' : 'deleted'})
        }
    }
    const draw = () => {
        const dpr = devicePixelRatio || 1
        const w = cv.clientWidth, h = cv.clientHeight
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        const top = cv.getBoundingClientRect().top
        const oy = ob.getBoundingClientRect().top - top - ob.scrollTop, ny = nb.getBoundingClientRect().top - top - nb.scrollTop
        for (const l of links) {
            const a0 = l.o[0] + oy, a1 = l.o[1] + oy, b0 = l.n[0] + ny, b1 = l.n[1] + ny
            if (Math.max(a1, b1) < 0 || Math.min(a0, b0) > h) continue
            ctx.fillStyle = DIFF_COLORS[l.type]
            ctx.beginPath()
            ctx.moveTo(0, a0)
            ctx.bezierCurveTo(w / 2, a0, w / 2, b0, w, b0)
            ctx.lineTo(w, b1)
            ctx.bezierCurveTo(w / 2, b1, w / 2, a1, 0, a1)
            ctx.closePath()
            ctx.fill()
        }
    }
    // scroll sync: the line a third down one side maps through the change extents onto the other side
    const pairs = () => {
        const p = [[0, 0]]
        for (const l of links) { p.push([l.o[0], l.n[0]], [l.o[1], l.n[1]]) }
        p.push([ob.scrollHeight, nb.scrollHeight])
        return p.sort((x, y) => x[0] - y[0])
    }
    const mapY = (y, from) => {
        const p = pairs().map((q) => (from === 0 ? q : [q[1], q[0]])).sort((x, z) => x[0] - z[0])
        for (let i = 1; i < p.length; i++) {
            if (y <= p[i][0]) {
                const [x0, y0] = p[i - 1], [x1, y1] = p[i]
                return x1 > x0 ? y0 + (y - x0) / (x1 - x0) * (y1 - y0) : y1
            }
        }
        return y
    }
    let lock = null, raf = 0
    const sides = [ob, nb]
    sides.forEach((b, i) => b.addEventListener('scroll', () => {
        if (settings.syncScroll && (!lock || lock === b)) {
            lock = b
            const o = sides[1 - i], ref = b.clientHeight / 3
            o.scrollTop = mapY(b.scrollTop + ref, i) - ref
            clearTimeout(lock.t)
            lock.t = setTimeout(() => { lock = null }, 80)
        }
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(draw)
    }, {passive: true}))
    const refresh = () => { measure(); draw() }
    new ResizeObserver(refresh).observe(cv)
    // images and highlighted code change the heights after rendering
    view.addEventListener('load', refresh, true)
    setTimeout(refresh, 400)
    refresh()
    state.mdRefresh = refresh
}

function markCurrent(i, smooth = true) {
    state.mdCur = i
    const el = state.mdMarks[i]
    for (const m of state.mdMarks) m.classList.toggle('md-cur', m === el)
    // scroll the preview only (scrollIntoView would also move the page on a phone)
    const box = el?.closest('.mdp-body')
    if (box) box.scrollTo({top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3, behavior: smooth ? 'smooth' : 'auto'})
    updateToolbar()
}

// --- the PR's timeline: description, comments, reviews, commits ---

async function openTimeline() {
    const {cs, target: t} = state
    if (!cs?.pr) return
    $('#tab-timeline').hidden = false
    setTab('timeline')
    closeDrawer()
    const key = `${t.owner}/${t.repo}#${cs.pr.number}`
    const host = $('#timeline-host')
    if (state.timelineKey === key && host.childElementCount) return
    state.timelineKey = key
    host.innerHTML = '<div class="tl-loading dim">Loading the conversation…</div>'
    try {
        const [data, desc] = await Promise.all([getTimeline(t.owner, t.repo, cs.pr.number), sanitize(cs.pr.body_html || '')])
        if (state.timelineKey !== key) return
        host.innerHTML = await timelineHtml(cs, data, desc)
        host.scrollTop = 0
        const pr = cs.pr, st = pr.merged_at ? 'merged' : pr.draft ? 'draft' : pr.state
        $('#st-tl').innerHTML = `${icons.pr}#${pr.number} · ${st} · ${esc(pr.user?.login || '')} → ${esc(pr.base.ref)}`
        const nr = data.reviews.filter((r) => r.state !== 'PENDING').length
        $('#st-tl-n').textContent = `${data.comments.length} comment${data.comments.length === 1 ? '' : 's'} · ${nr} review${nr === 1 ? '' : 's'} · ${data.inline.length} inline`
    } catch (e) {
        if (state.timelineKey === key) host.innerHTML = `<div class="tl-loading dim">Could not load the conversation: ${esc(e.message)}</div>`
        state.timelineKey = null
    }
}

async function timelineHtml(cs, {comments, reviews, inline}, desc) {
    const pr = cs.pr
    const who = (u, name) => u
        ? `<img class="tl-av" src="${esc(u.avatar_url)}${u.avatar_url?.includes('?') ? '&' : '?'}s=48" alt="" loading="lazy"><b>${esc(u.login)}</b>`
        : `<span class="tl-av tl-av-none"></span><b>${esc(name || 'ghost')}</b>`
    const when = (iso) => `<span class="dim" title="${esc(new Date(iso).toLocaleString())}">${esc(formatWhen(iso))}</span>`
    const ev = []
    for (const c of cs.commits || []) ev.push({t: c.commit.committer?.date || c.commit.author?.date, kind: 'commit', c})
    for (const c of comments) ev.push({t: c.created_at, kind: 'comment', c})
    // inline comments as threads, under the review of their first comment
    const threads = new Map()
    for (const c of [...inline].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        const root = c.in_reply_to_id || c.id
        if (!threads.has(root)) threads.set(root, [])
        threads.get(root).push(c)
    }
    for (const r of reviews) {
        const roots = [...threads.values()].filter((th) => th[0].pull_request_review_id === r.id)
        if (r.state === 'COMMENTED' && !r.body && !roots.length) continue // a reply in a thread: shown in the thread
        if (r.state === 'PENDING') continue
        ev.push({t: r.submitted_at || r.created_at, kind: 'review', c: r, roots})
    }
    ev.sort((a, b) => (a.t || '').localeCompare(b.t || ''))
    const bodies = await Promise.all(ev.map((e) => e.kind === 'commit' ? null : sanitize(e.c.body_html || '')))
    const threadBodies = new Map()
    await Promise.all([...threads.values()].flat().map(async (c) => threadBodies.set(c.id, await sanitize(c.body_html || ''))))

    const hunk = (h) => {
        const lines = (h || '').split('\n').slice(1).slice(-4)
        return lines.length ? `<pre class="tl-hunk">${lines.map((l) => `<span class="${l[0] === '+' ? 'hk-add' : l[0] === '-' ? 'hk-del' : ''}">${esc(l)}</span>`).join('\n')}</pre>` : ''
    }
    const STATES = {APPROVED: ['approved these changes', 'ok'], CHANGES_REQUESTED: ['requested changes', 'bad'], COMMENTED: ['reviewed', ''], DISMISSED: ['had a review dismissed', '']}
    let out = ''
    for (let i = 0; i < ev.length; i++) {
        const e = ev[i]
        if (e.kind === 'commit') {
            const group = [e.c]
            while (ev[i + 1]?.kind === 'commit') group.push(ev[++i].c)
            const a = group[0]
            out += `<div class="tl-item tl-commits"><div class="tl-meta"><span class="tl-ic">${icons.commit}</span>${who(a.author, a.commit.author?.name)}
                <span class="dim">added ${group.length} commit${group.length === 1 ? '' : 's'}</span> ${when(e.t)}</div>
                <ul>${group.map((c) => `<li data-sha="${esc(c.sha)}" title="Open this commit's changes"><span class="tl-cmsg">${esc(c.commit.message.split('\n')[0])}</span><code>${short(c.sha)}</code></li>`).join('')}</ul></div>`
        } else if (e.kind === 'comment') {
            out += `<div class="tl-item tl-card"><div class="tl-meta">${who(e.c.user)} <span class="dim">commented</span> ${when(e.t)}</div>
                <article class="md tl-body">${bodies[i]}</article></div>`
        } else {
            const [label, cls] = STATES[e.c.state] || [e.c.state.toLowerCase(), '']
            out += `<div class="tl-item tl-card tl-review ${cls}"><div class="tl-meta">${who(e.c.user)} <span class="tl-state ${cls}">${label}</span> ${when(e.t)}</div>
                ${bodies[i] ? `<article class="md tl-body">${bodies[i]}</article>` : ''}
                ${e.roots.map((th) => `<div class="tl-thread"><button class="tl-path" data-path="${esc(th[0].path)}">${fileIcon(th[0].path)}<span>${esc(th[0].path)}${th[0].line || th[0].original_line ? `:${th[0].line || th[0].original_line}` : ''}</span></button>
                    ${hunk(th[0].diff_hunk)}
                    ${th.map((c) => `<div class="tl-reply"><div class="tl-meta">${who(c.user)} ${when(c.created_at)}</div><article class="md">${threadBodies.get(c.id)}</article></div>`).join('')}</div>`).join('')}</div>`
        }
    }
    const s = pr.merged_at ? 'merged' : pr.draft ? 'draft' : pr.state
    const n = cs.commits?.length || 0
    return `<div class="tl">
        <header class="tl-head"><h1>${esc(pr.title)} <span class="dim">#${pr.number}</span></h1>
            <div class="tl-sub"><span class="state-pill st-${s}">${s[0].toUpperCase() + s.slice(1)}</span>
            <span><b>${esc(pr.user?.login || '')}</b> ${pr.merged_at ? 'merged' : 'wants to merge'} ${n} commit${n === 1 ? '' : 's'} into <code>${esc(pr.base.ref)}</code> from <code>${esc(pr.head.label)}</code></span></div></header>
        <div class="tl-item tl-card tl-desc"><div class="tl-meta">${who(pr.user)} <span class="dim">opened this pull request</span> ${when(pr.created_at)}</div>
            <article class="md tl-body">${desc || '<p class="dim">No description provided.</p>'}</article></div>
        ${out}
        <div class="tl-end dim">${comments.length} comment${comments.length === 1 ? '' : 's'} · ${reviews.filter((r) => r.state !== 'PENDING').length} review${reviews.length === 1 ? '' : 's'} · <a href="${esc(pr.html_url)}" target="_blank" rel="noopener">Open PR on GitHub</a></div>
    </div>`
}

// --- quick edits, committed to the PR's branch ---

/** Edits belong to one head of one PR; null when not showing a PR's full changes. */
function headKey() {
    const {cs, target} = state
    return cs?.pr && !cs.commit && !cs.range ? `${target.owner}/${target.repo}#${target.number}@${cs.headSha}` : null
}

function canEdit(f = state.order[state.index]) {
    return !!(f && canEditPr() && f.status !== 'removed' && !isImagePath(f.path))
}

function applyEditable() {
    if (!shellBuilt) return
    const ok = state.editableFile && canEdit()
    const on = ok && state.editing
    state.sbs?.setEditable(on)
    state.unified?.updateOptions({readOnly: !on, domReadOnly: !on})
    $('#btn-edit').hidden = !ok
    $('#btn-edit').classList.toggle('on', on)
    $('#viewer').classList.toggle('editing', on)
}

function setEditing(on) {
    state.editing = on
    const f = state.order[state.index]
    // a Markdown preview is not editable: editing shows the code
    if (f && isMarkdown(f.path) && settings.mdPreview && state.editableFile) { reopenFile(true); return }
    applyEditable()
    if (on && state.editableFile) {
        const ed = renderer() === 'sbs' ? state.sbs?.right : state.unified?.getModifiedEditor()
        ed?.focus()
        toast('Editing the head of the pull request. Commit when done.', 'info', 3000)
    }
}

let editTimer
function onEdited(f, original, modified, id) {
    const text = modified.getValue()
    if (text === state.pristine) state.edits.delete(f.path)
    else state.edits.set(f.path, text)
    renderEdits()
    // the side-by-side viewer's bands follow the edit (Monaco's diff editor updates on its own)
    clearTimeout(editTimer)
    editTimer = setTimeout(async () => {
        if (id !== state.fileLoadId || modified.isDisposed() || renderer() !== 'sbs' || !state.sbs) return
        const changes = f.status === 'added' ? [wholeInsert(modified)] : await computeDiff(original, modified)
        if (id !== state.fileLoadId || modified.isDisposed()) return
        state.sbs.updateChanges(changes)
        updateToolbar()
    }, 300)
}

function renderEdits() {
    if (!shellBuilt) return
    const n = state.edits.size
    $('#btn-commit').hidden = !n
    $('#btn-commit span').textContent = `Commit${n > 1 ? ` (${n})` : ''}`
    $('#strip-badge').hidden = !n
    $('#strip-badge').textContent = n
    state.tree?.setEdited(state.edits.keys())
    if (state.sidePanel === 'commit') renderCommitPanel()
    saveEdits()
}

// edits survive a reload of the tab (sessionStorage), for the same PR head
let saveTimer
function saveEdits() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
        try {
            if (state.edits.size) sessionStorage.setItem('prv.edits', JSON.stringify({key: state.editKey, files: Object.fromEntries(state.edits)}))
            else sessionStorage.removeItem('prv.edits')
        } catch { /* too large or no storage */ }
    }, 300)
}
function restoreEdits() {
    try {
        const v = JSON.parse(sessionStorage.getItem('prv.edits') || 'null')
        if (v?.key && v.files) { state.editKey = v.key; state.edits = new Map(Object.entries(v.files)) }
    } catch { /* none */ }
}

function discardEdits(paths) {
    for (const p of paths) state.edits.delete(p)
    renderEdits()
    if (paths.includes(state.order[state.index]?.path)) reopenFile(true)
}

function rollbackChecked() {
    const paths = [...state.edits.keys()].filter((p) => !state.cmtExcluded.has(p))
    if (!paths.length) return
    if (!confirm(`Discard the edits of ${paths.length === 1 ? paths[0] : paths.length + ' files'}?`)) return
    discardEdits(paths)
}

function headCommitMessage() {
    const c = state.cs?.commits
    return c?.length ? c[c.length - 1].commit.message : ''
}

function onAmendToggle() {
    const amend = $('#cmt-amend').checked
    const ta = $('#cmt-msg')
    // as in the IDE: Amend brings the last commit's message, unticking it restores what was typed
    if (amend) { state.cmtTyped = ta.value; ta.value = headCommitMessage() }
    else ta.value = state.cmtTyped ?? ''
    renderCommitPanel(false)
}

function commitFilesList() {
    return [...state.edits.keys()].map((path) => {
        const f = state.cs?.files.find((x) => x.path === path)
        return {path, status: 'modified', additions: f?.additions ?? 0, deletions: f?.deletions ?? 0}
    })
}

function renderCommitPanel(tree = true) {
    if (!shellBuilt || !state.cmtTree) return
    const files = commitFilesList()
    const included = files.filter((f) => !state.cmtExcluded.has(f.path))
    if (tree) {
        if (files.length) {
            state.cmtTree.setFiles(files)
            state.cmtTree.setViewed(new Set(included.map((f) => f.path)))
            state.cmtTree.select(state.order[state.index]?.path)
        } else {
            state.cmtTree.files = null
            state.cmtTree.root = null
            $('#cmt-tree').innerHTML = `<div class="tree-msg dim">${canEditPr()
                ? `No changes. Turn on editing with the pencil (${icons.pencil}) over the diff, edit the right side, and commit here to <b>${esc(state.cs.pr.head.ref)}</b>.`
                : 'Only the full changes of an open pull request can be edited and committed.'}</div>`
        }
    }
    const amend = $('#cmt-amend').checked
    $('#cmt-count').textContent = files.length ? `${included.length} modified` : ''
    const pr = state.cs?.pr
    $('#cmt-to').innerHTML = pr ? `to ${icons.branch}<span>${esc(pr.head.ref)}</span>` : ''
    const msg = $('#cmt-msg').value.trim()
    $('#cmt-go').disabled = state.committing || !canEditPr() || !msg || (!included.length && !(amend && msg !== headCommitMessage().trim()))
    $('#cmt-go').textContent = state.committing ? 'Pushing…' : amend ? 'Amend and Push' : 'Commit and Push'
}

function canEditPr() {
    const pr = state.cs?.pr
    return !!(headKey() && pr.state === 'open' && pr.head?.repo)
}

function openCommitPanel() {
    setSidePanel('commit')
    if (mobileQuery.matches) openDrawer()
    setTimeout(() => $('#cmt-msg').focus(), 50)
}

async function doCommit() {
    if ($('#cmt-go').disabled) return
    if (!getToken()) {
        toast('Committing needs a GitHub token with Contents: write', 'error')
        return tokenDialog()
    }
    const {pr, headSha} = state.cs
    const amend = $('#cmt-amend').checked
    const message = $('#cmt-msg').value.trim()
    const paths = [...state.edits.keys()].filter((p) => !state.cmtExcluded.has(p))
    if (amend && !confirm(`Amend replaces the last commit of ${pr.head.ref} (a force push). Continue?`)) return
    const where = {owner: pr.head.repo.owner.login, repo: pr.head.repo.name, branch: pr.head.ref}
    state.committing = true
    $('#cmt-err').hidden = true
    renderCommitPanel(false)
    try {
        const {sha, previous} = await commitFiles({...where, expectedHead: headSha, message, amend,
            files: paths.map((path) => ({path, text: state.edits.get(path)}))})
        // the unchecked files keep their edits on the new head
        const rest = new Map([...state.edits].filter(([p]) => !paths.includes(p)))
        const t = state.target
        state.carryEdits = rest
        state.carryKey = `${t.owner}/${t.repo}#${t.number}`
        state.edits = rest
        state.cmtExcluded.clear()
        $('#cmt-msg').value = ''
        $('#cmt-amend').checked = false
        state.cmtTyped = ''
        renderEdits()
        toast(`${amend ? 'Amended' : 'Committed'} ${sha.slice(0, 7)} and pushed to ${pr.head.ref}`, 'info', 10000, {
            label: 'Undo', run: () => undoCommit(where, previous, sha),
        })
        await waitForHead(sha)
        reloadTarget()
    } catch (err) {
        let m = err.message
        if (err.status === 403 || err.status === 404) m += `. The token needs Contents: write on ${pr.head.repo.full_name}.`
        $('#cmt-err').textContent = m
        $('#cmt-err').hidden = false
    } finally {
        state.committing = false
        renderCommitPanel(false)
    }
}

/** GitHub updates the PR's head a moment after a push. */
async function waitForHead(sha) {
    const t = state.target
    for (let k = 0; k < 10; k++) {
        if (await getPullHead(t.owner, t.repo, t.number).catch(() => null) === sha) return
        await new Promise((r) => setTimeout(r, 1500))
    }
}

async function undoCommit(where, previous, sha) {
    try {
        await moveBranch({...where, sha: previous, expected: sha})
        toast(`${where.branch} is back at ${previous.slice(0, 7)}`)
        await waitForHead(previous)
        reloadTarget()
    } catch (e) {
        toast(`Undo failed: ${e.message}`, 'error', 8000)
    }
}

window.addEventListener('beforeunload', (e) => {
    if (state.edits.size) { e.preventDefault(); e.returnValue = '' }
})

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
            roundedSelection: false,
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
        fullWidthSelection(state.monaco, state.unified.getModifiedEditor())
        fullWidthSelection(state.monaco, state.unified.getOriginalEditor())
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
    for (const v of ['sbs', 'unified', 'md', 'msg']) $('#view-' + v).classList.toggle('active', v === which)
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
    if ($('#view-md').classList.contains('active')) {
        const n = state.mdMarks?.length || 0
        return {count: n, prev: state.mdCur > 0, next: state.mdCur < n - 1}
    }
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
    if ($('#view-md').classList.contains('active')) {
        const n = state.mdMarks?.length || 0
        const next = state.mdCur + dir
        if (next < 0 || next >= n) {
            if (dir > 0 && state.index < state.order.length - 1) stepFile(1)
            else if (dir < 0 && state.index > 0) stepFile(-1)
        } else markCurrent(next)
    } else if (renderer() === 'sbs' && state.sbs) {
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
    // typing in the editable head: only F7 / Shift+F7 stay shortcuts
    if (e.key !== 'F7' && state.editing && state.editableFile && e.target.closest?.('.sbs-right, .editor.modified')) return
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
        A('Markdown Preview', () => toggleMdPreview(), {toggle: s.mdPreview, ic: icons.eye}),
        state.cs?.commits?.length && A('Show Log', () => showLog(), {ic: icons.log}),
        A('Open Another Pull Request…', () => openPrDialog(), {ic: icons.folder}),
        state.cs?.pr && A('View Timeline', () => openTimeline(), {ic: icons.comment}),
        state.edits.size && A('Commit…', () => openCommitPanel(), {ic: icons.commit}),
        state.editableFile && A(state.editing ? 'Stop Editing' : 'Edit File', () => setEditing(!state.editing), {ic: icons.pencil}),
        A('Increase Font Size', () => changeFont(1), {hint: `${MOD}=`, sub: `editor, now ${fontSize()}px`}),
        A('Decrease Font Size', () => changeFont(-1), {hint: `${MOD}−`}),
        A('Reset Font Size', () => changeFont(0), {hint: `${MOD}0`}),
        A('Expand All', () => state.tree.collapseAll(false), {ic: icons.expand}),
        A('Collapse All', () => state.tree.collapseAll(true), {ic: icons.collapse}),
        state.cs?.commits?.length && A('Show Log', () => setTab('log'), {ic: icons.log}),
        A('Show Diff', () => setTab('changes'), {ic: icons.changes}),
        A('Pull Requests', () => { setSidePanel('prs'); openDrawer() }, {sub: `${t.owner}/${t.repo}`, ic: icons.pr}),
        A('Changed Files', () => { setSidePanel('changes'); openDrawer() }, {ic: icons.commit}),
        A(state.cs?.pr ? 'Open PR on GitHub' : 'Open on GitHub', () => window.open($('#btn-github').href, '_blank', 'noopener'), {ic: icons.github}),
        ...openOnGitHubItems().map((it) => A(it.label.replace(/<[^>]+>/g, '').replace(/^\s+/, ''), it.action, {ic: icons.external})),
        A('Reload', () => reloadTarget(), {ic: icons.refresh}),
        ...THEMES.map((th) => A(`Theme: ${th.name}`, () => setThemeId(th.id), {toggle: settings.theme === th.id, sub: th.dark ? 'dark' : 'light'})),
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

applyThemeCss(themeById(settings.theme))
restoreEdits()
installTooltips()
window.addEventListener('popstate', () => route())
route()
