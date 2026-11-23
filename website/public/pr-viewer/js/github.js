// GitHub access: the REST API for pull requests, commits, compares and file contents, and GraphQL for the
// "Viewed" state of PR files. A token is optional for public repositories; it is kept in this browser only.

const API = 'https://api.github.com'
const FULL = 'application/vnd.github.full+json' // bodies also as GitHub's rendered HTML (body_html)
const TOKEN_KEY = 'prv.token'

export function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function setToken(token) {
    try { token ? localStorage.setItem(TOKEN_KEY, token.trim()) : localStorage.removeItem(TOKEN_KEY) } catch { /* no storage */ }
}

export class GitHubError extends Error {
    constructor(message, status) {
        super(message)
        this.status = status
    }
}

// --- snapshots: `?snap=<name>` answers from recorded API responses (`snap/<name>/`, written by
// tools/record-snapshot.cjs), to try the page with no token or network to GitHub. Kept for the tab's session.

const SNAP = (() => {
    try {
        const s = new URLSearchParams(location.search).get('snap')
        if (s !== null) s ? sessionStorage.setItem('prv.snap', s) : sessionStorage.removeItem('prv.snap')
        return sessionStorage.getItem('prv.snap') || ''
    } catch { return '' }
})()
export const snapshotName = () => SNAP

/** The snapshot key of an API request: its path and query, and the method when it is not GET. */
export function snapKey(url, method = 'GET') {
    const u = new URL(url, API)
    return (method === 'GET' ? '' : method + ' ') + u.pathname + u.search
}

let snapIndex
async function snapRequest(url, method) {
    snapIndex ??= fetch(new URL(`../snap/${encodeURIComponent(SNAP)}/index.json`, import.meta.url)).then((r) => {
        if (!r.ok) throw new GitHubError(`Snapshot "${SNAP}" not found`, r.status)
        return r.json()
    })
    const index = await snapIndex
    const e = index[snapKey(url, method)]
    if (!e) throw new GitHubError('Not in this snapshot (it has only what was recorded)', 404)
    const res = await fetch(new URL(`../snap/${encodeURIComponent(SNAP)}/${e.file}`, import.meta.url))
    return new Response(await res.arrayBuffer(), {status: e.status, headers: {'Content-Type': e.type}})
}

async function request(path, {accept = 'application/vnd.github+json', method = 'GET', body} = {}) {
    if (SNAP) {
        const res = await snapRequest(path.startsWith('http') ? path : API + path, method)
        if (!res.ok) throw new GitHubError(`HTTP ${res.status}`, res.status)
        return res
    }
    const headers = {Accept: accept}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'
    const res = await fetch(path.startsWith('http') ? path : API + path, {method, headers, body: body && JSON.stringify(body)})
    // a saved copy from the offline app (sw.js)
    if (res.headers.get('x-prv-offline')) window.dispatchEvent(new CustomEvent('prv-offline'))
    if (!res.ok) {
        let message = res.statusText || `HTTP ${res.status}`
        try { message = (await res.json()).message || message } catch { /* not json */ }
        if (res.status === 404 && !token) message += '. If the repository is private, add a GitHub token.'
        if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0')
            message = 'GitHub API rate limit reached' + (token ? '' : '. Add a GitHub token for a higher limit.')
        if (res.status === 401) message = 'GitHub refused the token (401). Check or replace it.'
        throw new GitHubError(message, res.status)
    }
    return res
}

const json = async (path, opts) => (await request(path, opts)).json()

/** Fetches all pages of a list endpoint (`per_page=100`). `pick` extracts the array from a page. */
async function paginate(path, pick = (x) => x, max = 30, opts) {
    const out = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; page <= max; page++) {
        const items = pick(await json(`${path}${sep}per_page=100&page=${page}`, opts))
        out.push(...items)
        if (items.length < 100) break
    }
    return out
}

