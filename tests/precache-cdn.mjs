/**
 * Pre-cache CDN resources and remote assets used by examples.
 * Run before tests to download all dependencies upfront,
 * so test timing isn't affected by network latency.
 *
 * Usage: node tests/precache-cdn.mjs [--assets]
 *   --assets  Also cache remote asset files (models, textures, HDR maps)
 *             Without this flag, only CDN module scripts are cached.
 */

import {mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'

const CACHE_DIR = './node_modules/.cache/test-cdn/'
const EXAMPLES_DIR = './examples/'
const cacheAssets = process.argv.includes('--assets')

// ─── Terminal formatting ─────────────────────────────────────────────────────
const cl = {
    reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m',
    yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
}

function cacheKeyForUrl (url) {
    return url.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function shortUrl (url) {
    return url
        .replace('https://unpkg.com/', 'unpkg:')
        .replace('https://esm.sh/', 'esm:')
        .replace('https://samples.threepipe.org/', 'samples:')
        .replace('https://threejs.org/examples/', 'three:')
        .replace('https://cdn.jsdelivr.net/', 'cdn:')
        .replace('https://raw.githubusercontent.com/', 'gh-raw:')
        .replace('https://demo-assets.pixotronics.com/', 'pixo:')
        .replace('https://dist.pixotronics.com/', 'pixo-dist:')
}

// ─── URL scanning ────────────────────────────────────────────────────────────

// CDN module hosts (always cached)
const cdnPrefixes = ['https://unpkg.com/', 'https://esm.sh/']

// Asset hosts (cached only with --assets flag)
const assetPrefixes = [
    'https://samples.threepipe.org/',
    'https://threejs.org/examples/',
    'https://cdn.jsdelivr.net/',
    'https://raw.githubusercontent.com/',
    'https://demo-assets.pixotronics.com/',
    'https://dist.pixotronics.com/',
    'https://dl.polyhaven.org/',
]

// Skip patterns (not cacheable or too dynamic)
const skipPatterns = [
    /\{[xyz]\}/, // tile URL templates like {z}/{x}/{y}
    /github\.com\/.*\/blob\//, // github blob links (not raw)
    /openstreetmap\.org/,
    /openseadragon\.github\.io/,
    /s3-us-west-2\.amazonaws\.com/, // flickity demo images
    /rsms\.me/, // font CDN
]

function findUrls () {
    const cdnUrls = new Set()
    const assetUrls = new Set()

    const dirs = readdirSync(EXAMPLES_DIR, {withFileTypes: true})
        .filter(d => d.isDirectory() && d.name !== 'examples-utils' && d.name !== '_index')

    for (const dir of dirs) {
        // Scan both HTML and TS files
        for (const file of ['index.html', 'script.ts']) {
            const filePath = join(EXAMPLES_DIR, dir.name, file)
            if (!existsSync(filePath)) continue
            const content = readFileSync(filePath, 'utf8')

            const urlPattern = /https:\/\/[^ "',)<>\n\t]+/g
            for (const m of content.matchAll(urlPattern)) {
                let url = m[0].replace(/[)}\]'"]+$/, '') // clean trailing chars
                if (skipPatterns.some(p => p.test(url))) continue

                if (cdnPrefixes.some(p => url.startsWith(p))) {
                    cdnUrls.add(url)
                } else if (assetPrefixes.some(p => url.startsWith(p))) {
                    assetUrls.add(url)
                }
            }
        }
    }
    return {cdnUrls: [...cdnUrls].sort(), assetUrls: [...assetUrls].sort()}
}

// ─── Download ────────────────────────────────────────────────────────────────

async function downloadUrl (url) {
    const cacheFile = CACHE_DIR + cacheKeyForUrl(url)
    if (existsSync(cacheFile)) {
        const size = statSync(cacheFile).size
        return {status: 'cached', size}
    }

    try {
        const resp = await fetch(url, {redirect: 'follow'})
        if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer())
            writeFileSync(cacheFile, buf)
            return {status: 'downloaded', size: buf.length}
        }
        return {status: `HTTP ${resp.status}`, size: 0}
    } catch (e) {
        return {status: `error: ${e.message}`, size: 0}
    }
}

async function processBatch (urls, label) {
    let cached = 0, downloaded = 0, failed = 0, totalSize = 0

    const BATCH_SIZE = 8
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map(async url => {
            const result = await downloadUrl(url)
            totalSize += result.size
            if (result.status === 'cached') {
                cached++
            } else if (result.status === 'downloaded') {
                downloaded++
                console.log(`  ${cl.green}✓${cl.reset} ${shortUrl(url)} ${cl.dim}(${(result.size / 1024).toFixed(0)}KB)${cl.reset}`)
            } else {
                failed++
                console.log(`  ${cl.red}✘${cl.reset} ${shortUrl(url)} ${cl.dim}${result.status}${cl.reset}`)
            }
        }))
    }

    const totalMB = (totalSize / 1024 / 1024).toFixed(1)
    console.log(`  ${cl.cyan}›${cl.reset} ${label}: ${cl.green}${cached} cached${cl.reset}, ${cl.green}${downloaded} new${cl.reset}${failed ? `, ${cl.red}${failed} failed${cl.reset}` : ''} ${cl.dim}(${totalMB}MB total)${cl.reset}`)
    return {cached, downloaded, failed}
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\n${cl.cyan}›${cl.reset} Scanning examples for remote URLs...`)
const {cdnUrls, assetUrls} = findUrls()
console.log(`${cl.cyan}›${cl.reset} Found ${cdnUrls.length} CDN modules + ${assetUrls.length} remote assets\n`)

mkdirSync(CACHE_DIR, {recursive: true})

console.log(`${cl.cyan}CDN modules:${cl.reset}`)
await processBatch(cdnUrls, 'CDN')

if (cacheAssets) {
    console.log(`\n${cl.cyan}Remote assets:${cl.reset}`)
    await processBatch(assetUrls, 'Assets')
} else {
    console.log(`\n${cl.dim}  Skipping ${assetUrls.length} remote assets (use --assets to cache them)${cl.reset}`)
}

console.log('')
