// Download the public reference photographs a measurement set reads into a gitignored folder; the photos are not
// committed (CC BY-SA, credited in the set). Commons re-renders thumbnails now and then, so a sha256 mismatch is
// reported with the image size and the run continues only if the size still matches the calibration.
//
//   node demos/benchmark/scripts/fetch-refs.mjs [measurements.json] [out-dir]
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import sharp from 'sharp'

const setPath = process.argv[2] ?? 'demos/benchmark/targets/canon-5d4-measure/measurements.json'
const set = JSON.parse(readFileSync(setPath, 'utf8'))
const out = process.argv[3] ?? set.photoDir
mkdirSync(out, {recursive: true})
const sha = b => createHash('sha256').update(b).digest('hex')
let bad = 0
for (const [key, p] of Object.entries(set.photos)) {
    const file = join(out, p.file)
    const src = p.derivation ? join(out, p.derivation.from) : file
    let bytes = existsSync(src) ? readFileSync(src) : null
    if (!bytes || sha(bytes) !== p.sha256) {
        const res = await fetch(p.url, {headers: {'User-Agent': 'threepipe-benchmark/1.0 (https://github.com/repalash/threepipe)'}})
        if (!res.ok) throw new Error(`${key}: ${res.status} ${p.url}`)
        bytes = Buffer.from(await res.arrayBuffer())
        writeFileSync(src, bytes)
    }
    const meta = await sharp(bytes).metadata()
    const okSize = meta.width === p.size[0] && meta.height === p.size[1]
    const okSha = sha(bytes) === p.sha256
    if (!okSize) bad++
    if (p.derivation) {
        const {left, top, width, height, resize} = p.derivation
        await sharp(bytes).extract({left, top, width, height}).resize(resize[0], resize[1], {kernel: 'lanczos3'}).jpeg({quality: 90}).toFile(file)
    }
    console.log(JSON.stringify({photo: key, file, sha256: okSha ? 'ok' : 'differs (Commons re-rendered the thumbnail)', size: okSize ? 'ok' : `${meta.width}x${meta.height}, expected ${p.size.join('x')}`}))
}
if (bad) { console.error(`${bad} photo(s) changed size: re-check the calibrations`); process.exit(1) }
