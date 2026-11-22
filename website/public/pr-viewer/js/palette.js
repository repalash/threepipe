// "Search Everywhere" as in JetBrains IDEs (double Shift): tabs, one input, results grouped by kind, arrow keys and
// Enter. It searches what the page has: the changed files, the actions and settings, the commits, and (on its tab) the
// repository's pull requests.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])

/**
 * Fuzzy match of `query` (space-separated words, each a subsequence) in `text`. Returns {score, hits} or null; hits are
 * matched character indices. Consecutive characters and word starts (after / . _ - space, or a capital) score higher.
 */
export function fuzzy(query, text) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return {score: 0, hits: []}
    const lower = text.toLowerCase()
    let score = 0
    const hits = []
    for (const w of words) {
        // prefer a contiguous occurrence, at a word start when there is one
        let best = -1
        for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) {
            if (best < 0) best = i
            if (i === 0 || /[\s/._\-]/.test(text[i - 1]) || /[A-Z]/.test(text[i])) { best = i; break }
        }
        if (best >= 0) {
            const start = best === 0 || /[\s/._\-]/.test(text[best - 1]) || /[A-Z]/.test(text[best])
            score += w.length * 4 + (start ? 6 : 0) - best * 0.01
            for (let k = 0; k < w.length; k++) hits.push(best + k)
            continue
        }
        // fuzzy, as the IDE does it: a letter starts a word, or comes later in the word of the previous letter
        // ("uas" → UseAutoSave, "trim ws" → Trim WhiteSpaces), so letters strewn across a sentence do not match
        const isStart = (j) => j === 0 || /[\s/._\-]/.test(text[j - 1]) || /[A-Z]/.test(text[j])
        const sameWord = (from, to) => { for (let j = from; j <= to; j++) if (isStart(j)) return false; return true }
        let ti = 0, prev = -2
        for (const ch of w) {
            let i = lower.indexOf(ch, ti)
            while (i >= 0 && !(i === prev + 1 || isStart(i) || (prev >= 0 && sameWord(prev + 1, i)))) i = lower.indexOf(ch, i + 1)
            if (i < 0) return null
            if (i > prev + 1 && prev >= 0) score -= 0.5
            score += i === prev + 1 ? 3 : 1
            if (i === 0 || /[\s/._\-]/.test(text[i - 1]) || /[A-Z]/.test(text[i])) score += 2
            hits.push(i)
            prev = i
            ti = i + 1
        }
    }
    return {score, hits}
}

function highlight(text, hits) {
    if (!hits?.length) return esc(text)
    const set = new Set(hits)
    let out = ''
    for (let i = 0; i < text.length; i++) out += set.has(i) ? `<b>${esc(text[i])}</b>` : esc(text[i])
    return out
}

/**
 * `sources`: {key: {title, limit, items(query) -> [{label, sub?, icon?, hint?, toggle?, match?, run}] | Promise, remote?}}.
 * `match` (default label) is the text searched; `remote` sources are not shown in "All" and receive the query.
 */
export class Palette {
    constructor(sources, {tabs}) {
        this.sources = sources
        this.tabs = tabs // [{key: 'all' | source key, title}]
        this.tab = 'all'
        this.sel = 0
        this.rows = []
        const el = (this.el = document.createElement('div'))
        el.className = 'pal'
        el.hidden = true
        el.innerHTML = `
            <div class="pal-box" role="dialog" aria-label="Search Everywhere">
                <div class="pal-tabs"></div>
                <div class="pal-input"><input spellcheck="false" autocomplete="off" placeholder="Type to search files, actions, commits…"></div>
                <div class="pal-list"></div>
                <div class="pal-foot">↑↓ to move · Enter to open · Tab to switch · Double Shift to toggle</div>
            </div>`
        document.body.appendChild(el)
        this.input = el.querySelector('input')
        this.list = el.querySelector('.pal-list')
        this.tabsEl = el.querySelector('.pal-tabs')
        el.addEventListener('pointerdown', (e) => { if (e.target === el) this.close() })
        this.input.addEventListener('input', () => { this.sel = 0; this.refresh() })
        this.input.addEventListener('keydown', (e) => this.onKey(e))
        this.tabsEl.addEventListener('click', (e) => {
            const b = e.target.closest('[data-tab]')
            if (b) this.setTab(b.dataset.tab)
        })
        this.list.addEventListener('click', (e) => {
            const r = e.target.closest('.pal-row')
            if (r) this.choose(+r.dataset.i)
        })
        this.list.addEventListener('pointermove', (e) => {
            const r = e.target.closest('.pal-row')
            if (r && +r.dataset.i !== this.sel) { this.sel = +r.dataset.i; this.paintSel() }
        })
    }

    get isOpen() { return !this.el.hidden }

    open(tab = 'all') {
        this.tab = tab
        this.el.hidden = false
        this.input.select()
        this.input.focus()
        this.sel = 0
        this.refresh()
    }

    close() {
        this.el.hidden = true
    }

