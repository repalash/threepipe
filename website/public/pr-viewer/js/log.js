// The IDE's Log tab for the commits of a PR (or compare): a commit list with a graph line, a text/hash filter, the
// changed files of the selected commit (or of a shift-selected range of commits), and the commit details.

import {renderMarkdown} from './markdown.js'
import {getCommitFiles} from './github.js'
import {FileTree} from './tree.js'
import {icons} from './icons.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])

export function formatWhen(iso) {
    const d = new Date(iso)
    const now = new Date()
    const mins = Math.round((now - d) / 60000)
    const time = d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
    if (mins >= 0 && mins < 60) return mins <= 1 ? 'Moments ago' : `${mins} minutes ago`
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const days = Math.round((day(now) - day(d)) / 86400000)
    if (days === 0) return `Today ${time}`
    if (days === 1) return `Yesterday ${time}`
    return `${d.toLocaleDateString(undefined, {year: '2-digit', month: '2-digit', day: '2-digit'})}, ${time}`
}

export class LogView {
    constructor(el, {onOpen}) {
        this.el = el
        this.onOpen = onOpen
        this.commits = []
        this.sel = null // {anchor, a, b} display indices (newest first)
        this.filter = ''
        el.innerHTML = `
            <div class="log">
                <div class="log-main">
                    <div class="log-tools">
                        <label class="log-search">${icons.search}<input id="log-filter" placeholder="Text or hash" spellcheck="false" autocomplete="off"></label>
                        <span class="spacer"></span>
                        <span class="dim small" id="log-count"></span>
                    </div>
                    <div class="log-list" id="log-list" tabindex="0"></div>
                </div>
                <div class="log-side">
                    <div class="log-side-tools">
                        <button class="btn btn-small" id="log-open" title="Show the changes of the selection (double-click a commit, or Enter)">${icons.changes} Show Diff</button>
                        <span class="spacer"></span>
                        <span class="dim small" id="log-files-count"></span>
                    </div>
                    <div class="tree log-tree" id="log-tree"></div>
                    <div class="log-details" id="log-details"></div>
                </div>
            </div>`
        this.list = el.querySelector('#log-list')
        this.tree = new FileTree(el.querySelector('#log-tree'), {onSelect: (path) => this.onOpen(this.spec(), path)})
        el.querySelector('#log-filter').addEventListener('input', (e) => { this.filter = e.target.value.trim().toLowerCase(); this.render() })
        el.querySelector('#log-open').onclick = () => this.sel && this.onOpen(this.spec())
        this.list.addEventListener('click', (e) => {
            const row = e.target.closest('.lr')
            if (!row) return
            const i = +row.dataset.i
            if (e.shiftKey && this.sel) this.sel = {anchor: this.sel.anchor, a: Math.min(this.sel.anchor, i), b: Math.max(this.sel.anchor, i)}
            else this.sel = {anchor: i, a: i, b: i}
            this.render()
            this.loadSelection()
        })
        this.list.addEventListener('dblclick', (e) => {
            if (e.target.closest('.lr') && this.sel) this.onOpen(this.spec())
        })
        this.list.addEventListener('keydown', (e) => {
            if (!this.sel) return
            if (e.key === 'Enter') return this.onOpen(this.spec())
            const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
            if (!d) return
            e.preventDefault()
            const i = Math.max(0, Math.min(this.commits.length - 1, (d > 0 ? this.sel.b : this.sel.a) + d))
            this.sel = e.shiftKey ? {anchor: this.sel.anchor, a: Math.min(this.sel.anchor, i), b: Math.max(this.sel.anchor, i)} : {anchor: i, a: i, b: i}
            this.render()
            this.list.querySelector(`.lr[data-i="${i}"]`)?.scrollIntoView({block: 'nearest'})
            this.loadSelection()
        })
    }

    /** `commits` oldest first as GitHub lists them; `selected` is the commit spec in use ('sha' or 'a..b'), if any. */
    setCommits(commits, {owner, repo, selected, headRef}) {
        this.owner = owner
        this.repo = repo
        this.headRef = headRef
        this.commits = [...commits].reverse()
        this.sel = null
        if (selected) {
            const [a, b = a] = selected.split(/\.{2,3}/)
            const ib = this.commits.findIndex((c) => c.sha.startsWith(b))
            const ia = this.commits.findIndex((c) => c.sha.startsWith(a))
            if (ia >= 0 && ib >= 0) this.sel = {anchor: ib, a: Math.min(ia, ib), b: Math.max(ia, ib)}
        }
        if (!this.sel && this.commits.length) this.sel = {anchor: 0, a: 0, b: 0}
        this.render()
        this.loadSelection()
    }

