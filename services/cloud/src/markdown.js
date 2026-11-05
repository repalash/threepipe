// Copied verbatim from ijewel-mono services/share-worker/src/markdown.js @ 54d43285.
// Markdown rendering for browser viewers.
//
// A .md share opened in a browser is unreadable as plain text, but curl, wget
// and AI agents must keep getting the file byte-for-byte. This module renders
// the file to a styled HTML page ONLY for a real browser navigation; every
// other client gets the raw markdown unchanged.
//
// Escape hatches: ?raw=1 forces the raw file, ?render=1 forces the HTML page.
//
// The page loads nothing from the network and runs no script: a strict CSP
// (script-src 'none') keeps a <script> inside the markdown inert, so rendering
// a .md file stays as harmless as serving it as text.

import { marked } from 'marked'

const MD_EXT = new Set(['md', 'markdown'])

export function isMarkdownPath(path) {
	const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : ''
	return MD_EXT.has(ext)
}

// Same truthiness rule as the upload flags: ?raw / ?raw=1 on, ?raw=0 off.
function flag(url, name) {
	const v = url.searchParams.get(name)
	if (v === null) return false
	return v !== '0' && v !== 'false'
}

// True only for a top-level browser navigation (or a frame of one).
// Sec-Fetch-Dest is sent by every current browser and by no CLI or HTTP
// library; the Accept + User-Agent test covers browsers that predate it.
// curl, wget, node fetch and python requests send no Sec-Fetch-Dest, no
// text/html in Accept, and no Mozilla user agent — all three miss.
export function wantsRenderedMarkdown(request, url) {
	if (flag(url, 'raw')) return false
	if (flag(url, 'render')) return true
	const dest = request.headers.get('sec-fetch-dest')
	if (dest) return dest === 'document' || dest === 'iframe' || dest === 'frame'
	const accept = request.headers.get('accept') || ''
	if (!accept.includes('text/html')) return false
	return /^mozilla\//i.test(request.headers.get('user-agent') || '')
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// ---- marked configuration ----

// Reset per parse. marked.parse() is synchronous, so a request never sees
// another request's state.
let headings = []
let slugs = new Map()

function uniqueSlug(text) {
	const base =
		text
			.toLowerCase()
			.replace(/[^\w\- ]+/g, '')
			.trim()
			.replace(/\s+/g, '-')
			.replace(/-{2,}/g, '-') || 'section'
	const n = slugs.get(base) || 0
	slugs.set(base, n + 1)
	return n ? `${base}-${n}` : base
}

marked.use({
	gfm: true,
	renderer: {
		heading({ tokens, depth }) {
			const text = this.parser.parseInline(tokens)
			// `text` is inline HTML, so it carries entities. The document title is
			// escaped again on the way into <title>, so keep a plain-text copy.
			const plain = this.parser.parseInline(tokens, this.parser.textRenderer)
			const id = uniqueSlug(plain)
			headings.push({ depth, id, text, plain })
			return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`
		},
	},
})

// YAML front matter is metadata, not content: strip it and take the title.
// The block must open with a `key:` line. A file that opens with `---` as a
// thematic break followed by prose is not front matter, and treating it as one
// silently drops everything up to the next `---`.
function splitFrontMatter(md) {
	const m = /^---\r?\n([A-Za-z_][\w.-]*[ \t]*:[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md)
	if (!m) return { body: md, title: '' }
	const title = /^title:[ \t]*(.+)$/m.exec(m[1])
	return { body: md.slice(m[0].length), title: title ? title[1].trim().replace(/^["']|["']$/g, '') : '' }
}

function tocHtml() {
	const items = headings.filter((h) => h.depth >= 2 && h.depth <= 3)
	if (items.length < 3) return ''
	const lis = items
		.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${h.text}</a></li>`)
		.join('\n')
	return `<details class="toc"><summary>Contents</summary><ul>${lis}</ul></details>\n`
}

// ---- page ----

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d1d9e0;--code-bg:#f6f8fa;--link:#0969da;--quote:#59636e;--bar:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#30363d;--code-bg:#161b22;--link:#4493f8;--quote:#9198a1;--bar:#161b22}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
.bar{position:sticky;top:0;z-index:2;display:flex;gap:1rem;align-items:center;justify-content:space-between;padding:.5rem 1rem;background:var(--bar);border-bottom:1px solid var(--line);font-size:.8125rem;color:var(--muted)}
.bar .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar a{color:var(--link);text-decoration:none;white-space:nowrap}
.bar a:hover{text-decoration:underline}
main{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 6rem;overflow-wrap:break-word}
main>:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:2rem 0 1rem;line-height:1.25;font-weight:600}
h1{font-size:2rem;padding-bottom:.3em;border-bottom:1px solid var(--line)}
h2{font-size:1.5rem;padding-bottom:.3em;border-bottom:1px solid var(--line)}
h3{font-size:1.25rem}h4{font-size:1rem}h5{font-size:.875rem}h6{font-size:.85rem;color:var(--muted)}
.anchor{margin-left:.4em;color:var(--muted);text-decoration:none;opacity:0;font-weight:400}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor,h5:hover .anchor,h6:hover .anchor{opacity:1}
p,ul,ol,blockquote,table,pre,details{margin:0 0 1rem}
a{color:var(--link)}
ul,ol{padding-left:1.75rem}
li{margin:.25rem 0}
li>input[type=checkbox]{margin:0 .4em 0 -1.3em;vertical-align:middle}
code{font:.875em/1.45 ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;background:var(--code-bg);padding:.2em .4em;border-radius:6px}
pre{background:var(--code-bg);padding:1rem;border-radius:6px;overflow-x:auto;border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:.85rem;line-height:1.5}
blockquote{padding:0 1em;color:var(--quote);border-left:.25em solid var(--line)}
blockquote>:last-child{margin-bottom:0}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:.4rem .75rem;text-align:left}
th{background:var(--code-bg);font-weight:600}
img{max-width:100%}
hr{height:1px;border:0;background:var(--line);margin:2rem 0}
.toc{background:var(--code-bg);border:1px solid var(--line);border-radius:6px;padding:.5rem 1rem}
.toc summary{cursor:pointer;font-weight:600;font-size:.875rem}
.toc ul{list-style:none;padding:.5rem 0 0;margin:0;font-size:.875rem}
.toc li{margin:.15rem 0}
.toc .d3{padding-left:1.25rem}
`

// Renders the markdown source to a complete, self-contained HTML document.
export function markdownToPage(md, { path, rawHref }) {
	headings = []
	slugs = new Map()
	const { body, title: fmTitle } = splitFrontMatter(md)
	const bodyHtml = marked.parse(body)
	const toc = tocHtml()
	// The contents box reads better under the document title than above it.
	const cut = toc && bodyHtml.trimStart().startsWith('<h1') ? bodyHtml.indexOf('</h1>') + 5 : 0
	const content = bodyHtml.slice(0, cut) + toc + bodyHtml.slice(cut)
	const h1 = headings.find((h) => h.depth === 1)
	const title = fmTitle || (h1 ? h1.plain : path.split('/').pop())
	return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head>
<body><div class="bar"><span class="path">${escapeHtml(path)}</span><a href="${escapeHtml(rawHref)}">View raw</a></div>
<main>
${content}</main></body></html>
`
}

