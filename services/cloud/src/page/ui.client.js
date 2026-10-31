/* Shared by the cloud pages (/ui.js, loaded before the page's own script; src/page.ts): escaping, icons, the side bar,
   the sign-in card, dialogs instead of prompt/confirm, toasts, and the light / dark switch. Every API string goes through
   esc(); events are bound by data attributes, never with an API string in a handler. */
'use strict'
const UI = (() => {
    const THEME_KEY = 'tp-cloud-theme'
    const THEMES = ['auto', 'light', 'dark']
    const theme = () => { try { return THEMES.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'auto' } catch (e) { return 'auto' } }
    const applyTheme = t => { if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t) }
    let current = theme()
    applyTheme(current)

    const el = id => document.getElementById(id)
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
    /* binary units, like the quota (1 GB = 1024³ bytes, src/drive.ts) */
    const bytes = n => { n = Number(n) || 0; const k = 1024; return n < k ? n + ' B' : n < k ** 2 ? Math.round(n / k) + ' KB' : n < k ** 3 ? (n / k ** 2).toFixed(1) + ' MB' : +(n / k ** 3).toFixed(2) + ' GB' }

    /* 16px line icons, drawn for this page */
    const ICONS = {
        cube: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>',
        cloud: '<path d="M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-.9 3 3 0 0 1 .7 6.9z"/>',
        inbox: '<path d="M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z"/>',
        hash: '<path d="M6.5 2.5 5.5 13.5M10.5 2.5l-1 11M3 6h10.5M2.5 10H13"/>',
        folder: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/>',
        folderPlus: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/><path d="M8 7v4M6 9h4"/>',
        folderUp: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/><path d="M8 11.5V7M6 9l2-2 2 2"/>',
        file: '<path d="M4.5 2h4.5l3 3v8.5c0 .3-.2.5-.5.5h-7c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z"/><path d="M9 2v3h3"/>',
        upload: '<path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1V10"/>',
        download: '<path d="M8 2.5v8M5 7.5l3 3 3-3M2.5 11v1.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1V11"/>',
        plus: '<path d="M8 3v10M3 8h10"/>',
        link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>',
        lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
        globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.7 1.8 1.7 9.2 0 11M8 2.5c-1.7 1.8-1.7 9.2 0 11"/>',
        open: '<path d="M9 2.5h4.5V7M13.5 2.5l-6 6M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3"/>',
        copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2c0-.6-.4-1-1-1h-6c-.6 0-1 .4-1 1v6c0 .6.4 1 1 1h2"/>',
        edit: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
        move: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/><path d="M5.5 9h5M9 7.5l1.5 1.5L9 10.5"/>',
        trash: '<path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8.4c0 .3.3.6.6.6h5.6c.3 0 .6-.3.6-.6l.6-8.4"/>',
        x: '<path d="M4 4l8 8M12 4l-8 8"/>',
        refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
        search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>',
        signout: '<path d="M6.5 13.5h-3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3M10.5 11l3-3-3-3M13.5 8h-7"/>',
        theme: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor"/>',
        image: '<rect x="2.5" y="3" width="11" height="10" rx="1"/><circle cx="6" cy="6.5" r="1"/><path d="M13.5 10.5 10 7.5l-6 5.5"/>',
        key: '<circle cx="5.5" cy="10.5" r="3"/><path d="M7.7 8.3 13.5 2.5M11.5 4.5l1.5 1.5"/>',
        github: '<path fill="currentColor" stroke="none" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>',
    }
    const icon = n => '<svg class="i" viewBox="0 0 16 16" aria-hidden="true">' + (ICONS[n] || '') + '</svg>'
    const brand = () => '<div class="brand"><span class="mark">' + icon('cube') + '</span><span>threepipe cloud</span></div>'

    /* ---------- the signed-in user and their projects, for the side bar ---------- */
    let me = null, projects = null
    async function getJson(path) {
        const r = await fetch(path, {credentials: 'same-origin'})
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
    }
    /* the side bar of `page` ('drive' | 'reports'); `project` is the open project's slug. Fresh data with `reload`. */
    async function side(page, project, reload) {
        if (reload) { me = null; projects = null }
        try {
            [me, projects] = await Promise.all([me || getJson('/api/v1/me'), projects || getJson('/api/v1/projects').then(j => j.projects || [])])
        } catch (e) { return }
        const a = (href, ic, label, on, cls) => '<a href="' + esc(href) + '" class="' + (on ? 'on ' : '') + (cls || '') + '">' + icon(ic) + '<span>' + esc(label) + '</span></a>'
        const d = me.drive || {}, pct = d.quota ? Math.min(100, Math.round(d.used / d.quota * 1000) / 10) : 0
        el('side').innerHTML = brand()
            + '<div class="nav">' + a('/drive', 'cloud', 'Drive', page === 'drive') + a('/reports', 'inbox', 'Reports', page === 'reports' && !project) + '</div>'
            + (projects.length ? '<div class="nav"><div class="nav-h">Projects</div>' + projects.map(p => a('/reports#' + p.slug, 'hash', p.name || p.slug, page === 'reports' && project === p.slug, 'sub')).join('') + '</div>' : '')
            + '<div class="side-foot">'
            + (d.quota ? '<div class="usage">' + esc(bytes(d.used)) + ' of ' + esc(bytes(d.quota)) + ' used<div class="bar' + (pct >= 95 ? ' full' : '') + '"><i data-pct="' + pct + '"></i></div></div>' : '')
            + '<div class="me"><span class="avatar">' + esc(String(me.username || '?').slice(0, 1)) + '</span><div class="who"><b>' + esc(me.name || me.username) + '</b><span>@' + esc(me.username) + (me.role && me.role !== 'member' ? ' · ' + esc(me.role) : '') + '</span></div>'
            + '<button class="icon" data-theme-next title="Theme: ' + esc(current) + '" aria-label="Theme">' + icon('theme') + '</button>'
            + '<button class="icon" data-signout title="Sign out" aria-label="Sign out">' + icon('signout') + '</button></div></div>'
        // the bar's width without an inline style attribute (the page's CSP has no 'unsafe-inline')
        const bar = el('side').querySelector('.bar i'); if (bar) bar.style.width = pct + '%'
    }

    /* ---------- the sign-in card ---------- */
    function login(target, {title, text, redirect, message}) {
        target.innerHTML = '<div class="card">' + brand() + '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>'
            + (message ? '<p class="err">' + esc(message) + '</p>' : '')
            + '<div class="stack"><a class="btn dark lg" href="/api/v1/table/users/auth/oauth/github?redirect=' + encodeURIComponent(redirect) + '">' + icon('github') + 'Continue with GitHub</a>'
            + '<a class="btn lg" data-dev-login hidden href="/login?redirect=' + encodeURIComponent(redirect) + '">' + icon('key') + 'Local sign-in (development)</a></div></div>'
        // the local sign-in exists only on a development worker (DEV_LOGIN)
        fetch('/login', {method: 'HEAD'}).then(r => { const a = target.querySelector('[data-dev-login]'); if (a) a.hidden = !r.ok }).catch(() => undefined)
    }
    async function signOut() {
        await fetch('/api/v1/table/users/auth/logout', {method: 'POST', credentials: 'same-origin'}).catch(() => undefined)
        location.reload()
    }

    /* ---------- dialogs: a promise of the input's value (prompt), true (confirm) or `value()` (custom); null when cancelled ---------- */
    function dialog({title, text, input, value, placeholder, ok, danger, body, mount, result}) {
        return new Promise(resolve => {
            const d = document.createElement('dialog')
            d.innerHTML = '<form method="dialog"><h2>' + esc(title) + '</h2>' + (text ? '<p>' + esc(text) + '</p>' : '')
                + (input ? '<input name="v" autocomplete="off" spellcheck="false" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '">' : '')
                + (body || '')
                + '<div class="row"><button value="" formnovalidate data-cancel>Cancel</button><button value="ok" class="' + (danger ? 'danger' : 'primary') + '">' + esc(ok || 'OK') + '</button></div></form>'
            document.body.appendChild(d)
            let done = false
            const finish = v => { if (done) return; done = true; d.close(); d.remove(); resolve(v) }
            d.querySelector('[data-cancel]').addEventListener('click', e => { e.preventDefault(); finish(null) })
            d.addEventListener('cancel', e => { e.preventDefault(); finish(null) })
            d.querySelector('form').addEventListener('submit', e => {
                e.preventDefault()
                if (result) { const v = result(d); if (v !== undefined) finish(v); return }
                finish(input ? d.querySelector('input[name="v"]').value.trim() : true)
            })
            if (mount) mount(d)
            d.showModal()
            const first = d.querySelector('input'); if (first) { first.focus(); first.select() }
        })
    }
    const prompt = (title, value, o) => dialog({title, input: true, value, ok: 'Save', ...o}).then(v => v || null)
    const confirm = (title, text, o) => dialog({title, text, ok: 'Delete', danger: true, ...o}).then(v => v === true)

    function toast(msg, error) {
        let box = el('toasts')
        if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box) }
        const t = document.createElement('div')
        t.className = 'toast' + (error ? ' error' : ''); t.textContent = msg
        box.appendChild(t)
        setTimeout(() => t.remove(), error ? 6000 : 2500)
    }

    document.addEventListener('click', e => {
        const t = e.target.closest('[data-theme-next],[data-signout]')
        if (!t) return
        if (t.hasAttribute('data-signout')) { signOut(); return }
        current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]
        try { localStorage.setItem(THEME_KEY, current) } catch (err) { /* no storage: this page only */ }
        applyTheme(current); t.title = 'Theme: ' + current; toast('Theme: ' + current)
    })

    return {el, esc, bytes, icon, side, login, dialog, prompt, confirm, toast}
})()
