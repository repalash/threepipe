#!/usr/bin/env node
// R2 bucket + public domain + bucket-scoped S3 key for the e2e snapshot baselines.
//
//   node scripts/snapshots-r2-init.mjs            check, change nothing   [default]
//   node scripts/snapshots-r2-init.mjs --apply    create what is missing
//
// Idempotent: probes first, creates only what is absent.
//   1. bucket `threepipe-e2e-snapshots`
//   2. public read at https://e2e-snapshots.threepipe.org (R2 custom domain on the threepipe.org zone), so CI and
//      contributors fetch baselines with no credentials
//   3. an API token scoped to this bucket only (Object Read & Write). That token IS an S3 credential:
//      Access Key ID = token id, Secret Access Key = sha256(token value)
//      (developers.cloudflare.com/r2/api/tokens — "Get S3 API credentials from an API token")
//   4. a signed ListObjects with the new key, to prove endpoint + bucket + key + secret
//
// Needs a short-lived setup token (CLOUDFLARE_API_TOKEN, or R2_INIT_TOKEN in ../.env.threepipe) with
//   Account > Workers R2 Storage > Edit,  Account > Account API Tokens > Edit,
//   Zone > Zone > Read,  Zone > DNS > Edit   (zone resources: threepipe.org)
// and the account id in CLOUDFLARE_ACCOUNT_ID (or in the same .env file).
//
// The S3 secret is written once to a 0600 file (--out, default <repo>/.env.snapshots-r2, gitignored) and never
// printed. Lose the file: delete the token in the dashboard and run --apply again.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BUCKET = 'threepipe-e2e-snapshots'
const DOMAIN = 'e2e-snapshots.threepipe.org'
const ZONE = 'threepipe.org'
const TOKEN_NAME = `snapshots-r2-${BUCKET}`
const PERM_GROUP = 'Workers R2 Storage Bucket Item Write' // = Object Read & Write, per bucket

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(import.meta.dirname, '..', '.env.snapshots-r2')

const envFile = readEnv(path.join(import.meta.dirname, '..', '.env.threepipe'))
const unset = (v) => !v || /^(REPLACE_ME|<.*>)$/.test(v) // placeholders from .env.threepipe count as missing
const token = [process.env.CLOUDFLARE_API_TOKEN, envFile.R2_INIT_TOKEN].find(v => !unset(v))
const account = [process.env.CLOUDFLARE_ACCOUNT_ID, envFile.CLOUDFLARE_ACCOUNT_ID].find(v => !unset(v))
if (!token) fail('no setup token: set CLOUDFLARE_API_TOKEN or R2_INIT_TOKEN in .env.threepipe')
if (!account) fail('no account id: set CLOUDFLARE_ACCOUNT_ID (env or .env.threepipe)')

let problems = 0
const ok = (msg) => console.log('  ok    ' + msg)
const bad = (msg) => { console.log('  FAIL  ' + msg); problems++ }

