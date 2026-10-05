#!/usr/bin/env node
// e2e snapshot baselines in R2: content-addressed blobs + a manifest committed in the repo.
//
//   node scripts/snapshots-r2.mjs status [env…]   what differs between tests/snapshots/<env>/ and its manifest
//   node scripts/snapshots-r2.mjs push   [env…]   hash the folder, upload blobs that are not in the bucket yet,
//                                                 write tests/snapshots.<env>.json        (needs the S3 key)
//   node scripts/snapshots-r2.mjs sync   [env…]   download what the manifest names into the folder, over the
//                                                 public domain, no credentials  (--prune also deletes local
//                                                 files the manifest does not name)
//
// <env> is a folder name under tests/snapshots/ (Playwright's `<project>-<platform>`, e.g. chromium-linux);
// default: every folder there (status/push) or every manifest (sync).
//
// Layout in the bucket: blobs/<sha256><ext>. Identical files across envs and versions are stored once, and a
// baseline update is a manifest diff in the PR. Nothing is ever deleted from the bucket by this script.
//
// Credentials for push: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY from the environment or
// from <repo>/.env.snapshots-r2 (--env <file>), as written by scripts/snapshots-r2-init.mjs.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const PUBLIC_BASE = 'https://e2e-snapshots.threepipe.org'
const SKIP = /(-actual\.[a-z0-9]+|timeout-state\.png|\.DS_Store)$/ // test-run leftovers, never baselines
const CONCURRENCY = 8

const root = path.join(import.meta.dirname, '..')
const snapshotsDir = path.join(root, 'tests', 'snapshots')
const manifestPath = (env) => path.join(root, 'tests', `snapshots.${env}.json`)

const args = process.argv.slice(2)
const command = args.shift()
const prune = args.includes('--prune')
const envFileArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : null
const envs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--env')
if (!['status', 'push', 'sync'].includes(command)) usage()

const targets = envs.length ? envs : command === 'sync' ? listManifests() : listFolders()
if (!targets.length) usage(`nothing to do: no folders in ${snapshotsDir} and no manifests`)

let problems = 0
for (const env of targets) await ({status, push, sync})[command](env)
process.exit(problems ? 1 : 0)

// ─── commands ───────────────────────────────────────────────────────────────

async function status(env) {
    const local = hashFolder(env)
    const manifest = readManifest(env)
    const {added, changed, removed, same} = compare(local, manifest?.files || {})
    console.log(`${env}: ${same} same, ${added.length} new, ${changed.length} changed, ${removed.length} only in manifest${manifest ? '' : ' (no manifest yet)'}`)
    for (const f of [...added, ...changed].slice(0, 40)) console.log(`  ${changed.includes(f) ? '~' : '+'} ${f}`)
    for (const f of removed.slice(0, 40)) console.log(`  - ${f}`)
    if (added.length + changed.length + removed.length > 80) console.log('  …')
}

async function push(env) {
    const creds = readCreds()
    const local = hashFolder(env)
    if (!Object.keys(local).length) return console.log(`${env}: folder is empty, nothing pushed`)
    const existing = readManifest(env)?.files || {}
    const {added, changed, removed} = compare(local, existing)

    // upload blobs the bucket does not have yet (dedup by hash across envs and versions)
    const hashes = [...new Set(Object.values(local))]
    let uploaded = 0, skipped = 0
    await parallel(hashes, async(hash) => {
        const rel = Object.keys(local).find(f => local[f] === hash)
        const key = blobKey(rel, hash)
        // existence check goes through the S3 API, not the public domain: the edge caches a public 404 for hours
        if ((await s3(creds, 'HEAD', key)).status === 200) { skipped++; return }
        const body = fs.readFileSync(path.join(snapshotsDir, env, rel))
        const res = await s3(creds, 'PUT', key, body, contentType(rel))
        if (res.status !== 200) throw new Error(`upload ${key} failed: HTTP ${res.status} ${await res.text()}`)
        uploaded++
    })

    const manifest = {bucket: creds.R2_BUCKET, publicBase: PUBLIC_BASE, generated: new Date().toISOString(), files: sortKeys(local)}
    fs.writeFileSync(manifestPath(env), JSON.stringify(manifest, null, 1) + '\n')
    console.log(`${env}: ${hashes.length} blobs (${uploaded} uploaded, ${skipped} already there); manifest ${path.relative(root, manifestPath(env))}: +${added.length} ~${changed.length} -${removed.length}`)
}

