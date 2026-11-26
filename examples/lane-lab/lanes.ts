// Overview of the three.js upgrade lanes, read live from npm and GitHub, and the side by side compare mode.
// No threepipe import here: the lab (script.ts) loads threepipe from the CDN with the version in the query.

const NPM = 'https://registry.npmjs.org/'
const GITHUB = 'https://api.github.com/repos/'

// The packages a lane publishes. The fork and the types first, then threepipe and the plugins that lanes release.
const PACKAGES = [
    'three-modded',
    'three-types-modded',
    'threepipe',
    '@threepipe/plugin-tweakpane',
    '@threepipe/webgi-plugins',
    '@threepipe/plugins-extra-importers',
    '@threepipe/plugin-svg-renderer',
    '@threepipe/plugin-annotations',
    '@threepipe/plugin-cloud',
]

// Where each repository keeps its lane log (a draft PR from lane/rNNN).
const REPOS = [
    {name: 'three.js-modded', path: 'repalash/three.js-modded'},
    {name: 'three-ts-types', path: 'repalash/three-ts-types'},
    {name: 'threepipe', path: 'repalash/threepipe'},
]

// Revisions planned in issues/open/three-upgrade-plan.md that may not have a branch or a release yet.
const PLANNED = ['r172', 'r177', 'r180', 'r181', 'r182', 'r183', 'r184', 'r185', 'r186', 'r187']

interface PullInfo {repo: string, number: number, state: string, url: string, updated: string}

async function distTags(name: string): Promise<Record<string, string>> {
    // the abbreviated document has the dist-tags and is served with CORS (the /-/package/<name>/dist-tags endpoint is not)
    const res = await fetch(NPM + name.replace('/', '%2f'), {headers: {accept: 'application/vnd.npm.install-v1+json'}})
    if (!res.ok) return {}
    return (await res.json())['dist-tags'] ?? {}
}

async function lanePulls(repo: {name: string, path: string}): Promise<PullInfo[]> {
    const res = await fetch(GITHUB + repo.path + '/pulls?state=all&per_page=100')
    if (!res.ok) throw new Error(`GitHub ${repo.path}: ${res.status}${res.status === 403 ? ' (rate limit, try again later)' : ''}`)
    const pulls = await res.json() as any[]
    return pulls
        .filter(p => /^lane\/r\d+$/.test(p.head?.ref ?? ''))
        .map(p => ({
            repo: repo.name,
            number: p.number,
            state: p.merged_at ? 'merged' : p.draft && p.state === 'open' ? 'draft' : p.state,
            url: p.html_url,
            updated: (p.updated_at ?? '').slice(0, 10),
            lane: p.head.ref.slice('lane/'.length),
        } as PullInfo & {lane: string}))
}

function el(tag: string, html = '') {
    const e = document.createElement(tag)
    e.innerHTML = html
    return e
}

function esc(s: string) {
    return s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!)
}

function labLink(threepipe: string | undefined, tweakpane: string | undefined, text: string) {
    if (!threepipe) return ''
    const q = new URLSearchParams({threepipe})
    if (tweakpane) q.set('tweakpane', tweakpane)
    return `<a href="?${q}">${text}</a>`
}

function installSnippet(tags: Record<string, Record<string, string>>, tag: string) {
    const threepipe = tags.threepipe?.[tag]
    const three = tags['three-modded']?.[tag]
    const types = tags['three-types-modded']?.[tag]
    if (!threepipe || !three) return ''
    return JSON.stringify({
        dependencies: {
            'threepipe': threepipe,
            'three': 'npm:three-modded@' + three,
            ...types ? {'@types/three': 'npm:three-types-modded@' + types} : {},
        },
        overrides: {'three': '$three', ...types ? {'@types/three': '$@types/three'} : {}},
    }, null, 4)
}

