// Records the GitHub API responses the viewer needs for one PR into snap/<name>/, so `?snap=<name>&pr=…` works
// with no token (e.g. to try the page on a phone). It loads the page in Playwright, sends its api.github.com requests
// through curl (with GITHUB_TOKEN if set), and asks the page's own github.js for the PR, every commit of it, the file
// contents of each, the PR lists and the PR's conversation.
//
//   node tools/record-snapshot.cjs http://localhost:8000/pr-viewer/ owner/repo/123 [name]
//   node tools/record-snapshot.cjs http://localhost:8000/pr-viewer/ --repos owner/a,owner/b [name]
//     (every open PR of each repository, with each commit: what Download for offline fetches; the page then offers
//     "Download everything" for the snapshot, so a device without a token can save it all for offline)
//
// A snapshot of a private repository holds its code: do not commit or publish it (snap/ is git-ignored).

const {chromium} = require('playwright')
const {execFile} = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

;(async () => {
    const [, , pageUrl, pr] = process.argv
    const name = (pr === '--repos' ? process.argv[5] : process.argv[4]) || 'demo'
    if (!pageUrl || !pr) throw new Error('usage: record-snapshot.cjs <page url> <owner/repo/number> [name]')
    const out = path.join(__dirname, '..', 'snap', name)
    fs.mkdirSync(out, {recursive: true})
    const index = {}
    const browser = await chromium.launch()
    const ctx = await browser.newContext({serviceWorkers: 'block'})
    await ctx.route('https://api.github.com/**', async (route) => {
        const req = route.request()
        const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
        if (req.method() === 'OPTIONS') return route.fulfill({status: 204, headers: cors})
        if (req.method() !== 'GET') return route.fulfill({status: 403, headers: cors, body: '{}'})
        const u0 = new URL(req.url())
        const seen = index[u0.pathname + u0.search]
        // a URL asked again (a commit's PR, a list) is answered from what was recorded
        if (seen && seen.status === 200) return route.fulfill({status: 200, body: fs.readFileSync(path.join(out, seen.file)), headers: {...cors, 'content-type': seen.type}})
        const args = ['-s', '-i', '--retry', '3', '-H', 'Accept: ' + (req.headers()['accept'] || 'application/json'), req.url()]
        if (process.env.GITHUB_TOKEN) args.push('-H', 'Authorization: Bearer ' + process.env.GITHUB_TOKEN)
        // in parallel (the page asks several at once)
        let rest = await new Promise((resolve, reject) => execFile('curl', args, {maxBuffer: 1 << 28, encoding: 'buffer'}, (e, out) => e ? reject(e) : resolve(out)))
        let head = ''
        // skip a proxy's "Connection established" block and any 1xx
        while (rest.slice(0, 5).toString() === 'HTTP/') {
            const i = rest.indexOf('\r\n\r\n')
            head = rest.slice(0, i).toString()
            rest = rest.slice(i + 4)
        }
        const status = +head.split(' ')[1]
        const type = (head.match(/^content-type: (.*)$/im) || [])[1]?.trim() || 'application/octet-stream'
        const u = new URL(req.url())
        const file = crypto.createHash('sha1').update(u.pathname + u.search).digest('hex').slice(0, 16)
        fs.writeFileSync(path.join(out, file), rest)
        index[u.pathname + u.search] = {file, status, type}
        route.fulfill({status, body: rest, headers: {...cors, 'content-type': type}})
    })
    const page = await ctx.newPage()
    await page.goto(pageUrl)
    if (pr === '--repos') {
        const repos = process.argv[4].split(',')
        const summary = []
        for (const full of repos) {
            const [owner, repo] = full.split('/')
            const r = await page.evaluate(async ([owner, repo]) => {
                const off = await import('./js/offline.js')
                const t0 = Date.now()
                const res = await off.downloadRepo(owner, repo, {commits: true})
                const saved = off.offlineRepos().find((x) => x.owner === owner && x.repo === repo)
                return {owner, repo, prs: saved?.prs || [], failed: res.failed, s: Math.round((Date.now() - t0) / 1000)}
            }, [owner, repo])
            console.log(`${full}: ${r.prs.length} PRs, ${r.failed} failed, ${r.s}s`)
            summary.push({owner: r.owner, repo: r.repo, prs: r.prs})
        }
        fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index))
        fs.writeFileSync(path.join(out, 'repos.json'), JSON.stringify(summary))
        console.log(`${name}: ${Object.keys(index).length} responses in ${out}`)
        await browser.close()
        return
    }
    const summary = await page.evaluate(async (pr) => {
        const gh = await import('./js/github.js')
        const [owner, repo, number] = pr.split('/')
        const target = {type: 'pr', owner, repo, number: +number}
        const contents = (cs) => Promise.all(cs.files.flatMap((f) => [
            f.status !== 'added' && cs.baseSha && gh.getFileContent(owner, repo, cs.baseSha, f.prevPath || f.path).catch(() => null),
            f.status !== 'removed' && gh.getFileContent(owner, repo, cs.headSha, f.path).catch(() => null),
        ]))
        const cs = await gh.loadChangeSet(target)
        await contents(cs)
        for (const c of cs.commits) {
            const ccs = await gh.loadChangeSet({...target, commit: c.sha}).catch(() => null)
            if (ccs) await contents(ccs)
        }
        for (const state of ['open', 'closed', 'merged', 'all']) await gh.listPullRequests(owner, repo, {state}).catch(() => null)
        await gh.getTimeline(owner, repo, +number).catch(() => null)
        return {files: cs.files.length, commits: cs.commits.length}
    }, pr)
    fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1))
    console.log(`${name}: ${Object.keys(index).length} responses (${summary.files} files, ${summary.commits} commits) in ${out}`)
    await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
