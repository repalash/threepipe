// Markdown for the PR timeline and the preview of .md files in the diff: markdown-it (GitHub-flavored enough:
// tables, strikethrough, autolinks, task lists), sanitized with DOMPurify, code blocks highlighted by Shiki.
// In the diff preview the blocks whose source lines changed are marked (md-ins / md-mod / md-del).

import {highlightCode} from './editor.js'

const MD_IT = 'https://esm.sh/markdown-it@14.1.0'
const PURIFY = 'https://esm.sh/dompurify@3.2.4'

let libs
export function loadMarkdown() {
    libs ??= Promise.all([import(MD_IT), import(PURIFY)]).then(([m, p]) => {
        const md = new m.default({html: true, linkify: true})
        const purify = p.default
        purify.addHook('afterSanitizeAttributes', (node) => {
            const href = node.tagName === 'A' && node.getAttribute('href')
            if (href && !href.startsWith('#')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer') }
        })
        return {md, purify}
    })
    libs.catch(() => { libs = null })
    return libs
}

/** Sanitized HTML (GitHub's rendered bodies are sanitized already; this is a second guard). */
export async function sanitize(html) {
    const {purify} = await loadMarkdown()
    return purify.sanitize(html || '', {ADD_ATTR: ['target']})
}

const LIST = new Set(['bullet_list_open', 'ordered_list_open'])

/** Marks top-level blocks and list items by `classify(start, end)` (0-based source lines, end exclusive). */
function markBlocks(tokens, classify, map) {
    const src = (i) => (map ? map[i] : i + 1) // the source line (1-based) of a rendered line, 0 if put back
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (!t.map || t.nesting === -1) continue
        let [a, b] = t.map
        if (t.type === 'list_item_open') {
            // the item's own lines: up to a nested list
            for (let j = i + 1; j < tokens.length && !(tokens[j].type === 'list_item_close' && tokens[j].level === t.level); j++)
                if (LIST.has(tokens[j].type) && tokens[j].map) { b = tokens[j].map[0]; break }
        } else if (t.level !== 0 || LIST.has(t.type)) continue
        // the block's source lines, for the connectors between the two sides
        let sl = 0, el = 0
        for (let k = a; k < b; k++) { const l = src(k); if (l) { sl ||= l; el = l } }
        if (sl && t.type !== 'html_block') { t.attrSet('data-sl', String(sl)); t.attrSet('data-el', String(el)) }
        const cls = classify?.(a, b)
        if (!cls) continue
        if (t.type === 'html_block') t.content = `<div class="${cls}">\n${t.content}\n</div>\n`
        else t.attrJoin('class', cls)
    }
}

/**
 * Renders Markdown to sanitized HTML. `classify` marks changed blocks; `link(href)` / `image(src)` resolve relative
 * URLs (return null to keep one).
 */
export async function renderMarkdown(text, {classify, link, image, marks = false, map = null} = {}) {
    const {md, purify} = await loadMarkdown()
    const env = {}
    const tokens = md.parse(text, env)
    markBlocks(tokens, classify, map)
    for (const t of tokens) {
        if (t.type !== 'inline' || !t.children) continue
        for (const c of t.children) {
            if (c.type === 'link_open' && link) { const r = link(c.attrGet('href') || ''); if (r) c.attrSet('href', r) }
            if (c.type === 'image' && image) { const r = image(c.attrGet('src') || ''); if (r) c.attrSet('src', r) }
        }
    }
    let html = md.renderer.render(tokens, md.options, env)
    // task lists, as on GitHub
    html = html.replace(/<li([^>]*)>(\s*<p>)?\[( |x|X)\]\s/g, (m, attrs, p, x) =>
        `<li${attrs.includes('class="') ? attrs.replace('class="', 'class="task ') : attrs + ' class="task"'}>${p || ''}<input type="checkbox" disabled${x === ' ' ? '' : ' checked'}> `)
    html = purify.sanitize(html, {ADD_ATTR: ['target']})
    if (!marks) return html
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    applyMarks(tpl.content)
    return tpl.innerHTML
}

