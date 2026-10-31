// Uploads files to threepipe cloud (services/cloud): a build of the examples for a pull request, a share, a page, a
// drive folder, or (staff) sample assets and e2e snapshot blobs.
//
//   npm run cloud:upload -- <local file or folder> <remote path>   one file to that path, or a folder under it (path ends with /)
//   npm run cloud:upload-preview -- <pr-123 or commit sha>       uploads what `npm run build:all` built (dist/, examples/,
//                                                                plugins/*/dist/) to b/threepipe/<ref>/ and prints the link
//
// Remote paths: s/<slug>/…  p/<name>/…  b/<repo>/<ref>/…  a/<name>                  (PUT /api/v1/uploads/…)
//               drive:/<folder>/   the file or folder becomes one private item there  (/api/v1/drive/items)
//               samples/<path>  e2e/blobs/<sha256><ext>                              (staff, PUT /api/v1/buckets/…)
// Options: --ttl <days> (s/, default 7), --dry-run, --concurrency <n> (default 6)
//
// The key: TP_CLOUD_KEY from the environment or /tmp/.env. Get one from an access link (signed in at
// https://cloud.threepipe.org, see services/cloud/README.md). The API: TP_CLOUD_API, default https://cloud.threepipe.org.
//
// Never uploaded: dotfiles and dot folders (.git, .env), node_modules, and, for a folder git tracks, what .gitignore
// excludes (a folder that is itself ignored, like a build output, is uploaded as it is). A build (--preview) uploads
// all of its files, gitignored outputs too (examples/*/script.js); its examples/globals.js gets empty values.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const positional = args.filter((a, i) => !a.startsWith('--') && !['--ttl', '--concurrency'].includes(args[i - 1]))
const dryRun = flag('--dry-run')
const concurrency = Number(option('--concurrency', 6))
const ttl = option('--ttl')

const env = readEnv()
const api = (env.TP_CLOUD_API || 'https://cloud.threepipe.org').replace(/\/+$/, '')
const key = env.TP_CLOUD_KEY

let files // [{local, remote, content?}]
let drive // drive:/<folder>: {folder, name}, and the item's id once made
if (flag('--preview')) {
    const ref = positional[0]
    if (!ref || !/^[\w.-]+$/.test(ref)) usage('give the pull request (pr-123) or the commit sha')
    files = buildFiles(`b/threepipe/${ref}/`)
} else {
    const [local, remote] = positional
    if (!local || !remote) usage()
    if (remote.startsWith('drive:')) {
        // the item's files are its relative paths (a file: its name)
        drive = {folder: remote.slice('drive:'.length), name: path.basename(path.resolve(local))}
        files = listFiles(path.resolve(local), '/').map(f => ({...f, remote: f.remote.slice(1)}))
    } else files = listFiles(path.resolve(local), remote)
}
if (!files.length) usage('no files to upload')
if (!key && !dryRun) usage('TP_CLOUD_KEY is not set (environment or /tmp/.env)')

const total = files.reduce((n, f) => n + size(f), 0)
console.log(`${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB → ${api}`)
if (dryRun) {
    for (const f of files.slice(0, 20)) console.log(`  ${f.remote}`)
    if (files.length > 20) console.log(`  … ${files.length - 20} more`)
    process.exit(0)
}

if (drive) {
    const at = await call('GET', `/api/v1/drive/resolve?path=${encodeURIComponent(drive.folder)}`)
    if (!at.folder) usage(`${drive.folder} is not a folder in your drive`)
    drive.id = (await call('POST', '/api/v1/drive/items', {name: drive.name, folder: at.folder.id})).id
}

let done = 0, failed = 0, base = ''
await parallel(files, async f => {
    try {
        const res = await upload(f)
        if (!base && res.url) base = res.url.slice(0, res.url.length - res.path.length) // the files host
        if (++done % 100 === 0) console.log(`  ${done} / ${files.length}`)
    } catch (e) {
        failed++
        console.log(`  FAIL ${f.remote}: ${e.message}`)
    }
})
console.log(`${done} uploaded, ${failed} failed`)
if (drive) console.log(`\nThe item: ${api}/drive (${drive.folder}, ${drive.name}; private until you share it)`)
if (flag('--preview') && !failed) {
    console.log(`\nExamples of this build: ${base}${files[0].remote.split('/').slice(0, 3).join('/')}/examples/index.html`)
}
process.exit(failed ? 1 : 0)

// ─── helpers ────────────────────────────────────────────────────────────────