async function sync(env) {
    const manifest = readManifest(env)
    if (!manifest) { problems++; return console.log(`${env}: no manifest at ${manifestPath(env)}`) }
    const local = hashFolder(env)
    const files = Object.entries(manifest.files)
    let downloaded = 0, failed = 0
    await parallel(files, async([rel, hash]) => {
        if (local[rel] === hash) return
        const url = `${manifest.publicBase || PUBLIC_BASE}/${blobKey(rel, hash)}`
        let res = await fetch(url)
        if (res.status === 404) res = await fetch(`${url}?t=${Date.now()}`) // a 404 cached at the edge before the blob was uploaded
        if (!res.ok) { failed++; console.log(`  FAIL ${rel}: HTTP ${res.status}`); return }
        const buf = Buffer.from(await res.arrayBuffer())
        if (sha256(buf) !== hash) { failed++; console.log(`  FAIL ${rel}: hash mismatch after download`); return }
        const file = path.join(snapshotsDir, env, rel)
        fs.mkdirSync(path.dirname(file), {recursive: true})
        fs.writeFileSync(file, buf)
        downloaded++
    })
    let pruned = 0
    if (prune) for (const rel of Object.keys(local)) if (!(rel in manifest.files)) { fs.rmSync(path.join(snapshotsDir, env, rel)); pruned++ }
    if (failed) problems++
    console.log(`${env}: ${files.length} files in manifest, ${downloaded} downloaded, ${files.length - downloaded - failed} already current, ${failed} failed${prune ? `, ${pruned} pruned` : ''}`)
}

// ─── helpers ────────────────────────────────────────────────────────────────

function usage(msg) {
    if (msg) console.error(msg)
    console.error('usage: node scripts/snapshots-r2.mjs status|push|sync [env…] [--prune] [--env <creds file>]')
    process.exit(2)
}
function listFolders() {
    if (!fs.existsSync(snapshotsDir)) return []
    return fs.readdirSync(snapshotsDir, {withFileTypes: true}).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
}
function listManifests() {
    return fs.readdirSync(path.join(root, 'tests')).map(f => f.match(/^snapshots\.(.+)\.json$/)?.[1]).filter(Boolean)
}
function readManifest(env) {
    return fs.existsSync(manifestPath(env)) ? JSON.parse(fs.readFileSync(manifestPath(env), 'utf8')) : null
}
// {relative path: sha256} for every baseline file in tests/snapshots/<env>/
function hashFolder(env) {
    const dir = path.join(snapshotsDir, env)
    const out = {}
    if (!fs.existsSync(dir)) return out
    for (const file of fs.readdirSync(dir, {recursive: true, withFileTypes: true})) {
        if (!file.isFile()) continue
        const abs = path.join(file.parentPath ?? file.path, file.name)
        const rel = path.relative(dir, abs).split(path.sep).join('/')
        if (SKIP.test(rel) || rel.startsWith('.git/')) continue
        out[rel] = sha256(fs.readFileSync(abs))
    }
    return out
}
function compare(local, manifest) {
    const added = [], changed = [], removed = []
    let same = 0
    for (const f of Object.keys(local)) {
        if (!(f in manifest)) added.push(f)
        else if (manifest[f] !== local[f]) changed.push(f)
        else same++
    }
    for (const f of Object.keys(manifest)) if (!(f in local)) removed.push(f)
    return {added, changed, removed, same}
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
function blobKey(rel, hash) { return `blobs/${hash}${path.extname(rel).toLowerCase()}` }
function sortKeys(o) { return Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]])) }
function contentType(rel) {
    const t = {'.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.exr': 'image/x-exr', '.glb': 'model/gltf-binary', '.json': 'application/json', '.log': 'text/plain', '.zip': 'application/zip'}
    return t[path.extname(rel).toLowerCase()] || 'application/octet-stream'
}
async function parallel(items, fn) {
    let i = 0
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, items.length)}, async() => {
        while (i < items.length) await fn(items[i++])
    }))
}
function readCreds() {
    const file = envFileArg || path.join(root, '.env.snapshots-r2')
    const fromFile = {}
    if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m) fromFile[m[1]] = m[2]
    }
    const creds = {}
    for (const k of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        creds[k] = process.env[k] || fromFile[k]
        if (!creds[k]) usage(`missing ${k}: set it in the environment or in ${file} (scripts/snapshots-r2-init.mjs writes that file)`)
    }
    return creds
}
// One S3 request to the bucket, signed with SigV4 (region "auto", as R2 wants).
async function s3(creds, method, key, body = null, type = 'application/octet-stream') {
    const host = new URL(creds.R2_ENDPOINT).host
    const uri = `/${creds.R2_BUCKET}/${key}`
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d+/g, '')
    const day = amzDate.slice(0, 8)
    const scope = `${day}/auto/s3/aws4_request`
    const payloadHash = sha256(body || '')
    const headers = {host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(body ? {'content-type': type} : {})}
    const signedHeaders = Object.keys(headers).sort()
    const canonical = [method, uri, '', ...signedHeaders.map(h => `${h}:${headers[h]}`), '', signedHeaders.join(';'), payloadHash].join('\n')
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
    const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest()
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + creds.R2_SECRET_ACCESS_KEY, day), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex')
    const {host: _h, ...sendHeaders} = headers
    return fetch(`https://${host}${uri}`, {method, body, headers: {...sendHeaders,
        Authorization: `AWS4-HMAC-SHA256 Credential=${creds.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`}})
}