/** Highlights the fenced code blocks under `el` with Shiki (asynchronously, block by block). */
export async function highlightBlocks(el) {
    for (const code of el.querySelectorAll('pre > code[class*="language-"]')) {
        const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9)
        const html = lang && await highlightCode(code.textContent.replace(/\n$/, ''), lang)
        if (!html || !code.isConnected) continue
        const tpl = document.createElement('template')
        tpl.innerHTML = html
        const pre = tpl.content.firstElementChild
        for (const c of code.classList) if (c.startsWith('md-')) pre.classList.add(c)
        code.parentElement.replaceWith(pre)
    }
}

/** Resolvers for relative links and images of a Markdown file at `ref` in `owner/repo`. */
export function repoResolvers(owner, repo, ref, path) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const resolve = (u) => {
        if (!u || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(u)) return null
        const abs = new URL(u, 'https://x/' + (u.startsWith('/') ? '' : dir)).pathname.slice(1)
        return {path: abs, rest: u.includes('#') ? u.slice(u.indexOf('#')) : ''}
    }
    return {
        link: (u) => { const r = resolve(u); return r && `https://github.com/${owner}/${repo}/blob/${ref}/${r.path}${r.rest}` },
        // github.com/…/raw/… works for private repositories when the browser is signed in to GitHub
        image: (u) => { const r = resolve(u); return r && `https://github.com/${owner}/${repo}/raw/${ref}/${r.path}` },
    }
}

// --- rich diff: changed words marked inside the rendered Markdown ---
// Changed character ranges are wrapped in private-use characters in the Markdown source, rendered, and then turned
// into <ins> / <del> in the text (never in attributes). On one page (phones), the removed words and blocks are put
// back into the new text, struck through.

