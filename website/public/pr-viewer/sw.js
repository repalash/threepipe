// The offline app: this service worker keeps the page and its libraries, and the GitHub API responses the page
// fetched (everything opened, and what "Download for offline" fetched), so the viewer works with no network.
//
// - the page's own files: from the network when it answers in time (so updates arrive), else the saved copy
// - libraries at fixed versions (Monaco, Shiki, markdown-it, fonts) and avatars: the saved copy first
// - GitHub API GETs: the network first; the saved copy when offline or slow. Responses that come from the saved copy
//   carry `x-prv-offline: 1`, so the page can say it shows a saved copy.
// File contents at a commit are kept by the page itself (Cache Storage, prv-contents-v1), not here.

const VERSION = 'v4'
const SHELL = 'prv-shell-' + VERSION
const LIBS = 'prv-libs'
const API = 'prv-api'
const KEEP = [SHELL, LIBS, API, 'prv-contents-v1', 'prv-pack']

const SHELL_FILES = [
    './', './index.html', './style.css', './manifest.webmanifest',
    './js/main.js', './js/github.js', './js/editor.js', './js/themes.js', './js/sbs.js', './js/tree.js', './js/icons.js',
    './js/log.js', './js/palette.js', './js/markdown.js', './js/tooltip.js', './js/offline.js', './js/monaco-worker.js',
    './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
]
// files.threepipe.org: snapshots recorded there never change (a new recording gets a new folder)
const LIB_HOSTS = new Set(['cdn.jsdelivr.net', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com', 'avatars.githubusercontent.com', 'files.threepipe.org'])

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith('prv-') && !KEEP.includes(k)) await caches.delete(k)
        await self.clients.claim()
    })())
})

self.addEventListener('fetch', (e) => {
    const req = e.request
    if (req.method !== 'GET') return
    const url = new URL(req.url)
    if (url.origin === location.origin) {
        if (url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) e.respondWith(shell(req))
    } else if (url.host === 'api.github.com') {
        // contents at a commit are cached by the page; the rest is kept here
        if (!(req.headers.get('accept') || '').includes('raw')) e.respondWith(api(req))
    } else if (LIB_HOSTS.has(url.host)) {
        e.respondWith(lib(req))
    }
})

const timeout = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms))

/** The page's files: fresh from the network within 3 s, else the saved copy (and the network one saved later). */
async function shell(req) {
    const cache = await caches.open(SHELL)
    const net = fetch(req).then((res) => {
        if (res.ok) cache.put(stripQuery(req), res.clone())
        return res
    })
    const first = await Promise.race([net.catch(() => null), timeout(3000)])
    // only a good answer wins over the saved copy (a dead tunnel or proxy answers with an error page)
    if (first && first !== 'timeout' && first.ok) return first
    const hit = await cache.match(stripQuery(req)) || await cache.match(req, {ignoreSearch: true})
    if (hit) return hit
    return first && first !== 'timeout' ? first : net
}

// `index.html?pr=…` and `./?pr=…` are the same page
function stripQuery(req) {
    const u = new URL(req.url)
    if (u.pathname.endsWith('/') || u.pathname.endsWith('.html')) u.search = ''
    return u.pathname.endsWith('/') || u.pathname.endsWith('.html') ? new Request(u.href) : req
}

/** Libraries at fixed versions never change: the saved copy, else the network (and saved). */
async function lib(req) {
    const cache = await caches.open(LIBS)
    const hit = await cache.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone())
    return res
}

/** The cache key of an API request: its URL and the Accept header (one URL can answer as JSON or as HTML bodies). */
function apiKey(req) {
    const u = new URL(req.url)
    return `https://prv.offline/${encodeURIComponent(req.headers.get('accept') || '')}${u.pathname}${u.search}`
}

function offlineCopy(res) {
    const h = new Headers(res.headers)
    h.set('x-prv-offline', '1')
    h.set('access-control-expose-headers', 'x-prv-offline')
    return new Response(res.body, {status: res.status, statusText: res.statusText, headers: h})
}

/** GitHub: the network first (saved for later); offline, or slower than 8 s with a saved copy, the saved copy. */
async function api(req) {
    const cache = await caches.open(API)
    const key = apiKey(req)
    const net = fetch(req).then((res) => {
        if (res.ok) cache.put(key, res.clone())
        return res
    })
    const first = await Promise.race([net.catch((e) => e), timeout(8000)])
    if (first instanceof Response) return first
    const hit = await cache.match(key)
    if (hit) return offlineCopy(hit)
    if (first === 'timeout') return net.catch(() => notSaved())
    return notSaved()
}

function notSaved() {
    return new Response(JSON.stringify({message: 'Offline, and this was not downloaded for offline'}), {
        status: 503,
        headers: {'content-type': 'application/json', 'x-prv-offline': '1', 'access-control-expose-headers': 'x-prv-offline'},
    })
}
