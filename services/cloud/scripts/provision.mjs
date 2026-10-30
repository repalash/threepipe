#!/usr/bin/env node
// Create what threepipe-cloud needs on Cloudflare, once; safe to re-run (CLOUDFLARE.md at the repository root).
//   npm run provision                check: print what exists and what is missing, change nothing   [default]
//   npm run provision -- --apply     create what is missing: the D1 database (its id goes into wrangler.toml), the
//                                    R2 bucket, then ask for each missing secret (wrangler secret put)
// Run from services/cloud after `npx wrangler login` (or with CLOUDFLARE_API_TOKEN set). The Turnstile widget is made
// in the dashboard (CLOUDFLARE.md); its secret is one of the secrets asked for here. Deploying is `npm run deploy`.
import {execFileSync, spawnSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const here = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOML = join(here, 'wrangler.toml')
const NAME = 'threepipe-cloud'
const SECRETS = [
    ['TURNSTILE_SECRET', 'the secret key of the Turnstile widget (dashboard > Turnstile)'],
    ['STAFF_TOKENS', "name=token,... for /staff; make tokens with: openssl rand -base64 32"],
    ['SHARE_TOKENS', "name=token,... for POST /share ('admin' may change any share)"],
]
const OPTIONAL = [['DISCORD_WEBHOOK', 'the webhook URL of the channel that gets a card per report']]
const apply = process.argv.includes('--apply')

const wrangler = (args, opts = {}) => execFileSync('wrangler', args, {cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts})
const tryWrangler = args => { try { return {ok: true, out: wrangler(args)} } catch (e) { return {ok: false, out: String(e.stdout ?? '') + String(e.stderr ?? '')} } }
const step = (ok, what) => console.log(`${ok ? '  ok     ' : '  MISSING'} ${what}`)

const toml = readFileSync(TOML, 'utf8')
const account = toml.match(/^account_id = "([^"]+)"/m)?.[1]
console.log(`threepipe-cloud on account ${account} (${apply ? 'apply' : 'check only; --apply to create what is missing'})`)

// 0. the login can reach the account
const who = tryWrangler(['whoami'])
if (!who.ok || !who.out.includes(account)) {
    console.error(`wrangler is not logged in to account ${account}. Run: npx wrangler login`)
    process.exit(1)
}
step(true, 'wrangler login has the account')

// 1. D1
let toml2 = toml
// --json output can follow a banner line; parse from the first '['
const json = out => JSON.parse(out.slice(out.indexOf('[')))
const findDb = () => json(wrangler(['d1', 'list', '--json'])).find(d => d.name === NAME)
let db = findDb()
if (!db && apply) { wrangler(['d1', 'create', NAME]); db = findDb() }
step(!!db, `D1 database ${NAME}${db ? ` (${db.uuid})` : ''}`)
if (db) {
    const set = toml2.replace(/^database_id = "[^"]*"/m, `database_id = "${db.uuid}"`)
    if (set !== toml2) {
        if (apply) { writeFileSync(TOML, set); toml2 = set; console.log(`           wrangler.toml database_id set to ${db.uuid} (commit it)`) }
        else console.log(`           wrangler.toml database_id is not ${db.uuid} yet (--apply sets it)`)
    }
}

// 2. R2 (private: no public access, no r2.dev URL; only the Worker reads it)
let bucket = tryWrangler(['r2', 'bucket', 'info', NAME]).ok
if (!bucket && apply) { wrangler(['r2', 'bucket', 'create', NAME]); bucket = true }
step(bucket, `R2 bucket ${NAME} (private)`)

// 3. secrets (the Worker may not exist before the first deploy; then none are set yet)
const list = tryWrangler(['secret', 'list', '--format', 'json'])
const have = new Set(list.ok ? json(list.out).map(s => s.name) : [])
for (const [name, what] of [...SECRETS, ...OPTIONAL]) {
    const optional = OPTIONAL.some(o => o[0] === name)
    if (have.has(name)) { step(true, `secret ${name}`); continue }
    console.log(`${optional ? '  -      ' : '  MISSING'} secret ${name}: ${what}${optional ? ' (optional)' : ''}`)
    if (apply && !optional) {
        console.log(`           wrangler secret put ${name} (paste the value; it is not echoed)`)
        const r = spawnSync('wrangler', ['secret', 'put', name], {cwd: here, stdio: 'inherit'})
        if (r.status !== 0) process.exit(r.status ?? 1)
    }
}
if (!have.has('DISCORD_WEBHOOK')) console.log('           optional: wrangler secret put DISCORD_WEBHOOK')

console.log(apply ? '\nNext: npm run deploy' : '\nNothing changed. Run with --apply to create what is missing.')