/**
 * Reads what to show from a GitHub URL or a short form:
 * - https://github.com/o/r/pull/12 (also .../pull/12/files, .../pull/12/commits/<sha>), o/r#12, o/r/12
 * - https://github.com/o/r/commit/<sha>
 * - https://github.com/o/r/compare/base...head
 */
export function parseTarget(input) {
    let s = (input || '').trim()
    if (/github\.com\//i.test(s)) s = s.replace(/[?#].*$/, '')
    let m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:\/commits\/([0-9a-f]{7,40}))?/i)
    if (m) return {type: 'pr', owner: m[1], repo: m[2], number: +m[3], commit: m[4]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([0-9a-f]{7,40})/i)
    if (m) return {type: 'commit', owner: m[1], repo: m[2], sha: m[3]}
    m = s.match(/github\.com\/([^/\s]+)\/([^/\s]+)\/compare\/(.+?)(\.{2,3})(.+)$/i)
    if (m) return {type: 'compare', owner: m[1], repo: m[2], base: decodeURIComponent(m[3]), head: decodeURIComponent(m[5])}
    m = s.match(/^([\w.-]+)\/([\w.-]+)(?:#|\/pull\/|\/)(\d+)$/)
    if (m) return {type: 'pr', owner: m[1], repo: m[2], number: +m[3]}
    return null
}

/** The query string that reopens a target (and is shareable). */
export function targetToParams(t) {
    const p = new URLSearchParams()
    if (t.type === 'pr') {
        p.set('pr', `${t.owner}/${t.repo}/${t.number}`)
        if (t.commit) p.set('commit', t.commit)
    } else if (t.type === 'commit') p.set('commit', `${t.owner}/${t.repo}/${t.sha}`)
    else if (t.type === 'compare') p.set('compare', `${t.owner}/${t.repo}/${t.base}...${t.head}`)
    return p
}

export function paramsToTarget(params) {
    const pr = params.get('pr')
    if (pr) {
        const [owner, repo, number] = pr.split('/')
        if (owner && repo && +number) return {type: 'pr', owner, repo, number: +number, commit: params.get('commit') || undefined}
    }
    const commit = params.get('commit')
    if (commit && commit.includes('/')) {
        const [owner, repo, sha] = commit.split('/')
        if (owner && repo && sha) return {type: 'commit', owner, repo, sha}
    }
    const compare = params.get('compare')
    if (compare) {
        const m = compare.match(/^([^/]+)\/([^/]+)\/(.+?)\.{2,3}(.+)$/)
        if (m) return {type: 'compare', owner: m[1], repo: m[2], base: m[3], head: m[4]}
    }
    return null
}

function mapFiles(files) {
    return files.map((f) => ({
        path: f.filename,
        prevPath: f.previous_filename,
        status: f.status, // added, removed, modified, renamed, copied, changed, unchanged
        additions: f.additions,
        deletions: f.deletions,
        blobSha: f.sha,
    }))
}

/**
 * Loads a change set: `{title, owner, repo, baseSha, headSha, files, htmlUrl, pr?, commits?, commit?}`.
 * For a PR the base is the merge base (what GitHub's "Files changed" shows). With `target.commit`, only that
 * commit of the PR (against its parent).
 */
export async function loadChangeSet(target) {
    const {owner, repo} = target
    const R = `/repos/${owner}/${repo}`
    if (target.type === 'pr') {
        const [pr, commits] = await Promise.all([
            json(`${R}/pulls/${target.number}`, {accept: FULL}), // with body_html, the description as GitHub renders it
            paginate(`${R}/pulls/${target.number}/commits`, (x) => x, 3).catch(() => []),
        ])
        const base = {
            owner, repo, pr, commits,
            title: pr.title,
            htmlUrl: pr.html_url,
        }
        if (target.commit?.includes('..')) {
            // a range of the PR's commits (picked in the Log): from the first one's parent to the last one
            const [a, b] = target.commit.split(/\.{2,3}/)
            const first = commits.find((c) => c.sha.startsWith(a))
            const baseSha = first?.parents?.[0]?.sha || `${a}^`
            const cmp = await json(`${R}/compare/${baseSha}...${b}?per_page=100`)
            return {...base, baseSha, headSha: cmp.commits?.length ? cmp.commits[cmp.commits.length - 1].sha : b, files: mapFiles(cmp.files || []),
                range: [a, b], htmlUrl: `${pr.html_url}/files/${baseSha}..${b}`}
        }
        if (target.commit) {
            const c = await loadCommit(owner, repo, target.commit)
            return {...base, ...c, commit: c.commitInfo, htmlUrl: `${pr.html_url}/commits/${c.headSha}`}
        }
        const [files, cmp] = await Promise.all([
            paginate(`${R}/pulls/${target.number}/files`),
            json(`${R}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`).catch(() => null),
        ])
        return {
            ...base,
            baseSha: cmp?.merge_base_commit?.sha || pr.base.sha,
            headSha: pr.head.sha,
            files: mapFiles(files),
        }
    }
    if (target.type === 'commit') {
        const c = await loadCommit(owner, repo, target.sha)
        return {owner, repo, ...c, commit: c.commitInfo, title: c.commitInfo.message.split('\n')[0], htmlUrl: c.commitInfo.html_url}
    }
    if (target.type === 'compare') {
        const cmp = await json(`${R}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}?per_page=100`)
        let files = cmp.files || []
        // compare lists up to 300 files per page; fetch the rest
        for (let page = 2; files.length === (page - 1) * 300 && page < 12; page++) {
            const more = await json(`${R}/compare/${encodeURIComponent(target.base)}...${encodeURIComponent(target.head)}?per_page=100&page=${page}`)
            if (!more.files?.length) break
            files = files.concat(more.files)
        }
        const commits = cmp.commits || []
        return {
            owner, repo, commits,
            title: `${target.base}...${target.head}`,
            htmlUrl: cmp.html_url,
            baseSha: cmp.merge_base_commit?.sha || cmp.base_commit?.sha,
            headSha: commits.length ? commits[commits.length - 1].sha : target.head,
            files: mapFiles(files),
        }
    }
    throw new Error('Unknown target')
}

/** Changed files of one commit, or of a range `[first, last]` (from first's parent), for the Log's file tree. */
const filesCache = new Map()
export function getCommitFiles(owner, repo, first, last, parentOfFirst) {
    const key = `${owner}/${repo}/${first}..${last}`
    if (!filesCache.has(key)) {
        const p = first === last
            ? loadCommit(owner, repo, first).then((c) => c.files)
            : json(`/repos/${owner}/${repo}/compare/${parentOfFirst || first + '^'}...${last}?per_page=100`).then((c) => mapFiles(c.files || []))
        filesCache.set(key, p)
        p.catch(() => filesCache.delete(key))
    }
    return filesCache.get(key)
}

async function loadCommit(owner, repo, sha) {
    const R = `/repos/${owner}/${repo}`
    const first = await json(`${R}/commits/${sha}?per_page=100`)
    let files = first.files || []
    for (let page = 2; files.length === (page - 1) * 300 && page < 12; page++) {
        const more = await json(`${R}/commits/${sha}?per_page=100&page=${page}`)
        if (!more.files?.length) break
        files = files.concat(more.files)
    }
    return {
        commitInfo: {sha: first.sha, message: first.commit.message, author: first.commit.author, html_url: first.html_url},
        baseSha: first.parents?.[0]?.sha || null,
        headSha: first.sha,
        files: mapFiles(files),
    }
}

// --- file contents ---

const memCache = new Map()
const CACHE_NAME = 'prv-contents-v1'

function looksBinary(bytes) {
    const n = Math.min(bytes.length, 8000)
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
    return false
}

/**
 * The content of `path` at `ref`: `{text}` or `{binary: true, blob}`. Contents at a commit sha never change, so
 * they are cached in memory and, where the browser allows, in Cache Storage (fast reopening on a phone).
 */
export function getFileContent(owner, repo, ref, path) {
    const url = `${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
    if (memCache.has(url)) return memCache.get(url)
    const p = (async () => {
        const immutable = /^[0-9a-f]{40}$/.test(ref)
        let buf
        let cache
        if (immutable) {
            try {
                cache = await caches.open(CACHE_NAME)
                const hit = await cache.match(url)
                if (hit) buf = await hit.arrayBuffer()
            } catch { cache = undefined }
        }
        if (!buf) {
            const res = await request(url, {accept: 'application/vnd.github.raw+json'})
            buf = await res.arrayBuffer()
            if (cache) cache.put(url, new Response(buf.slice(0), {headers: {'Content-Type': 'application/octet-stream'}})).catch(() => {})
        }
        const bytes = new Uint8Array(buf)
        if (looksBinary(bytes)) return {binary: true, size: bytes.length, blob: new Blob([bytes])}
        return {text: new TextDecoder('utf-8').decode(bytes), size: bytes.length}
    })()
    memCache.set(url, p)
    p.catch(() => memCache.delete(url))
    return p
}

// --- pull request lists (landing page) ---

export async function searchMyPullRequests() {
    const q = encodeURIComponent('is:pr is:open involves:@me archived:false')
    const res = await json(`/search/issues?q=${q}&sort=updated&order=desc&per_page=30`)
    return res.items.map((it) => {
        const [, owner, repo] = it.repository_url.match(/repos\/([^/]+)\/([^/]+)$/) || []
        return {owner, repo, number: it.number, title: it.title, updated: it.updated_at, user: it.user?.login, draft: it.draft}
    })
}

/** A repository's pull requests (search API: has comment counts and drafts). state: open | closed | merged | all. */
export async function listPullRequests(owner, repo, {state = 'open', text = ''} = {}) {
    if (SNAP && text.trim()) {
        // a snapshot has the lists, not every search: filter one by the words
        const words = text.toLowerCase().split(/\s+/).filter(Boolean)
        return (await listPullRequests(owner, repo, {state})).filter((p) => words.every((w) => `${p.title} #${p.number} ${p.user}`.toLowerCase().includes(w)))
    }
    const parts = [`repo:${owner}/${repo}`, 'is:pr']
    if (state === 'open') parts.push('is:open')
    else if (state === 'closed') parts.push('is:closed', 'is:unmerged')
    else if (state === 'merged') parts.push('is:merged')
    if (text.trim()) parts.push(text.trim())
    const res = await json(`/search/issues?q=${encodeURIComponent(parts.join(' '))}&sort=created&order=desc&per_page=50`)
    return res.items.map((it) => ({
        number: it.number, title: it.title, user: it.user?.login, created: it.created_at, comments: it.comments,
        draft: it.draft, state: it.pull_request?.merged_at ? 'merged' : it.state,
    }))
}

