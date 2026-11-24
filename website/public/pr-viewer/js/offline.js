// "Download for offline": fetches what the viewer shows for a repository's pull requests (each PR's files and
// contents, its commits and their contents, its conversation, and the PR lists), so the service worker (sw.js) and
// the page's contents cache have it all when there is no network. Also: what is downloaded, and how to remove it.

import {getFileContent, getTimeline, listOpenPulls, listPullRequests, loadChangeSet} from './github.js'
import {languageForPath, loadMonaco, preloadForOffline} from './editor.js'
import {loadMarkdown} from './markdown.js'

const KEY = 'prv.offline'

/** The downloaded repositories: [{owner, repo, prs: [{number, title}], commits, at}] (newest first). */
export function offlineRepos() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function saveRepos(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* no storage */ }
}

/**
 * Runs `tasks` (functions returning promises) `n` at a time; failures are counted, not thrown. Tasks may add tasks
 * to the list while it runs (the workers wait for the running ones before they stop).
 */
async function pool(tasks, n, onDone, signal) {
    let i = 0, failed = 0, running = 0
    const worker = async () => {
        for (;;) {
            if (signal?.aborted) return
            if (i < tasks.length) {
                const t = tasks[i++]
                running++
                try { await t() } catch { failed++ }
                running--
                onDone()
            } else if (running === 0) return
            else await new Promise((r) => setTimeout(r, 50))
        }
    }
    await Promise.all(Array.from({length: Math.max(1, Math.min(n, tasks.length))}, worker))
    return failed
}

/**
 * Downloads a repository's open pull requests (or `numbers`) for offline use. `commits`: also each commit's own
 * changes. `onProgress({done, total, step})`. Returns {prs, failed}.
 */
export async function downloadRepo(owner, repo, {numbers = null, commits = true, onProgress = () => {}, signal} = {}) {
    try { await navigator.storage?.persist?.() } catch { /* the browser decides */ }
    let done = 0, total = 1
    const tick = (step) => { done++; onProgress({done, total, step}) }
    onProgress({done, total, step: 'Pull request lists'})
    // the lists (the PR panel's filters) and the open PRs
    const lists = {}
    for (const state of ['open', 'closed', 'merged', 'all']) lists[state] = await listPullRequests(owner, repo, {state}).catch(() => [])
    // every open PR (the search lists above stop at 50)
    const prs = numbers ? lists.all.filter((p) => numbers.includes(p.number)) : await listOpenPulls(owner, repo).catch(() => lists.open)
    for (const n of numbers || []) if (!prs.some((p) => p.number === n)) prs.push({number: n, title: `#${n}`})
    tick('Pull request lists')

    // each PR's change set first (it tells the files and commits), then their contents
    const sets = []
    total += prs.length
    let failed = await pool(prs.map((p) => async () => {
        const cs = await loadChangeSet({type: 'pr', owner, repo, number: p.number})
        p.title = cs.title
        sets.push({cs, commits: []})
        if (commits) for (const c of cs.commits || []) sets.at(-1).commits.push(c.sha)
    }), 3, () => tick('Pull requests'), signal)

    const contents = (cs) => cs.files.flatMap((f) => [
        f.status !== 'added' && cs.baseSha ? () => getFileContent(owner, repo, cs.baseSha, f.prevPath || f.path) : null,
        f.status !== 'removed' ? () => getFileContent(owner, repo, cs.headSha, f.path) : null,
    ]).filter(Boolean)
    const tasks = []
    const languages = new Set()
    for (const {cs, commits: shas} of sets) {
        for (const f of cs.files) languages.add(languageForPath(f.path))
        tasks.push(...contents(cs), async () => {
            // the conversation, and its people's pictures (the timeline shows them)
            const tl = await getTimeline(owner, repo, cs.pr.number)
            const users = [cs.pr.user, ...(cs.commits || []).map((c) => c.author), ...tl.comments.map((c) => c.user), ...tl.reviews.map((r) => r.user), ...tl.inline.map((c) => c.user)]
            const urls = new Set(users.filter((u) => u?.avatar_url).map((u) => `${u.avatar_url}${u.avatar_url.includes('?') ? '&' : '?'}s=48`))
            await Promise.all([...urls].map((u) => fetch(u, {mode: 'no-cors'}).catch(() => {})))
        })
        for (const sha of shas) {
            tasks.push(async () => {
                const ccs = await loadChangeSet({type: 'pr', owner, repo, number: cs.pr.number, commit: sha})
                // a commit's files: queued after the current tasks
                for (const t of contents(ccs)) tasks.push(t)
                total += contents(ccs).length
            })
        }
    }
    total += tasks.length
    // the tasks list grows while it runs (commit contents); the pool reads its length each time
    failed += await pool(tasks, 6, () => tick('Files and conversations'), signal)
    if (signal?.aborted) return {prs: 0, failed, aborted: true}

    // what the page loads on demand: Monaco, the grammars of these files, both themes, Markdown
    total += 1
    try {
        const monaco = await loadMonaco()
        await Promise.all([preloadForOffline(monaco, [...languages, 'markdown', 'typescript', 'javascript', 'json', 'css', 'html', 'glsl', 'yaml', 'shellscript']), loadMarkdown()])
    } catch { failed++ }
    tick('Editor and languages')

    const list = offlineRepos().filter((r) => !(r.owner === owner && r.repo === repo))
    const before = offlineRepos().find((r) => r.owner === owner && r.repo === repo)
    const merged = new Map((before?.prs || []).map((p) => [p.number, p]))
    for (const p of prs) merged.set(p.number, {number: p.number, title: p.title})
    list.unshift({owner, repo, prs: [...merged.values()].sort((a, b) => b.number - a.number), commits, at: Date.now()})
    saveRepos(list)
    return {prs: prs.length, failed}
}

/** Removes a repository's saved responses and contents. */
export async function removeRepo(owner, repo) {
    const path = `/repos/${owner}/${repo}/`
    const q = encodeURIComponent(`repo:${owner}/${repo}`).toLowerCase()
    for (const name of ['prv-api', 'prv-contents-v1']) {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) {
            const u = decodeURIComponent(req.url)
            if (u.includes(path) || req.url.toLowerCase().includes(q) || u.includes(`repo:${owner}/${repo}`)) await cache.delete(req)
        }
    }
    saveRepos(offlineRepos().filter((r) => !(r.owner === owner && r.repo === repo)))
}

/** Removes all saved GitHub data (not the app itself). */
export async function clearOffline() {
    await caches.delete('prv-api')
    await caches.delete('prv-contents-v1')
    saveRepos([])
}

/** {usage, quota} in bytes, when the browser tells. */
export async function storageUse() {
    try { return await navigator.storage.estimate() } catch { return null }
}

/** Whether the app itself is ready offline (a service worker controls the page). */
export function appOffline() {
    try { return !!navigator.serviceWorker?.controller } catch { return false }
}