async function overview(root: HTMLElement) {
    root.appendChild(el('h1', 'three.js upgrade lanes'))
    root.appendChild(el('p', 'Each lane takes one three.js revision through the fork (<code>three-modded</code>), its types and threepipe. ' +
        'Lanes publish release candidates under the npm dist-tag <code>three-rNNN</code>; <code>latest</code> stays on the released revision. ' +
        'Read live from npm and GitHub. <span class="muted">The plan: issues/open/three-upgrade-plan.md in the repository.</span>'))
    const status = root.appendChild(el('p', '<span class="muted">Loading…</span>'))

    const tagEntries = await Promise.all(PACKAGES.map(async p => [p, await distTags(p).catch(() => ({}))] as const))
    const tags: Record<string, Record<string, string>> = Object.fromEntries(tagEntries)
    let pulls: (PullInfo & {lane: string})[] = []
    let githubError = ''
    try {
        pulls = (await Promise.all(REPOS.map(lanePulls))).flat() as any
    } catch (e: any) {
        githubError = e.message
    }

    const lanes = new Set(PLANNED)
    for (const t of Object.values(tags)) for (const k of Object.keys(t)) if (/^three-r\d+$/.test(k)) lanes.add(k.slice('three-'.length))
    for (const p of pulls) lanes.add(p.lane)
    const sorted = [...lanes].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))

    status.innerHTML = githubError ? `<span class="muted">Lane PRs could not be loaded: ${esc(githubError)}</span>` : ''

    // released and the dev prerelease channel
    const released = el('table')
    released.innerHTML = '<tr><th>Channel</th>' + PACKAGES.map(p => `<th><code>${p.replace('@threepipe/', '')}</code></th>`).join('') + '<th></th></tr>' +
        ['latest', 'next'].map(ch => `<tr><td><code>${ch}</code></td>` +
            PACKAGES.map(p => `<td>${tags[p]?.[ch] ? `<a href="https://www.npmjs.com/package/${p}/v/${tags[p][ch]}">${tags[p][ch]}</a>` : '<span class="muted">-</span>'}</td>`).join('') +
            `<td>${labLink(tags.threepipe?.[ch], tags['@threepipe/plugin-tweakpane']?.[ch] ?? tags['@threepipe/plugin-tweakpane']?.latest, 'Open lab')}</td></tr>`).join('')
    root.appendChild(el('h2', 'Released'))
    root.appendChild(released)

    const table = el('table')
    table.innerHTML = '<tr><th>Lane</th><th>three-modded</th><th>three-types-modded</th><th>threepipe</th><th>Plugins</th><th>Lane PRs</th><th>Lab</th></tr>'
    for (const lane of sorted) {
        const tag = 'three-' + lane
        const v = (p: string) => tags[p]?.[tag]
        const cell = (p: string) => v(p) ? `<a href="https://www.npmjs.com/package/${p}/v/${v(p)}">${v(p)}</a>` : '<span class="muted">-</span>'
        const plugins = PACKAGES.slice(3).filter(p => v(p)).map(p => `<code>${p.replace('@threepipe/', '')}</code> ${cell(p)}`).join('<br>') || '<span class="muted">-</span>'
        const prs = pulls.filter(p => p.lane === lane)
            .map(p => `<a href="${p.url}">${p.repo} #${p.number}</a> <span class="pr-state ${p.state}">${p.state}</span>`).join('<br>') ||
            '<span class="muted">not started</span>'
        const lab = v('threepipe') ? [
            labLink(v('threepipe'), v('@threepipe/plugin-tweakpane') ?? tags['@threepipe/plugin-tweakpane']?.latest, 'Open'),
            `<a href="?${new URLSearchParams({compare: '1', threepipe: v('threepipe')!, tweakpane: v('@threepipe/plugin-tweakpane') ?? tags['@threepipe/plugin-tweakpane']?.latest ?? 'latest'})}">Compare with latest</a>`,
        ].join('<br>') : '<span class="muted">no threepipe rc yet</span>'
        const row = el('tr')
        row.innerHTML = `<td><b>${lane}</b></td><td>${cell('three-modded')}</td><td>${cell('three-types-modded')}</td><td>${cell('threepipe')}</td><td>${plugins}</td><td>${prs}</td><td>${lab}</td>`
        table.appendChild(row)
        const snippet = installSnippet(tags, tag)
        if (snippet) {
            const r2 = el('tr')
            r2.innerHTML = `<td></td><td colspan="6"><details><summary>Install ${lane} in an app</summary><pre>${esc(snippet)}</pre>` +
                '<span class="muted">Other packages\' version ranges do not match prereleases, so <code>overrides</code> keeps one three in the tree. Plugins: the same dist-tag, e.g. <code>@threepipe/plugin-tweakpane@' + tag + '</code>.</span></details></td>'
            table.appendChild(r2)
        }
    }
    root.appendChild(el('h2', 'Lanes'))
    root.appendChild(table)
}

// Two labs side by side: the build from the query on the right, `base` (default: latest) on the left. The cameras follow
// each other: a lab posts its camera to this page, which passes it to the other one.
function compare() {
    const q = new URLSearchParams(location.search)
    const right = new URLSearchParams(q)
    right.delete('compare')
    right.delete('base')
    const left = new URLSearchParams(right)
    left.delete('lane')
    left.delete('tweakpane')
    left.set('threepipe', q.get('base') || 'latest')
    if (!q.get('base')) left.set('tweakpane', 'latest')
    const frames = document.body.appendChild(el('div'))
    frames.id = 'compare-frames'
    const a = frames.appendChild(el('iframe')) as HTMLIFrameElement
    const b = frames.appendChild(el('iframe')) as HTMLIFrameElement
    a.src = '?' + left
    b.src = '?' + right
    window.addEventListener('message', (e) => {
        if (e.data?.type !== 'lane-lab-camera') return
        const target = e.source === a.contentWindow ? b : e.source === b.contentWindow ? a : null
        target?.contentWindow?.postMessage(e.data, '*')
    })
}

if (document.documentElement.dataset.mode === 'compare') compare()
else overview(document.getElementById('lane-overview')!).catch(e => {
    document.getElementById('lane-overview')!.appendChild(el('p', 'Error: ' + esc(String(e?.message ?? e))))
})

export {}