export async function getViewer() {
    return json('/user')
}

// --- "Viewed" state (GraphQL; needs a token) ---

async function graphql(query, variables) {
    const res = await request(`${API}/graphql`, {method: 'POST', body: {query, variables}})
    const data = await res.json()
    if (data.errors?.length) throw new GitHubError(data.errors.map((e) => e.message).join('; '), 200)
    if (!data.data) throw new GitHubError(data.message || 'GraphQL request failed', 200)
    return data.data
}

/** Map of path -> 'VIEWED' | 'UNVIEWED' | 'DISMISSED' for a PR, plus the PR's node id. */
export async function getViewedStates(owner, repo, number) {
    const states = new Map()
    let after = null
    let id
    for (let i = 0; i < 40; i++) {
        const d = await graphql(`query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){id files(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{path viewerViewedState}}}}}`,
            {o: owner, r: repo, n: number, after})
        const pr = d.repository.pullRequest
        id = pr.id
        for (const f of pr.files.nodes) states.set(f.path, f.viewerViewedState)
        if (!pr.files.pageInfo.hasNextPage) break
        after = pr.files.pageInfo.endCursor
    }
    return {id, states}
}

export async function setFileViewed(prNodeId, path, viewed) {
    const name = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
    await graphql(`mutation($id:ID!,$p:String!){${name}(input:{pullRequestId:$id,path:$p}){clientMutationId}}`, {id: prNodeId, p: path})
}

