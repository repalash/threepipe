// Writes catalog.json (npm run assets:catalog, assets:render) to the tables `threepipe_assets` and `threepipe_asset_links`.
// Without --apply it only checks the catalog and says what it would do. Upload the files first:
//
//   npm run cloud:upload -- <out>/samples samples/           models, write-once
//   npm run cloud:upload -- <out>/p/samples p/samples/       thumbnails, videos, screenshots, can be redone
//   npm run assets:insert -- --out <out> [--api <url>] [--token-file <file>] [--apply]
//
// Rerun after a change: a row with the same set and name is replaced, so its id changes; nothing refers to an asset by id.
// The admin token: ADMIN_SERVICE_TOKEN from the environment or --token-file (a .prod.vars or .dev.vars). Never printed.
import fs from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'

const {values: args} = parseArgs({options: {
    out: {type: 'string', default: 'tmp/models'},
    api: {type: 'string', default: 'https://cloud.threepipe.org'},
    'token-file': {type: 'string'},
    apply: {type: 'boolean', default: false},
}})

// the columns of services/cloud/teenybase.ts that the catalog sets
const ASSET_COLUMNS = ['kind', 'set_name', 'name', 'label', 'tags', 'license', 'authors', 'source_url', 'url', 'thumb_url', 'video_url', 'size', 'triangles', 'poly', 'metadata']
const LINK_COLUMNS = ['from_asset', 'relation', 'to_asset']
const D1_MAX_PARAMS = 100 // bound parameters in one statement (Cloudflare's limit), one per column of each row
const AT_ONCE = 6

// our URLs and where the file is in --out
const LOCAL = [['https://samples.threepipe.org/', 'samples/'], ['https://files.threepipe.org/p/samples/', 'p/samples/']]
const localOf = url => {
    const at = LOCAL.find(([prefix]) => url.startsWith(prefix))
    return at && path.join(args.out, at[1], decodeURIComponent(url.slice(at[0].length)))
}

const catalog = JSON.parse(fs.readFileSync(path.join(args.out, 'catalog.json'), 'utf8'))
const problems = []
const seen = new Set()
for (const row of catalog.rows) {
    const asset = `${row.set_name}/${row.name}`
    if (seen.has(asset)) problems.push(`${asset}: twice`)
    seen.add(asset)
    if (row.over_limit) problems.push(`${asset}: over the upload limit`)
    if (!/^[A-Za-z0-9._-]+$/.test(row.name)) problems.push(`${asset}: the name is not a slug`)
    // a model already in the bucket is not in --out, nor is the model a texture of it points to
    const inBucket = row.linked || (row.kind === 'texture' && !catalog.rows.some(r => r.kind === 'model' && !r.linked && r.url === row.url))
    const urls = [inBucket ? undefined : row.url, row.thumb_url, row.video_url, ...['screenshots', 'videos', 'thumbnails'].flatMap(k => JSON.parse(row.metadata ?? '{}')[k] ?? []).map(s => s.url)].filter(Boolean)
    for (const url of urls) {
        const file = localOf(url)
        if (file && !fs.existsSync(file)) problems.push(`${asset}: no file for ${url}`)
    }
}
for (const link of catalog.links) {
    for (const asset of [link.from_asset, link.to_asset]) if (!seen.has(asset)) problems.push(`link to an unknown asset: ${asset}`)
}
const models = catalog.rows.filter(r => r.kind === 'model')
console.log(`${catalog.rows.length} assets (${models.length} models, ${catalog.rows.length - models.length} others), ${catalog.links.length} links`)
console.log(`no thumbnail: ${models.filter(r => !r.thumb_url).map(r => r.name).join(' ') || 'none'}`)
console.log(`no license: ${models.filter(r => !r.license).map(r => r.name).join(' ') || 'none'}`)
if (problems.length) {
    console.error(problems.slice(0, 40).join('\n'))
    console.error(`${problems.length} problems, nothing written`)
    process.exit(1)
}

const pick = (row, columns) => Object.fromEntries(columns.map(c => [c, row[c] ?? null]))
const batches = (rows, columns) => {
    const size = Math.floor(D1_MAX_PARAMS / columns.length)
    return Array.from({length: Math.ceil(rows.length / size)}, (_, i) => rows.slice(i * size, (i + 1) * size).map(r => pick(r, columns)))
}
const jobs = [
    ...batches(catalog.rows, ASSET_COLUMNS).map(values => ['threepipe_assets', values]),
    ...batches(catalog.links, LINK_COLUMNS).map(values => ['threepipe_asset_links', values]),
]
console.log(`${jobs.length} requests, one D1 write each, to ${args.api}`)
if (!args.apply) {
    console.log('checked; nothing written (--apply writes)')
    process.exit(0)
}

let token = process.env.ADMIN_SERVICE_TOKEN
if (args['token-file']) token = /^ADMIN_SERVICE_TOKEN=(.*)$/m.exec(fs.readFileSync(args['token-file'], 'utf8'))?.[1]?.trim()
if (!token) {
    console.error('no ADMIN_SERVICE_TOKEN: set it in the environment or give --token-file')
    process.exit(1)
}

const start = Date.now()
let failed = 0
const send = async([table, values]) => {
    const response = await fetch(`${args.api}/api/v1/table/${table}/insert`, {
        method: 'POST',
        headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
        body: JSON.stringify({values, or: 'REPLACE'}),
    })
    if (response.ok) return
    failed++
    console.error(`${table}, ${values[0].name ?? values[0].from_asset}: ${response.status} ${(await response.text()).slice(0, 300)}`)
}
const queue = [...jobs]
await Promise.all(Array.from({length: AT_ONCE}, async() => {
    while (queue.length) await send(queue.shift())
}))
console.log(`${jobs.length - failed} of ${jobs.length} requests done in ${((Date.now() - start) / 1000).toFixed(1)} s`)
process.exit(failed ? 1 : 0)