// Cloudflare API call. Returns {status, result, errors}.
async function cf(method, route, body) {
    const res = await fetch('https://api.cloudflare.com/client/v4' + route, {
        method,
        headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    return {status: res.status, result: json.result, errors: json.errors || []}
}
const errText = (r) => `HTTP ${r.status}: ${r.errors.map(e => e.message).join('; ') || 'no message'}`

console.log('1. setup token')
{
    const r = await cf('GET', `/accounts/${account}/tokens/verify`)
    if (r.result?.status === 'active') ok(`active on account ${account}`)
    else fail(`setup token rejected (${errText(r)})`)
}

console.log(`2. bucket ${BUCKET}`)
{
    const r = await cf('GET', `/accounts/${account}/r2/buckets/${BUCKET}`)
    if (r.status === 200) ok('exists')
    else if (r.status !== 404) bad(`cannot read bucket (${errText(r)}) — token needs Workers R2 Storage: Edit`)
    else if (!apply) bad('missing — run with --apply')
    else {
        const c = await cf('POST', `/accounts/${account}/r2/buckets`, {name: BUCKET})
        c.status === 200 ? ok('created') : bad(`create failed (${errText(c)})`)
    }
}

console.log(`3. public read at https://${DOMAIN}`)
{
    const r = await cf('GET', `/accounts/${account}/r2/buckets/${BUCKET}/domains/custom/${DOMAIN}`)
    if (r.status === 200) ok(`attached (${r.result?.status?.ownership || 'status unknown'}, ssl ${r.result?.status?.ssl || '?'})`)
    else if (r.status !== 404) bad(`cannot read custom domain (${errText(r)})`)
    else if (!apply) bad('not attached — run with --apply')
    else {
        const zones = await cf('GET', `/zones?name=${ZONE}`)
        const zone = (zones.result || [])[0]
        if (!zone) fail(`zone ${ZONE} not visible to this token (${errText(zones)}) — token needs Zone: Read on ${ZONE}`)
        const c = await cf('POST', `/accounts/${account}/r2/buckets/${BUCKET}/domains/custom`, {domain: DOMAIN, zoneId: zone.id, enabled: true, minTLS: '1.2'})
        c.status === 200 ? ok(`attached, DNS record created (${c.result?.status?.ownership || 'pending'}) — token needs DNS: Edit on ${ZONE} for this`) : bad(`attach failed (${errText(c)})`)
    }
}

console.log(`4. S3 key '${TOKEN_NAME}' (Object Read & Write, this bucket only)`)
let minted = false
{
    const list = await cf('GET', `/accounts/${account}/tokens?per_page=50`)
    const have = (list.result || []).filter(t => t.name === TOKEN_NAME)
    if (list.status !== 200) bad(`cannot list tokens (${errText(list)}) — token needs Account API Tokens: Edit`)
    else if (have.length) ok(`exists: ${have.map(t => `${t.id} ${t.status}`).join(', ')} (secret is in ${out} on the machine that minted it)`)
    else if (!apply) bad('missing — run with --apply')
    else {
        const groups = await cf('GET', `/accounts/${account}/tokens/permission_groups`)
        const group = (groups.result || []).find(g => g.name === PERM_GROUP)
        if (!group) fail(`permission group '${PERM_GROUP}' not found (${errText(groups)})`)
        const c = await cf('POST', `/accounts/${account}/tokens`, {
            name: TOKEN_NAME,
            policies: [{
                effect: 'allow',
                resources: {[`com.cloudflare.edge.r2.bucket.${account}_default_${BUCKET}`]: '*'},
                permission_groups: [{id: group.id}],
            }],
        })
        if (c.status !== 200) fail(`mint failed (${errText(c)})`)
        fs.mkdirSync(path.dirname(out), {recursive: true})
        fs.writeFileSync(out, [
            `R2_ENDPOINT=https://${account}.r2.cloudflarestorage.com`,
            `R2_BUCKET=${BUCKET}`,
            `R2_ACCESS_KEY_ID=${c.result.id}`,
            `R2_SECRET_ACCESS_KEY=${crypto.createHash('sha256').update(c.result.value).digest('hex')}`,
            '',
        ].join('\n'), {mode: 0o600})
        minted = true
        ok(`minted ${c.result.id} — credentials written to ${out} (0600, never printed)`)
    }
}

console.log('5. signed read with the key')
if (!fs.existsSync(out)) console.log(`  skip  no ${out} here`)
else {
    const env = readEnv(out)
    let status = 0
    for (let tries = 0; tries < 7; tries++) { // a new token takes a few seconds to propagate
        status = await s3List(env)
        if (status === 200 || !minted) break
        await new Promise(r => setTimeout(r, 5000))
    }
    status === 200 ? ok(`key lists ${env.R2_BUCKET}`) : bad(`key cannot list ${env.R2_BUCKET} (HTTP ${status})`)
}

console.log(problems ? `${problems} problem(s)` : 'done')
process.exit(problems ? 1 : 0)

// ─── helpers ────────────────────────────────────────────────────────────────

function fail(msg) { console.error('  FAIL  ' + msg); process.exit(1) }

function readEnv(file) {
    const env = {}
    if (!fs.existsSync(file)) return env
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
    return env
}

// GET /<bucket>/?list-type=2&max-keys=1 signed with SigV4 (region "auto"). Returns the HTTP status.
async function s3List(env) {
    const host = new URL(env.R2_ENDPOINT).host
    const query = 'list-type=2&max-keys=1'
    const amzDate = new Date().toISOString().replace(/[-:]|\.\d+/g, '')
    const day = amzDate.slice(0, 8)
    const scope = `${day}/auto/s3/aws4_request`
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
    const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest()
    const emptyHash = sha('')
    const canonical = ['GET', `/${env.R2_BUCKET}/`, query, `host:${host}`, `x-amz-content-sha256:${emptyHash}`, `x-amz-date:${amzDate}`, '', 'host;x-amz-content-sha256;x-amz-date', emptyHash].join('\n')
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n')
    const signingKey = hmac(hmac(hmac(hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, day), 'auto'), 's3'), 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex')
    const res = await fetch(`https://${host}/${env.R2_BUCKET}/?${query}`, {headers: {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': emptyHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    }}).catch(() => null)
    return res ? res.status : 0
}