// --- commit edits to the PR's branch (Git Data API; the token needs Contents: write on the head repository) ---

const refPath = (branch) => `heads/${branch.split('/').map(encodeURIComponent).join('/')}`

function canWrite() {
    if (SNAP) throw new GitHubError('This is a snapshot: open the page without ?snap= and with a token to commit', 400)
    if (!getToken()) throw new GitHubError('Committing needs a GitHub token', 401)
}

/** The branch's head, refusing when it is not `expected` (the edits were made on that commit's files). */
async function leasedHead(owner, repo, branch, expected) {
    const head = (await json(`/repos/${owner}/${repo}/git/ref/${refPath(branch)}`)).object.sha
    if (head !== expected)
        throw new GitHubError(`The branch has new commits (${head.slice(0, 7)}) since this page loaded: reload first`, 409)
    return head
}

/**
 * Commits `files` ([{path, text}]) as one commit on `branch` of `owner/repo`, on top of `expectedHead` (refused if
 * the branch has moved since). With `amend`, replaces the head commit instead (same parents and author, a force
 * update). Returns {sha, previous}.
 */
export async function commitFiles({owner, repo, branch, expectedHead, files, message, amend = false, author = null, committer = null}) {
    canWrite()
    const R = `/repos/${owner}/${repo}/git`
    const head = await leasedHead(owner, repo, branch, expectedHead)
    const headCommit = await json(`${R}/commits/${head}`)
    let treeSha = headCommit.tree.sha
    if (files.length) {
        // keep each file's mode (an executable script stays one)
        const modes = new Map()
        try {
            const t = await json(`${R}/trees/${treeSha}?recursive=1`)
            for (const e of t.tree) if (e.type === 'blob') modes.set(e.path, e.mode)
        } catch { /* default mode */ }
        treeSha = (await json(`${R}/trees`, {method: 'POST', body: {
            base_tree: treeSha,
            tree: files.map((f) => ({path: f.path, mode: modes.get(f.path) || '100644', type: 'blob', content: f.text})),
        }})).sha
    }
    // author / committer ({name, email}): unset, GitHub uses the token's account; Amend keeps the commit's author
    const body = amend
        ? {message, tree: treeSha, parents: headCommit.parents.map((p) => p.sha), author: author || headCommit.author}
        : {message, tree: treeSha, parents: [head], ...(author && {author})}
    if (committer) body.committer = committer
    const commit = await json(`${R}/commits`, {method: 'POST', body})
    await json(`${R}/refs/${refPath(branch)}`, {method: 'PATCH', body: {sha: commit.sha, force: amend}})
    return {sha: commit.sha, previous: head}
}

/** Moves `branch` back to `sha` (undo of a commit made here), if it is still at `expected`. */
export async function moveBranch({owner, repo, branch, sha, expected}) {
    canWrite()
    await leasedHead(owner, repo, branch, expected)
    await json(`/repos/${owner}/${repo}/git/refs/${refPath(branch)}`, {method: 'PATCH', body: {sha, force: true}})
}

export async function getPullHead(owner, repo, number) {
    return (await json(`/repos/${owner}/${repo}/pulls/${number}`)).head.sha
}

/** The PR's conversation: comments, reviews and their inline comments (bodies with GitHub's HTML). */
export async function getTimeline(owner, repo, number) {
    const R = `/repos/${owner}/${repo}`
    const [comments, reviews, inline] = await Promise.all([
        paginate(`${R}/issues/${number}/comments`, (x) => x, 5, {accept: FULL}),
        paginate(`${R}/pulls/${number}/reviews`, (x) => x, 5, {accept: FULL}),
        paginate(`${R}/pulls/${number}/comments`, (x) => x, 5, {accept: FULL}).catch(() => []),
    ])
    return {comments, reviews, inline}
}
