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
function markBlocks(tokens, classify) {
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (!t.map || t.nesting === -1) continue
        let [a, b] = t.map
        if (t.type === 'list_item_open') {
            // the item's own lines: up to a nested list
            for (let j = i + 1; j < tokens.length && !(tokens[j].type === 'list_item_close' && tokens[j].level === t.level); j++)
                if (LIST.has(tokens[j].type) && tokens[j].map) { b = tokens[j].map[0]; break }
        } else if (t.level !== 0 || LIST.has(t.type)) continue
        const cls = classify(a, b)
        if (!cls) continue
        if (t.type === 'html_block') t.content = `<div class="${cls}">\n${t.content}\n</div>\n`
        else t.attrJoin('class', cls)
    }
}

/**
 * Renders Markdown to sanitized HTML. `classify` marks changed blocks; `link(href)` / `image(src)` resolve relative
 * URLs (return null to keep one).
 */
export async function renderMarkdown(text, {classify, link, image} = {}) {
    const {md, purify} = await loadMarkdown()
    const env = {}
    const tokens = md.parse(text, env)
    if (classify) markBlocks(tokens, classify)
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
    return purify.sanitize(html, {ADD_ATTR: ['target']})
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
