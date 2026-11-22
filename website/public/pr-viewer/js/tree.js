// The changed-files tree of the IDE's Changes view: grouped by directory, chains of single directories compacted
// ("tests/e2e"), directories before files, a file count on each directory, names colored by change status.

import {fileIcon, icons} from './icons.js'

const cmp = (a, b) => a.localeCompare(b, undefined, {sensitivity: 'base', numeric: true})

export function buildTree(files) {
    const root = {name: '', path: '', dirs: new Map(), files: []}
    for (const f of files) {
        const parts = f.path.split('/')
        let node = root
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i]
            if (!node.dirs.has(key)) node.dirs.set(key, {name: key, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: []})
            node = node.dirs.get(key)
        }
        node.files.push(f)
    }
    const finish = (node) => {
        let dirs = [...node.dirs.values()]
        dirs = dirs.map((d) => {
            while (d.files.length === 0 && d.dirs.size === 1) {
                const only = [...d.dirs.values()][0]
                d = {...only, name: d.name + '/' + only.name}
            }
            return d
        })
        dirs.forEach(finish)
        node.children = dirs.sort((a, b) => cmp(a.name, b.name))
        node.files.sort((a, b) => cmp(a.path.split('/').pop(), b.path.split('/').pop()))
        node.count = node.files.length + dirs.reduce((s, d) => s + d.count, 0)
    }
    finish(root)
    return root
}

/** Files in tree display order (for previous/next file). */
export function flattenTree(root) {
    const out = []
    const walk = (n) => {
        n.children.forEach(walk)
        out.push(...n.files)
    }
    walk(root)
    return out
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c])

const STATUS_LABEL = {added: 'Added', removed: 'Deleted', modified: 'Modified', renamed: 'Renamed', copied: 'Copied', changed: 'Changed'}

export class FileTree {
    constructor(el, {onSelect, onToggleViewed = null}) {
        this.el = el
        this.onSelect = onSelect
        this.onToggleViewed = onToggleViewed // set: a Viewed slot on each file (blue dot: not viewed yet)
        this.collapsed = new Set()
        this.selected = null
        this.viewed = new Set()
        el.addEventListener('click', (e) => {
            const row = e.target.closest('.tr')
            if (!row) return
            if (e.target.closest('.tvd') && this.onToggleViewed) {
                e.stopPropagation()
                return this.onToggleViewed(row.dataset.file)
            }
            if (row.dataset.dir !== undefined) {
                const p = row.dataset.dir
                this.collapsed.has(p) ? this.collapsed.delete(p) : this.collapsed.add(p)
                this.render()
            } else if (row.dataset.file) {
                this.onSelect(row.dataset.file)
            }
        })
    }

    setFiles(files) {
        this.files = files
        this.root = buildTree(files)
        this.order = flattenTree(this.root)
        this.render()
    }

    setViewed(viewed) {
        this.viewed = viewed
        this.render()
    }

    select(path) {
        this.selected = path
        // expand the ancestors of the selected file
        for (const key of [...this.collapsed]) {
            const dir = key.split('|')[0]
            if (key === '|root' || path.startsWith(dir + '/')) this.collapsed.delete(key)
        }
        this.render()
        this.el.querySelector('.tr.sel')?.scrollIntoView({block: 'nearest'})
    }

    collapseAll(collapse) {
        this.collapsed.clear()
        if (collapse) {
            const walk = (n) => n.children.forEach((d) => { this.collapsed.add(d.path + '|' + d.name); walk(d) })
            walk(this.root)
        }
        this.render()
    }

    render() {
        if (!this.root) return
        const rows = []
        const dirRow = (label, key, depth, count, open) =>
            `<div class="tr tr-dir" data-dir="${esc(key)}" style="--d:${depth}">
                <span class="tw">${open ? icons.chevronDown : icons.chevronRight}</span>
                <span class="fi fi-glyph fi-folder">${icons.folder}</span>
                <span class="tn">${esc(label)}</span><span class="tc">${count} file${count === 1 ? '' : 's'}</span>
            </div>`
        const walk = (node, depth) => {
            for (const d of node.children) {
                const key = d.path + '|' + d.name
                const open = !this.collapsed.has(key)
                rows.push(dirRow(d.name, key, depth, d.count, open))
                if (open) walk(d, depth + 1)
            }
            for (const f of node.files) {
                const name = f.path.split('/').pop()
                const viewed = this.viewed.has(f.path)
                const title = `${STATUS_LABEL[f.status] || f.status}: ${f.prevPath ? f.prevPath + ' → ' : ''}${f.path}  (+${f.additions} −${f.deletions})`
                rows.push(`<div class="tr tr-file st-${f.status}${f.path === this.selected ? ' sel' : ''}${viewed ? ' viewed' : ''}" data-file="${esc(f.path)}" style="--d:${depth}" title="${esc(title)}">
                    <span class="tw"></span>${fileIcon(f.path)}<span class="tn">${esc(name)}</span>${this.onToggleViewed
                        ? `<span class="tvd" title="${viewed ? 'Viewed: click to unmark' : 'Mark as viewed'}"><i class="tvd-dot"></i><i class="tvd-box">${viewed ? icons.check : ''}</i></span>` : ''}
                </div>`)
            }
        }
        const rootOpen = !this.collapsed.has('|root')
        rows.push(dirRow('', '|root', 0, this.root.count, rootOpen).replace('<span class="tn"></span>', ''))
        if (rootOpen) walk(this.root, 1)
        this.el.innerHTML = rows.join('')
    }
}