const INS_S = '\uE000', INS_E = '\uE001', DEL_S = '\uE002', DEL_E = '\uE003'
const MARKS = /[\uE000-\uE003]/g
const HAS_MARK = /[\uE000-\uE003]/
// block syntax a mark must not precede: quotes, list bullets / numbers (with a task box), headings
const SYNTAX = /^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/
// lines that get no marks: code fences and table separator rows
const NO_MARKS = /^\s*(?:```|~~~|\|?\s*:?-{3,}:?\s*(\||$))/

/** Inserts [col, text] pairs into a line (0-based columns), keeping the block syntax at its start intact. */
function insertAt(line, inserts) {
    if (!inserts.length || NO_MARKS.test(line)) return line
    const min = line.match(SYNTAX)[0].length
    const at = inserts.map(([c, t], i) => [Math.max(min, Math.min(line.length, c)), t, i]).sort((a, b) => b[0] - a[0] || b[2] - a[2])
    for (const [c, t] of at) line = line.slice(0, c) + t + line.slice(c)
    return line
}

/** Per-line [from, to) column segments of a character range (1-based lines and columns, end exclusive). */
function segments(lines, sl, sc, el, ec) {
    const out = []
    for (let l = Math.max(1, sl); l <= el && l <= lines.length; l++) {
        const from = l === sl ? sc - 1 : 0, to = l === el ? ec - 1 : lines[l - 1].length
        if (to > from) out.push([l, from, to])
    }
    return out
}

const escapeMd = (s) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&')

/**
 * Markdown sources with the changed words marked: `side` 'new' (inserted words; with `unified`, also the removed
 * words and blocks put back) or 'old' (removed words). Returns {text, map}: map[i] is the source line (1-based) of
 * line i of `text`, or 0 for a line put back from the old side.
 */
export function richSource(oldText, newText, lineChanges, side, unified = false) {
    const oldLines = oldText.split('\n'), newLines = newText.split('\n')
    const lines = side === 'old' ? oldLines : newLines
    const ins = new Map() // line -> [[col, text]]
    const add = (l, c, t) => { if (!ins.has(l)) ins.set(l, []); ins.get(l).push([c, t]) }
    const before = new Map(), after = new Map() // line -> lines put back (unified)
    const putBack = (m, l, block) => { if (!m.has(l)) m.set(l, []); m.get(l).push(...block) }
    const delBlock = (from, to) => ['', '<div class="md-delblock">', '', ...oldLines.slice(from - 1, to), '', '</div>', '']
    for (const c of lineChanges) {
        const hasO = c.originalEndLineNumber > 0, hasM = c.modifiedEndLineNumber > 0
        if (c.charChanges?.length && hasO && hasM) {
            for (const cc of c.charChanges) {
                if (side === 'old') {
                    for (const [l, a, b] of segments(oldLines, cc.originalStartLineNumber, cc.originalStartColumn, cc.originalEndLineNumber, cc.originalEndColumn)) { add(l, a, DEL_S); add(l, b, DEL_E) }
                    continue
                }
                if (unified) {
                    // the removed words, at the position of the change on the new side
                    const del = segments(oldLines, cc.originalStartLineNumber, cc.originalStartColumn, cc.originalEndLineNumber, cc.originalEndColumn)
                        .map(([l, a, b]) => oldLines[l - 1].slice(a, b)).join(' ')
                    if (del.trim()) add(cc.modifiedStartLineNumber, cc.modifiedStartColumn - 1, DEL_S + escapeMd(del) + DEL_E)
                }
                for (const [l, a, b] of segments(newLines, cc.modifiedStartLineNumber, cc.modifiedStartColumn, cc.modifiedEndLineNumber, cc.modifiedEndColumn)) { add(l, a, INS_S); add(l, b, INS_E) }
            }
        } else if (unified && side === 'new' && hasO) {
            // removed lines (or a change too large for word marks): the old lines, struck through, where they were
            if (hasM) putBack(before, c.modifiedStartLineNumber, delBlock(c.originalStartLineNumber, c.originalEndLineNumber))
            else putBack(after, c.modifiedStartLineNumber, delBlock(c.originalStartLineNumber, c.originalEndLineNumber))
        }
    }
    const text = [], map = []
    if (after.has(0)) for (const x of after.get(0)) { text.push(x); map.push(0) }
    lines.forEach((line, i) => {
        const l = i + 1
        for (const x of before.get(l) || []) { text.push(x); map.push(0) }
        text.push(insertAt(line, ins.get(l) || []))
        map.push(l)
        for (const x of after.get(l) || []) { text.push(x); map.push(0) }
    })
    return {text: text.join('\n'), map}
}

/** Turns the marks in rendered HTML into <ins> / <del> (text only; marks in attributes and code blocks are dropped). */
export function applyMarks(root) {
    for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (HAS_MARK.test(a.value)) el.setAttribute(a.name, a.value.replace(MARKS, ''))
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    let open = null // 'ins' | 'del'
    let block = null
    for (const node of nodes) {
        const s = node.nodeValue
        // a mark never runs past its block
        let top = node
        while (top.parentNode && top.parentNode !== root) top = top.parentNode
        if (top !== block) { block = top; open = null }
        const inPre = node.parentElement?.closest('pre')
        if (!HAS_MARK.test(s) && !open) continue
        if (inPre) { node.nodeValue = s.replace(MARKS, ''); open = null; continue }
        const frag = document.createDocumentFragment()
        let buf = ''
        const flush = () => {
            if (!buf) return
            if (open) { const w = document.createElement(open); w.className = 'mdw'; w.textContent = buf; frag.appendChild(w) }
            else frag.appendChild(document.createTextNode(buf))
            buf = ''
        }
        for (const ch of s) {
            if (ch === INS_S || ch === DEL_S) { flush(); open = ch === INS_S ? 'ins' : 'del' }
            else if (ch === INS_E || ch === DEL_E) { flush(); open = null }
            else buf += ch
        }
        flush()
        node.replaceWith(frag)
    }
}