    toggle(tab) {
        this.isOpen ? this.close() : this.open(tab)
    }

    setTab(tab) {
        this.tab = tab
        this.sel = 0
        this.refresh()
        this.input.focus()
    }

    onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); this.close() }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!this.rows.length) return
            this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.rows.length) % this.rows.length
            this.paintSel()
        } else if (e.key === 'Enter') { e.preventDefault(); this.choose(this.sel) }
        else if (e.key === 'Tab') {
            e.preventDefault()
            const i = this.tabs.findIndex((t) => t.key === this.tab)
            this.setTab(this.tabs[(i + (e.shiftKey ? -1 : 1) + this.tabs.length) % this.tabs.length].key)
        }
    }

    choose(i) {
        const r = this.rows[i]
        if (!r) return
        this.close()
        r.run()
    }

    async refresh() {
        const q = this.input.value.trim()
        const id = (this.refreshId = (this.refreshId || 0) + 1)
        this.tabsEl.innerHTML = this.tabs.map((t) => `<button data-tab="${t.key}" class="${t.key === this.tab ? 'on' : ''}">${esc(t.title)}</button>`).join('')
        const keys = this.tab === 'all' ? Object.keys(this.sources).filter((k) => !this.sources[k].remote) : [this.tab]
        const groups = []
        for (const key of keys) {
            const src = this.sources[key]
            if (src.remote) {
                this.list.innerHTML = '<div class="pal-empty">Searching…</div>'
                await new Promise((r) => setTimeout(r, 350)) // debounce: the search API allows a few requests a minute
                if (id !== this.refreshId) return
            }
            let items = src.items(q)
            if (items instanceof Promise) {
                this.list.innerHTML = '<div class="pal-empty">Searching…</div>'
                try { items = await items } catch (e) { items = []; groups.push({title: src.title, error: e.message, rows: []}) }
                if (id !== this.refreshId) return
            }
            let rows
            if (src.remote || !q) rows = items.map((it) => ({...it, hits: null}))
            else {
                rows = []
                for (const it of items) {
                    const m = fuzzy(q, it.match ?? it.label)
                    if (m) { rows.push({...it, score: m.score + 2, hits: it.match ? null : m.hits}); continue }
                    // the full path or the sha also match, ranked below a match in the name
                    const m2 = it.alt && fuzzy(q, it.alt)
                    if (m2) rows.push({...it, score: m2.score - 4, hits: null})
                }
                rows.sort((a, b) => b.score - a.score)
            }
            const limit = this.tab === 'all' ? src.limit ?? 6 : 200
            if (rows.length) groups.push({title: src.title, rows: rows.slice(0, limit), more: rows.length - limit})
        }
        if (id !== this.refreshId) return
        this.rows = []
        let html = ''
        for (const g of groups) {
            if (this.tab === 'all' || g.error) html += `<div class="pal-group">${esc(g.title)}${g.error ? ` <span class="dim">${esc(g.error)}</span>` : ''}</div>`
            for (const r of g.rows) {
                const i = this.rows.push(r) - 1
                const hint = r.toggle !== undefined ? `<span class="pal-toggle${r.toggle ? ' on' : ''}">${r.toggle ? 'ON' : 'OFF'}</span>` : r.hint ? `<span class="pal-hint">${esc(r.hint)}</span>` : ''
                html += `<div class="pal-row ${r.cls || ''}" data-i="${i}">${r.icon || '<span class="fi"></span>'}<span class="pal-label">${highlight(r.label, r.hits)}</span>${r.sub ? `<span class="pal-sub">${esc(r.sub)}</span>` : ''}${hint}</div>`
            }
            if (this.tab === 'all' && g.more > 0) html += `<div class="pal-more" data-tab-link="${esc(g.title)}">${g.more} more…</div>`
        }
        this.list.innerHTML = html || `<div class="pal-empty">${q ? 'Nothing found' : 'Nothing here'}</div>`
        for (const m of this.list.querySelectorAll('.pal-more')) {
            const key = Object.keys(this.sources).find((k) => this.sources[k].title === m.dataset.tabLink)
            m.onclick = () => key && this.setTab(key)
        }
        if (this.sel >= this.rows.length) this.sel = 0
        this.paintSel()
    }

    paintSel() {
        for (const r of this.list.querySelectorAll('.pal-row')) r.classList.toggle('sel', +r.dataset.i === this.sel)
        this.list.querySelector('.pal-row.sel')?.scrollIntoView({block: 'nearest'})
    }
}

/** Calls `fn` on a double tap of Shift alone (as in JetBrains IDEs). */
export function onDoubleShift(fn, ms = 400) {
    let last = 0
    let alone = false
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') { if (!e.repeat) alone = true }
        else { alone = false; last = 0 }
    }, true)
    window.addEventListener('keyup', (e) => {
        if (e.key !== 'Shift' || !alone) return
        const now = performance.now()
        if (now - last < ms) { last = 0; fn() }
        else last = now
    }, true)
    window.addEventListener('blur', () => { last = 0 })
}
