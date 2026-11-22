// Copied verbatim from ijewel-mono services/share-worker/src/video.js @ 1b5cd38e (ijewel3d/ijewel-mono PR 978).
// A video file of a share opened in a browser gets a player page (IJ-1506), as a
// .md file gets a rendered page (markdown.js): the video full width, its size,
// and the raw link. The decision is markdown.js's `wantsRenderedMarkdown`: only a
// top-level browser navigation (or a frame of one) gets the page. A <video> tag,
// fetch, curl and ?raw always get the bytes, which honour Range (worker.js), so
// the player can seek.
//
// The page runs no script and loads only the video from its own origin.

const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov'])

export function isVideoPath(path) {
	const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : ''
	return VIDEO_EXT.has(ext)
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function size(bytes) {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const STYLE = `
:root{color-scheme:dark}
body{margin:0;background:#0f1115;color:#e8e8ea;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1200px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:18px;font-weight:600;margin:0 0 12px;word-break:break-word}
video{display:block;width:100%;max-height:82vh;background:#000;border-radius:8px}
p{color:#9aa0a6;margin:12px 0 0;font-size:14px}
a{color:#8ab4f8}
`

// `path` is shown as the title (slug/dir/file), `rawHref` is a relative link to
// the bytes (the file's own name with ?raw=1), `shareHref` the share's root
// (optional: a host with no file list leaves it out).
export function videoPage(obj, { path, rawHref, shareHref }) {
	const name = escapeHtml(path)
	const type = escapeHtml(obj.httpMetadata?.contentType || '')
	const uploaded = obj.uploaded ? obj.uploaded.toISOString().slice(0, 10) : ''
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><style>${STYLE}</style></head>
<body><main>
<h1>${name}</h1>
<video controls playsinline preload="metadata" src="${escapeHtml(rawHref)}"></video>
<p>${size(obj.size)} · ${type}${uploaded ? ` · uploaded ${uploaded}` : ''} · <a href="${escapeHtml(rawHref)}" download>Download</a>${shareHref ? ` · <a href="${escapeHtml(shareHref)}">All files of this share</a>` : ''}</p>
</main></body></html>`
}

// The page is another representation of the object: its own ETag, and Vary so a
// cache never hands it to a <video> request (or the bytes to a navigation).
export function videoResponse(obj, request, opts) {
	const etag = `W/"${obj.etag}-video1"`
	const headers = {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'private, no-cache',
		etag,
		vary: 'accept, sec-fetch-dest, user-agent',
		'content-security-policy':
			"default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
	const inm = request.headers.get('if-none-match') || ''
	if (inm.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers })
	if (request.method === 'HEAD') return new Response(null, { headers })
	return new Response(videoPage(obj, opts), { headers })
}