    /** The selection as a commit spec: 'sha' or 'olderSha..newerSha'. */
    spec() {
        const newer = this.commits[this.sel.a], older = this.commits[this.sel.b]
        return newer === older ? newer.sha : `${older.sha}..${newer.sha}`
    }

    render() {
        const f = this.filter
        const n = this.commits.length
        this.el.querySelector('#log-count').textContent = `${n} commit${n === 1 ? '' : 's'}`
        this.list.innerHTML = this.commits.map((c, i) => {
            const msg = c.commit.message.split('\n')[0]
            if (f && !msg.toLowerCase().includes(f) && !c.sha.startsWith(f) && !(c.author?.login || '').toLowerCase().includes(f)) return ''
            const sel = this.sel && i >= this.sel.a && i <= this.sel.b
            const head = i === 0
            return `<div class="lr${sel ? ' sel' : ''}" data-i="${i}" title="${esc(c.sha)}">
                <span class="lg"><i class="lg-line${i === 0 ? ' first' : ''}${i === n - 1 ? ' last' : ''}"></i><i class="lg-dot${head ? ' head' : ''}"></i></span>
                <span class="lm">${esc(msg)}${head && this.headRef ? ` <span class="lref">${icons.branch}${esc(this.headRef)}</span>` : ''}</span>
                <span class="la">${esc(c.author?.login || c.commit.author?.name || '')}</span>
                <span class="ld">${esc(formatWhen(c.commit.author?.date || c.commit.committer?.date))}</span>
            </div>`
        }).join('') || '<div class="dim small" style="padding:10px">No commits</div>'
    }

    async loadSelection() {
        if (!this.sel) return
        const newer = this.commits[this.sel.a], older = this.commits[this.sel.b]
        const id = (this.loadId = (this.loadId || 0) + 1)
        const details = this.el.querySelector('#log-details')
        if (newer === older) {
            const c = newer.commit
            const committer = c.committer && c.committer.name !== c.author?.name ? `<div class="dim">committed by ${esc(c.committer.name)}</div>` : ''
            const [subject, ...rest] = c.message.split('\n')
            const lines = rest.join('\n').trim().split('\n')
            // trailers ("Co-Authored-By: …") at the end stay one per line
            let t = lines.length
            while (t > 0 && /^[A-Za-z][\w-]*: \S/.test(lines[t - 1])) t--
            if (t > 0 && lines[t - 1].trim()) t = lines.length
            const body = lines.slice(0, t).join('\n').trim()
            const trailers = lines.slice(t).map((l) => `<div>${esc(l).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)}</div>`).join('')
            details.innerHTML = `<div class="log-msg"><div class="log-subject">${esc(subject)}</div>${body ? `<pre class="log-body">${esc(body)}</pre>` : ''}${trailers ? `<div class="log-trailers">${trailers}</div>` : ''}</div>
                <div><span class="log-sha">${newer.sha.slice(0, 8)}</span> ${esc(c.author?.name || '')}${newer.author?.login ? ` <span class="dim">@${esc(newer.author.login)}</span>` : ''}
                on ${esc(new Date(c.author?.date).toLocaleString())}</div>${committer}
                <div><a href="${esc(newer.html_url)}" target="_blank" rel="noopener">Open on GitHub</a></div>`
        } else {
            details.innerHTML = `<div>${this.sel.b - this.sel.a + 1} commits selected</div><div class="dim">${older.sha.slice(0, 8)} … ${newer.sha.slice(0, 8)}</div>`
        }
        // the commit message's body as Markdown (lists, code, links), as commit bodies are usually written
        const bodyEl = details.querySelector('.log-body')
        if (bodyEl) renderMarkdown(bodyEl.textContent).then((html) => {
            if (id !== this.loadId || !bodyEl.isConnected) return
            const art = document.createElement('article')
            art.className = 'md md-compact log-body'
            art.innerHTML = html
            bodyEl.replaceWith(art)
        }).catch(() => {})
        this.el.querySelector('#log-files-count').textContent = ''
        this.el.querySelector('#log-tree').innerHTML = '<div class="tree-msg dim">Loading…</div>'
        try {
            const files = await getCommitFiles(this.owner, this.repo, older.sha, newer.sha, older.parents?.[0]?.sha)
            if (id !== this.loadId) return
            this.tree.setFiles(files)
            this.el.querySelector('#log-files-count').textContent = `${files.length} file${files.length === 1 ? '' : 's'}`
        } catch (e) {
            if (id !== this.loadId) return
            this.el.querySelector('#log-tree').innerHTML = `<div class="tree-msg dim">${esc(e.message)}</div>`
        }
    }
}