// The rendered page changes when the renderer changes, not only when the file
// does, so its ETag carries a fingerprint of this module. Without it a client
// that cached a page keeps being told 304 after a deploy that rewrote the CSS
// or the template. The fingerprint is derived from the source of the parts
// that shape the output, so an edit here versions the page by itself; MARKED
// tracks the one input it cannot see — bump it when package.json moves marked
// to a release that renders differently.
const MARKED = 'marked16'

function fnv1a(s) {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(36)
}

const RENDER_TAG = fnv1a(MARKED + STYLE + String(markdownToPage) + String(tocHtml) + String(splitFrontMatter))

// A rendered page is a different representation of the same object, so it gets
// its own ETag; Vary keeps a cache from serving it to curl (or the reverse).
export async function markdownResponse(obj, request, { path, rawHref }) {
	const etag = `W/"${obj.etag}-md${RENDER_TAG}"`
	const headers = {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'private, no-cache',
		etag,
		vary: 'accept, sec-fetch-dest, user-agent',
		// The markdown decides none of this page's behaviour: no script runs,
		// nothing is fetched cross-origin, and an external image cannot carry
		// the internal URL to its host.
		'content-security-policy':
			"default-src 'none'; script-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; font-src * data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
	const inm = request.headers.get('if-none-match') || ''
	if (inm.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers })
	if (request.method === 'HEAD') return new Response(null, { headers })
	return new Response(markdownToPage(await obj.text(), { path, rawHref }), { headers })
}