/** The core and plugin bundles and the examples, as `npm run serve` serves them (the examples import ../../dist/…). */
function buildFiles(prefix) {
    const dirs = ['dist', 'examples', ...fs.readdirSync(path.join(root, 'plugins')).map(p => `plugins/${p}/dist`)]
        .filter(d => fs.existsSync(path.join(root, d)))
    if (!fs.existsSync(path.join(root, 'dist/index.mjs')) || !fs.existsSync(path.join(root, 'examples/globals.js')))
        usage('build first: npm run build:all')
    // a build: everything in it, also what .gitignore excludes (examples/*/script.js are build outputs)
    const out = dirs.flatMap(d => listFiles(path.join(root, d), `${prefix}${d}/`, {gitignore: false}))
    const globals = out.find(f => f.remote === `${prefix}examples/globals.js`)
    if (globals) globals.content = Buffer.from(fs.readFileSync(globals.local, 'utf8')
        .replace(/^export const (\w+) = .*$/gm, (_, k) => `export const ${k} = ${JSON.stringify(k === 'DUMMY' ? '1' : '')}`))
    return out
}

/**
 * A file to `remote`, or every file of a folder under `remote` (which then ends with /), without what is never uploaded:
 * dotfiles, node_modules and, unless `gitignore: false` (a build), what .gitignore excludes.
 */
function listFiles(local, remote, {gitignore = true} = {}) {
    if (!fs.existsSync(local)) usage(`${local} does not exist`)
    if (fs.statSync(local).isFile()) return [{local, remote: remote.endsWith('/') ? remote + path.basename(local) : remote}]
    if (!remote.endsWith('/')) usage('a folder goes under a remote path ending with /')
    const ignored = gitignore ? gitIgnored(local) : new Set()
    return fs.readdirSync(local, {recursive: true}).map(String)
        .filter(rel => !rel.split(path.sep).some(s => s.startsWith('.') || s === 'node_modules'))
        .filter(rel => !ignored.has(rel.split(path.sep).join('/')) && fs.statSync(path.join(local, rel)).isFile())
        .sort()
        .map(rel => ({local: path.join(local, rel), remote: remote + rel.split(path.sep).join('/')}))
}

/** The files under `dir` that .gitignore excludes, relative to it; none when git does not track `dir` or ignores it as a whole. */
function gitIgnored(dir) {
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
    try {
        git('rev-parse', '--is-inside-work-tree')
    } catch { return new Set() }
    try {
        git('check-ignore', '-q', '.')
        return new Set() // the folder itself is ignored (a build output): upload all of it
    } catch { /* not ignored: exit code 1 */ }
    return new Set(git('ls-files', '--others', '--ignored', '--exclude-standard', '-z', '.').split('\0').filter(Boolean))
}

async function upload(f) {
    const body = f.content ?? fs.readFileSync(f.local)
    const staff = /^(samples|e2e)\//.test(f.remote)
    const remote = f.remote.split('/').map(encodeURIComponent).join('/')
    const url = drive ? `${api}/api/v1/drive/items/${drive.id}/${remote}`
        : `${api}/api/v1/${staff ? 'buckets' : 'uploads'}/${remote}${ttl && f.remote.startsWith('s/') ? `?ttl=${ttl}` : ''}`
    const headers = {authorization: `Bearer ${key}`}
    if (staff || f.remote.startsWith('a/')) headers['x-content-sha256'] = crypto.createHash('sha256').update(body).digest('hex')
    for (let attempt = 0; ; attempt++) {
        let res
        try {
            res = await fetch(url, {method: 'PUT', headers, body})
        } catch (e) {
            if (attempt < 2) continue
            throw e
        }
        if (res.ok) return res.json()
        if (res.status >= 500 && attempt < 2) continue
        const text = await res.text()
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
    }
}

/** One JSON call to the API with the key. */
async function call(method, route, body) {
    const res = await fetch(api + route, {method, headers: {authorization: `Bearer ${key}`, ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined})
    if (!res.ok) usage(`${method} ${route}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json()
}

function size(f) {
    return f.content ? f.content.length : fs.statSync(f.local).size
}

async function parallel(items, fn) {
    let i = 0
    await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async() => {
        while (i < items.length) await fn(items[i++])
    }))
}

/** TP_CLOUD_* from the environment, else from /tmp/.env (where the access link's agents.md says to save the key). */
function readEnv() {
    const out = {TP_CLOUD_KEY: process.env.TP_CLOUD_KEY, TP_CLOUD_API: process.env.TP_CLOUD_API}
    if (fs.existsSync('/tmp/.env')) {
        for (const line of fs.readFileSync('/tmp/.env', 'utf8').split('\n')) {
            const m = line.match(/^\s*(TP_CLOUD_\w+)\s*=\s*(.*?)\s*$/)
            if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
        }
    }
    return out
}

function usage(message) {
    if (message) console.error(message + '\n')
    console.error(fs.readFileSync(import.meta.filename, 'utf8').split('\n').filter(l => l.startsWith('//')).slice(0, 14).map(l => l.slice(3)).join('\n'))
    process.exit(1)
}
