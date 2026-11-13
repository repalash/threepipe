// A small tab on the left edge of each example page, for its source and a prompt to give an agent. Loaded by
// global-loading.mjs. That edge is the spot least used by the examples' own UI (measured on a sample of 42 pages: no overlap).
// No dependencies and no storage, so it also works on sandboxed pages (the pull request previews on files.threepipe.org).
// The screenshot tests hide it (tests/helpers.ts).

const REPO = 'https://github.com/repalash/threepipe'
const RAW = 'https://raw.githubusercontent.com/repalash/threepipe'
const GUIDE = 'https://threepipe.org/guide/getting-started.html'
const API = 'https://threepipe.org/docs/'
const FOR_AGENTS = new URL('../llms.txt', import.meta.url).href

/**
 * What the panel shows, from the page. The site of `master` links to `master`; anywhere else (the dev site, previews,
 * local) links to `dev`, where a new example already exists.
 * @param {{pathname: string, hostname: string, title?: string, scripts?: string, imports?: string[]}} page
 *   `scripts` is `data-scripts` of the example's script tag, `imports` the names in its import map.
 * @returns {{name: string, title: string, sourceUrl: string, liveUrl: string, prompt: string} | null} null outside an example
 */
export function exampleInfo({pathname, hostname, title = '', scripts = '', imports = []}) {
    const name = /\/examples\/([^/]+)(?:\/|$)/.exec(pathname)?.[1]
    if (!name || name.startsWith('_') || name.includes('.')) return null
    const master = hostname === 'threepipe.org' || hostname === 'www.threepipe.org'
    const ref = master ? 'master' : 'dev'
    const liveUrl = `https://${master ? '' : 'dev.'}threepipe.org/examples/${name}/`
    // the sources: `./script.ts;./script.js` lists the file a build writes too
    const listed = scripts.split(';').map(s => s.trim().replace(/^\.\//, '')).filter(Boolean)
    const files = listed.length > 1 ? listed.filter(s => !s.endsWith('.js')) : listed
    const folderUrl = `${REPO}/tree/${ref}/examples/${name}`
    const sourceUrl = files.length ? `${REPO}/blob/${ref}/examples/${name}/${files[0]}` : folderUrl
    const sources = files.length ? files.map(f => `${RAW}/${ref}/examples/${name}/${f}`) : [folderUrl]
    const page = `${RAW}/${ref}/examples/${name}/index.html`
    const label = title.trim() || name
    const prompt = [
        `Use threepipe (a 3D web framework built on three.js) to build something like its "${label}" example.`,
        '',
        `Live example: ${liveUrl}`,
        `Source: ${sources.join(' ')}`,
        ...sources.includes(page) ? [] : [`Page and import map: ${page}`],
        ...imports.length ? [`Packages it uses: ${imports.join(', ')}`] : [],
        `Docs: ${GUIDE} and the API reference ${API}`,
        '',
        'Read the source first. Use the same threepipe plugins and APIs instead of writing the same thing in plain three.js.',
    ].join('\n')
    return {name, title: label, sourceUrl, liveUrl, prompt}
}

const STYLE = `
:host { position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 1000; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    --bg: #1c1c1e; --fg: #f2f2f4; --muted: #a0a0a8; --line: rgba(255, 255, 255, .12); --hover: rgba(255, 255, 255, .08) }
@media (prefers-color-scheme: light) { :host { --bg: #fff; --fg: #1c1c1e; --muted: #63636b; --line: rgba(0, 0, 0, .12); --hover: rgba(0, 0, 0, .06) } }
* { box-sizing: border-box }
.open { display: grid; place-items: center; width: 20px; height: 44px; padding: 0; color: var(--muted); background: var(--bg);
    border: 1px solid var(--line); border-left: 0; border-radius: 0 8px 8px 0; cursor: pointer; opacity: .7 }
.open:hover, .open[aria-expanded="true"] { color: var(--fg); opacity: 1 }
.panel { position: absolute; left: 24px; top: 50%; transform: translateY(-50%); width: 160px; padding: 4px; color: var(--fg); background: var(--bg);
    border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, .2) }
.panel[hidden] { display: none }
a, .row { display: block; width: 100%; padding: 4px 8px; color: inherit; font: inherit; text-align: left; text-decoration: none;
    background: none; border: 0; border-radius: 8px; cursor: pointer }
a:hover, .row:hover { background: var(--hover) }
:focus-visible { outline: 2px solid #4c8dff; outline-offset: 1px }
textarea { display: block; width: 100%; height: 120px; margin-top: 4px; padding: 6px; color: inherit; font: 11px/1.4 ui-monospace, monospace;
    background: none; border: 1px solid var(--line); border-radius: 8px; resize: none }
textarea[hidden] { display: none }
`
const ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>'

function link(text, href) {
    const a = document.createElement('a')
    Object.assign(a, {textContent: text, href, target: '_blank', rel: 'noopener'})
    return a
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false // not allowed here (a sandboxed page, or http): the panel shows the text instead
    }
}

function mount(info) {
    const host = document.createElement('div')
    host.id = 'tp-example-info'
    const root = host.attachShadow({mode: 'open'})
    root.innerHTML = `<style>${STYLE}</style><div class="panel" id="panel" hidden></div>
        <button class="open" type="button" aria-label="About this example" title="About this example" aria-expanded="false" aria-controls="panel">${ICON}</button>`
    const panel = root.getElementById('panel')
    const open = root.querySelector('.open')

    const copyButton = document.createElement('button')
    copyButton.className = 'row'
    copyButton.type = 'button'
    copyButton.textContent = 'Copy agent prompt'
    const text = document.createElement('textarea')
    text.readOnly = true
    text.hidden = true
    text.value = info.prompt
    text.setAttribute('aria-label', 'Prompt for an agent')
    panel.append(link('View source', info.sourceUrl), copyButton, text, link('For agents', FOR_AGENTS), link('Docs', GUIDE))
    if (window.self !== window.top) panel.append(link('Open in a new tab', location.href))

    copyButton.addEventListener('click', async() => {
        if (await copy(info.prompt)) {
            copyButton.textContent = 'Copied'
            setTimeout(() => copyButton.textContent = 'Copy agent prompt', 1500)
            return
        }
        text.hidden = false
        text.select()
        copyButton.textContent = 'Copy it from here'
    })
    const toggle = (show) => {
        panel.hidden = !show
        open.setAttribute('aria-expanded', String(show))
    }
    open.addEventListener('click', () => toggle(panel.hidden))
    // capture: a viewer's canvas may stop the events it handles
    document.addEventListener('pointerdown', e => {
        if (!panel.hidden && !e.composedPath().includes(host)) toggle(false)
    }, true)
    host.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !panel.hidden) {
            toggle(false)
            open.focus()
        }
    })
    document.body.appendChild(host)
}

function run() {
    let imports = []
    try {
        imports = Object.keys(JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || '{}').imports ?? {})
    } catch { /* not JSON: the prompt goes without the list */ }
    const script = document.getElementById('example-script')
    const info = exampleInfo({
        pathname: location.pathname,
        hostname: location.hostname,
        title: document.title,
        // no list: the code of a script without a src is in the page itself
        scripts: script?.dataset.scripts ?? (script && !script.getAttribute('src') ? './index.html' : undefined),
        imports,
    })
    if (info) mount(info)
}

// not in Node (the unit test imports exampleInfo; its setup has only a stub of document)
if (typeof globalThis.document?.getElementById === 'function') run()
