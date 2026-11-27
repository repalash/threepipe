// Builds the catalog of sample models from their sources: one GLB per model and catalog.json with what the table
// holds (`threepipe_assets` in services/cloud/teenybase.ts). It only reads the sources and writes locally; nothing is uploaded.
//
//   npm run assets:catalog -- [--src /tmp/models-src] [--out tmp/models] [--set khronos|gltf-research-scenes|bucket] [--only Name]
//
// Files go to <out>/samples/ as in the samples bucket, with the source's file name: `khronos/FlightHelmet.glb`, or a folder for
// a model of several files: `khronos/Box/glTF/Box.gltf`. Thumbnails, videos and screenshots can be redone, so they go to the
// cloud bucket's `p/samples/`, on the path of the model: <out>/p/samples/khronos/FlightHelmet/. A texture in a model gets a row
// and a thumbnail, and its URL is the model's; rows are linked with `uses`, and the same image in several models of a set is one.
// `metadata.views` has the model's cameras.
//
// Sets:
//   khronos                https://github.com/KhronosGroup/glTF-Sample-Assets (licenses in its REUSE.toml)
//   gltf-research-scenes   https://github.com/ErfanMo77/gltf-research-scenes (licenses in each conversion.yaml)
//   bucket                 the models already in the samples bucket (set: their top folder); the rows link to them where they are
//   poly-haven             models picked from https://polyhaven.com (CC0): the 2k glTF packed to one GLB, textures as WebP
//   lists                  hand-picked files of any format, in scripts/sample-assets/lists/*.json (the 3D Viewer's samples)
//   poly-haven-hdris, poly-haven-materials, ambientcg-hdris, ambientcg-materials
//                          every HDRI and material of Poly Haven and ambientCG (CC0), linked where they are: each row lists
//                          every resolution and format in metadata.files (--limit N: the first N of each, for a sample run)
//
// Any format: a glTF is read here (counts, cameras, clips, embedded textures). Any other file is copied as it is, or zipped
// when that is clearly smaller or saves requests, and the render page counts what it loads (render-catalog.mjs).
import {execFileSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {zipSync} from 'three/examples/jsm/libs/fflate.module.js'
import {Extension, getBounds, NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {dedup, meshopt, prune, textureCompress} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer'
import sharp from 'sharp'

const {values: args} = parseArgs({options: {
    src: {type: 'string', default: '/tmp/models-src'},
    out: {type: 'string', default: 'tmp/models'},
    set: {type: 'string'},
    only: {type: 'string'},
    limit: {type: 'string'}, // HDRI and material sets: the first N assets of each
}})
const RESEARCH_TAG = 'v1.2.0'
const SAMPLES = 'https://samples.threepipe.org'
const FILES = 'https://files.threepipe.org'
// Rooms the camera test gets wrong: seen from inside (with no camera in the file), and turned only a little (with one,
// outside the bounds of an open box, where a full turn shows its back).
const INSIDE = new Set(['Sponza', 'sponza-ssgi-ssr', 'cornell-box', 'cornell-caustic', 'house', 'veach-ajar', 'veach-bidir', 'veach-mis'])
const MAX_BYTES = 90 * 1024 * 1024 // the cloud's upload limit (services/cloud/src/limits.ts)

/** low | mid | high: a rough guide, the row keeps the real count to filter on. */
const polyClass = triangles => triangles < 50_000 ? 'low' : triangles < 500_000 ? 'mid' : 'high'

const trianglesOf = mesh => mesh.listPrimitives().reduce((n, p) => {
    const count = (p.getIndices() ?? p.getAttribute('POSITION'))?.getCount() ?? 0
    return n + (p.getMode() === 4 ? Math.floor(count / 3) : p.getMode() === 5 || p.getMode() === 6 ? Math.max(0, count - 2) : 0) // triangles, strip, fan
}, 0)

/** The triangles the default scene draws: a mesh counts once per node using it and per GPU instance. */
function sceneTriangles(root) {
    const scene = root.getDefaultScene() ?? root.listScenes()[0]
    if (!scene) return root.listMeshes().reduce((n, m) => n + trianglesOf(m), 0)
    let total = 0
    scene.traverse(node => {
        const mesh = node.getMesh()
        if (!mesh) return
        const instances = node.getExtension('EXT_mesh_gpu_instancing')?.listAttributes()[0]?.getCount() ?? 1
        total += trianglesOf(mesh) * instances
    })
    return total
}

const SLOTS = {getBaseColorTexture: 'baseColor', getNormalTexture: 'normal', getMetallicRoughnessTexture: 'metallicRoughness', getOcclusionTexture: 'occlusion', getEmissiveTexture: 'emissive'}

/** What each texture is used for in the core material slots. Textures of material extensions are just `extension`. */
function slotsOf(root) {
    const slots = new Map()
    for (const material of root.listMaterials()) {
        for (const [getter, slot] of Object.entries(SLOTS)) {
            const texture = material[getter]()
            if (texture) slots.set(texture, (slots.get(texture) ?? new Set()).add(slot))
        }
    }
    return slots
}

/** The rows and links of the textures of a model, and their thumbnails. A texture a set has seen is only linked again. */
async function addTextures(root, model, seen, links) {
    const slots = slotsOf(root)
    const rows = []
    for (const texture of root.listTextures()) {
        const image = texture.getImage()
        if (!image) continue
        const hash = crypto.createHash('sha256').update(image).digest('hex')
        const name = `texture-${hash.slice(0, 12)}`
        const asset = `${model.set_name}/${name}`
        links.add(`${model.set_name}/${model.name}|uses|${asset}`)
        const slot = [...slots.get(texture) ?? []]
        const known = seen.get(asset)
        if (known) {
            known.tags = JSON.stringify([...new Set([...JSON.parse(known.tags), ...slot])].sort())
            continue
        }
        const textureDir = `p/samples/${model.set_name}/textures`
        fs.mkdirSync(path.join(args.out, textureDir), {recursive: true})
        let thumb = null, width = null, height = null
        try {
            const meta = await sharp(image).metadata()
            ;({width, height} = meta)
            await sharp(image).resize(256, 256, {fit: 'inside', withoutEnlargement: true}).webp({quality: 80}).toFile(path.join(args.out, textureDir, `${hash.slice(0, 12)}.webp`))
            thumb = `${FILES}/${textureDir}/${hash.slice(0, 12)}.webp`
        } catch { /* a format sharp doesn't read (KTX2): no thumbnail or dimensions */ }
        const row = {
            kind: 'texture', set_name: model.set_name, name, label: texture.getName() || texture.getURI() || `${model.label} texture`,
            tags: JSON.stringify(['embedded', ...slot].sort()), license: model.license, authors: model.authors, source_url: model.source_url,
            links: '[]', changes: `taken from the model ${model.name}`, url: model.url,
            thumb_url: thumb, size: image.byteLength, width, height,
        }
        seen.set(asset, row)
        rows.push(row)
    }
    return rows
}

/**
 * The views of a model, in the file's coordinates: its cameras, or a view from inside for a room with none. The first is
 * the one to render from; an app can offer them all.
 */
function viewsOf(root, name, saved) {
    const scene = root.getDefaultScene() ?? root.listScenes()[0]
    if (!scene) return []
    const {min, max} = getBounds(scene)
    const center = min.map((v, i) => (v + max[i]) / 2)
    const radius = Math.hypot(...max.map((v, i) => v - min[i])) / 2 || 1
    const views = []
    const xyz = v => [v.x, v.y, v.z]
    if (saved?.position && saved.target) { // the camera the file was saved with in the viewer: it is the view to render from
        const position = xyz(saved.position)
        views.push({
            name: 'saved', saved: true, position, target: xyz(saved.target), yfov: saved.fov ? saved.fov * Math.PI / 180 : undefined,
            inside: INSIDE.has(name) || position.every((v, i) => v > min[i] && v < max[i]),
        })
    }
    for (const node of root.listNodes()) {
        const camera = node.getCamera()
        if (!camera || camera.getType() !== 'perspective') continue
        const position = node.getWorldTranslation()
        const [x, y, z, w] = node.getWorldRotation()
        const forward = [-2 * (x * z + w * y), -2 * (y * z - w * x), -1 + 2 * (x * x + y * y)] // -z, turned by the rotation
        // the turn goes around what it looks at
        const distance = Math.max(forward.reduce((n, v, i) => n + v * (center[i] - position[i]), 0), radius * 0.25)
        views.push({
            name: camera.getName() || node.getName() || 'camera', position,
            target: position.map((v, i) => v + forward[i] * distance),
            yfov: camera.getYFov(), aspect: camera.getAspectRatio() || undefined,
            // inside the model's bounds: a room, where a full turn would go through the walls
            inside: INSIDE.has(name) || position.every((v, i) => v > min[i] && v < max[i]),
        })
    }
    if (!views.length && INSIDE.has(name)) {
        // from one end of the longest side, at a person's height in the room, along the middle
        const size = max.map((v, i) => v - min[i])
        const long = size[0] >= size[2] ? 0 : 2
        const position = [...center]
        position[long] = min[long] + size[long] * 0.22
        position[1] = min[1] + size[1] * 0.2
        const target = [...center]
        target[1] = position[1] + size[1] * 0.08
        views.push({name: 'inside', position, target, yfov: 1.1, inside: true})
    }
    return views
}

/**
 * The clips of a model, and those to play together. glTF doesn't say which play together: clips that move the same
 * property of the same node are alternatives (the walk and the run of a character), so the first one wins; clips that
 * move different things are parts of one scene.
 */
function animationsOf(root) {
    const moved = new Set(), play = []
    const animations = root.listAnimations().map((animation, index) => {
        const name = animation.getName() || `animation_${index}` // the name three.js GLTFLoader gives an unnamed clip
        const targets = animation.listChannels().map(c => `${root.listNodes().indexOf(c.getTargetNode())}|${c.getTargetPath()}`)
        if (!targets.some(t => moved.has(t))) {
            play.push(name)
            targets.forEach(t => moved.add(t))
        }
        const seconds = Math.max(0, ...animation.listSamplers().map(s => s.getInput()?.getMax([])[0] ?? 0))
        return {name, seconds: Math.round(seconds * 1000) / 1000}
    })
    return {animations, play}
}

/** The JSON of a file as it is: gltf-transform leaves out the extensions it doesn't know, like the viewer settings. */
async function rawJson(file) {
    const bytes = Buffer.from(/^https?:/.test(file) ? await (await fetch(file)).arrayBuffer() : fs.readFileSync(file))
    return JSON.parse(bytes.toString('utf8', 0, 4) === 'glTF' ? bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)) : bytes.toString('utf8'))
}

/** Tags for grouping and filtering: the source's, plus what the file has (`animated`, `transmission`, ...). */
function tagsOf(tags, root) {
    const out = new Set(tags)
    if (root.listAnimations().length) out.add('animated')
    if (root.listSkins().length) out.add('skinned')
    if (root.listMeshes().some(m => m.listPrimitives().some(p => p.listTargets().length))) out.add('morph')
    if (root.listCameras().length) out.add('camera')
    if (root.listTextures().length) out.add('textured')
    for (const e of root.listExtensionsUsed()) {
        const material = /^KHR_materials_(.+)$/.exec(e.extensionName)?.[1]
        if (material) out.add(material)
        if (e.extensionName === 'KHR_lights_punctual') out.add('lights')
    }
    return [...out].sort()
}

/** The format of a Khronos sample variant: `glTF-Draco` is `draco`, `glTF-Binary` is `glb`. */
function khronosFormat(variant) {
    return {'glTF-Binary': 'glb', glTF: 'gltf', 'glTF-Embedded': 'gltf-embedded', 'glTF-KTX-BasisU': 'ktx2'}[variant] ?? variant.replace(/^glTF-/, '').toLowerCase()
}

/** Tags for what lists filter on in the files of an asset: compressed formats and levels of detail */
function fileTags(files) {
    const out = files.map(f => f.format).filter(f => ['draco', 'ktx2', 'meshopt', 'quantized'].includes(f))
    if (files.some(f => f.lod > 0)) out.push('lods')
    return out
}

const run = (cmd, ...a) => execFileSync(cmd, a, {stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 28}).trim()

function fetchRepo(url, dir, ref) {
    if (fs.existsSync(dir)) return
    run('git', 'clone', '-q', '--depth', '1', ...ref ? ['--branch', ref] : [], url, dir)
}

/** The annotations of a REUSE.toml, by model: {license, authors}. Later entries for a path add to earlier ones. */
function parseReuse(text) {
    const out = {}
    for (const block of text.split('[[annotations]]').slice(1)) {
        const name = /path\s*=\s*"Models\/([^/"*]+)/.exec(block)?.[1]
        if (!name) continue
        const license = /SPDX-License-Identifier"?\s*=\s*"([^"]+)"/.exec(block)?.[1]
        const copy = /SPDX-FileCopyrightText"?\s*=\s*(\[[^\]]*\]|"[^"]*")/s.exec(block)?.[1]
        out[name] = {license, authors: copy ? [...copy.matchAll(/"([^"]+)"/g)].map(m => m[1]) : undefined}
    }
    return out
}

/** The links and author in the Source section of a research scene's README. */
function parseSceneReadme(text) {
    const section = /## Source\n([\s\S]*?)(?:\n## |$)/.exec(text)?.[1] ?? ''
    const links = [...section.matchAll(/^- ([^:\n]+): \[[^\]]*\]\((https?:[^)]+)\)/gm)].map(m => ({label: m[1], url: m[2]}))
    const author = /^- Original author: (.+)$/m.exec(section)?.[1]
    return {links, authors: author ? [author] : undefined}
}

/**
 * A name for paths, the same in both buckets: letters, digits, dot, dash and underscore. The source's name stays in
 * `label`. Accents go; a name with no Latin letters left becomes a hash of itself. Case stays, so a model keeps the name it
 * is known by.
 */
function slugOf(name) {
    const slug = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '')
    return slug || `asset-${crypto.createHash('sha256').update(name.normalize('NFC')).digest('hex').slice(0, 8)}`
}

const IMAGE = /\.(jpe?g|png|webp|gif)$/i

/** The source's images of a model, as they are in its repository: [{file, label}]. */
const imagesIn = (dir, label) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter(f => IMAGE.test(f)).sort()
    .filter(f => fs.statSync(path.join(dir, f)).size > 1024) // a Git LFS pointer is not an image
    .map(f => ({file: path.join(dir, f), label: label(f)}))

function* khronos() {
    const dir = path.join(args.src, 'glTF-Sample-Assets')
    fetchRepo('https://github.com/KhronosGroup/glTF-Sample-Assets', dir)
    const sha = run('git', '-C', dir, 'rev-parse', 'HEAD')
    const reuse = parseReuse(fs.readFileSync(path.join(dir, 'REUSE.toml'), 'utf8'))
    for (const m of JSON.parse(fs.readFileSync(path.join(dir, 'Models/model-index.json'), 'utf8'))) {
        const glb = m.variants['glTF-Binary']
        const variant = glb ? 'glTF-Binary' : m.variants.glTF ? 'glTF' : Object.keys(m.variants)[0]
        const license = reuse[m.name]
        yield {
            set_name: 'khronos', name: m.name, label: m.label, tags: m.tags ?? [],
            license: license?.license, authors: license?.authors,
            source_url: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/${sha}/Models/${m.name}`, links: [],
            file: path.join(dir, 'Models', m.name, variant, m.variants[variant]),
            changes: null,
            images: imagesIn(path.join(dir, 'Models', m.name, 'screenshot'), f => f.replace(IMAGE, '').replace(/^screenshot-?/, '') || 'screenshot'),
            // the other versions Khronos has (Draco, KTX, ...), read from its repository
            files: Object.entries(m.variants).filter(([v]) => v !== variant).map(([v, f]) => ({
                format: khronosFormat(v), label: v, url: `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${sha}/Models/${m.name}/${v}/${f}`,
            })),
        }
    }
}

/**
 * Models that don't load or render right, by their path in the samples bucket: tagged `broken`, the reason in
 * metadata.broken. Fixed later or hidden from lists (`!json_contains(tags, 'broken')`).
 */
const BROKEN = {
    // demos/classic-watch.glb was here (a dead texture threw on load); it renders right since 2026-11-26
}

/**
 * Models already in the samples bucket: the rows link to them, the files stay where they are; the set is their top folder.
 * Written by hand: the bucket has no listing here.
 */
const BUCKET_MODELS = [
    'demos/classic-watch.glb', 'demos/kira.glb', 'demos/r3f/dflat.glb', 'demos/sponza-ssgi-ssr.glb', 'demos/temple-lines.glb.zip',
    'demos/webgi/car-scene.glb', 'demos/webgi/classic-watch.glb', 'demos/webgi/engine-ssr-compressed.glb', 'demos/webgi/gi-city-2.glb',
    'demos/webgi/lights-only-env.glb', 'demos/webgi/robot-2.glb', 'demos/webgi/robot.glb',
    'minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', 'minimal/Horse.glb',
    'tests/SpecGlossVsMetalRough.glb', 'tests/bumpmap_normalize_migrate.glb',
]

/** The GLB in a zip, to read it: gltf-transform reads a GLB or a glTF only. */
function unzipped(url, name) {
    const dir = path.join(args.src, 'threepipe-zips', name)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true})
        run('curl', '-sSLf', '-o', `${dir}.zip`, url)
        run('unzip', '-q', `${dir}.zip`, '-d', dir)
        fs.rmSync(`${dir}.zip`)
    }
    return path.join(dir, fs.readdirSync(dir).find(f => /\.(glb|gltf)$/.test(f)))
}

function* bucket() {
    for (const file of BUCKET_MODELS) {
        const name = file.replace(/^(demos|minimal|tests)\//, '').replace(/\/glTF\/.*$/, '').replace(/(\.glb)?\.[^.]+$/, '').replaceAll('/', '-')
        yield {
            set_name: file.split('/')[0], name, label: name.replaceAll('-', ' '), tags: file.startsWith('tests/') ? ['test'] : [],
            links: [], file: `${SAMPLES}/${file}`, linked: true, read: file.endsWith('.zip') ? unzipped(`${SAMPLES}/${file}`, name) : undefined, changes: null,
        }
    }
}

/**
 * Models picked from Poly Haven for the examples (CC0, https://polyhaven.com/license), by their Poly Haven id. Each is its 2k
 * glTF packed to one GLB with WebP textures (quality 85): about a quarter of the size, with no visible change in threepipe.
 */
const POLY_HAVEN = ['marble_bust_01', 'horse_statue_01', 'mid_century_lounge_chair', 'Camera_01', 'rubber_duck_toy']
const POLY_HAVEN_RES = '2k'

function* polyHaven() {
    const api = id => JSON.parse(run('curl', '-sSLf', `https://api.polyhaven.com/${id}`))
    for (const id of POLY_HAVEN) {
        const dir = path.join(args.src, 'poly-haven', id)
        const info = api(`info/${id}`)
        const gltfs = api(`files/${id}`).gltf
        const chosen = gltfs[POLY_HAVEN_RES].gltf
        const file = path.join(dir, path.basename(new URL(chosen.url).pathname))
        if (!fs.existsSync(file)) {
            fs.mkdirSync(dir, {recursive: true})
            run('curl', '-sSLf', '-o', file, chosen.url)
            for (const [rel, {url}] of Object.entries(chosen.include ?? {})) {
                const dest = path.join(dir, rel)
                if (!path.resolve(dest).startsWith(path.resolve(dir) + path.sep)) throw new Error(`${id}: ${rel} is outside the model folder`)
                fs.mkdirSync(path.dirname(dest), {recursive: true})
                run('curl', '-sSLf', '-o', dest, url)
            }
        }
        const thumb = path.join(dir, 'thumbnail.png')
        if (!fs.existsSync(thumb)) {
            try {
                run('curl', '-sSLf', '-o', thumb, `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=1024&height=1024`)
            } catch { /* no thumbnail: the row goes without the source's image */ }
        }
        yield {
            set_name: 'poly-haven', name: id, label: info.name ?? id, tags: (info.categories ?? []).filter(c => !c.startsWith('collection:')),
            license: 'CC0-1.0',
            // {name: role}: "Rico Cilliers (All)"
            authors: Object.entries(info.authors ?? {}).map(([name, role]) => `${name} (${role})`),
            source_url: `https://polyhaven.com/a/${id}`, links: [], file, pack: true,
            changes: `packed to one GLB from the ${POLY_HAVEN_RES} glTF, textures to WebP (quality 85)`,
            images: fs.existsSync(thumb) && fs.statSync(thumb).size > 1024 ? [{file: thumb, label: 'thumbnail'}] : [],
            files: Object.entries(gltfs).map(([res, v]) => ({format: 'gltf', resolution: res, label: `${res} glTF (original)`, url: v.gltf.url})),
        }
    }
}

// ---- lists: hand-picked files of any format ----

const LISTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lists')

/** Fetches a URL to a file, once. */
async function download(url, dest) {
    if (fs.existsSync(dest)) return dest
    fs.mkdirSync(path.dirname(dest), {recursive: true})
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
    return dest
}

/** A path inside a folder, never outside it (a source's relative path is data). */
function inside(dir, rel) {
    const dest = path.resolve(dir, rel)
    if (!dest.startsWith(path.resolve(dir) + path.sep)) throw new Error(`${rel} is outside ${dir}`)
    return dest
}

/**
 * A binary STL as a Draco file: the vertices welded (STL repeats them per triangle), Edgebreaker, 14-bit positions,
 * the slowest and smallest encode. Ported from tmp/3dviewer-samples/stl2drc.js.
 */
async function stlToDraco(stl, out) {
    if (fs.existsSync(out)) return out
    const b = fs.readFileSync(stl)
    const n = b.readUInt32LE(80)
    if (84 + n * 50 !== b.length) throw new Error(`${stl}: not a binary STL`)
    const ids = new Map(), positions = [], index = new Uint32Array(n * 3)
    for (let i = 0; i < n; i++) {
        for (let v = 0; v < 3; v++) {
            const o = 84 + i * 50 + 12 + v * 12
            const key = `${b.readFloatLE(o)},${b.readFloatLE(o + 4)},${b.readFloatLE(o + 8)}`
            let id = ids.get(key)
            if (id === undefined) {
                id = positions.length / 3
                ids.set(key, id)
                positions.push(b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8))
            }
            index[i * 3 + v] = id
        }
    }
    const m = await draco3d.createEncoderModule({})
    const encoder = new m.Encoder(), builder = new m.MeshBuilder(), mesh = new m.Mesh(), data = new m.DracoInt8Array()
    builder.AddFacesToMesh(mesh, n, index)
    builder.AddFloatAttributeToMesh(mesh, m.POSITION, positions.length / 3, 3, new Float32Array(positions))
    encoder.SetSpeedOptions(0, 0)
    encoder.SetAttributeQuantization(m.POSITION, 14)
    encoder.SetEncodingMethod(m.MESH_EDGEBREAKER_ENCODING)
    const length = encoder.EncodeMeshToDracoBuffer(mesh, data)
    const bytes = Buffer.alloc(length)
    for (let i = 0; i < length; i++) bytes[i] = data.GetValue(i)
    for (const o of [encoder, builder, mesh, data]) m.destroy(o)
    fs.writeFileSync(out, bytes)
    return out
}

/** Every file of a 3D tileset, relative to its tileset.json: the tiles' content and the tilesets it links, fetched. */
async function crawlTileset(url, dir) {
    const files = new Set(), queue = [path.basename(new URL(url).pathname)]
    const base = new URL('.', url)
    while (queue.length) {
        const batch = queue.splice(0, 16)
        await Promise.all(batch.map(async rel => {
            if (files.has(rel)) return
            files.add(rel)
            const file = await download(new URL(rel, base).href, inside(dir, rel))
            if (!rel.endsWith('.json')) return
            const tileset = JSON.parse(fs.readFileSync(file, 'utf8'))
            const tiles = [tileset.root]
            while (tiles.length) {
                const tile = tiles.pop()
                for (const content of [tile.content, ...tile.contents ?? []].filter(Boolean)) {
                    const uri = content.uri ?? content.url
                    if (uri && !/^[a-z]+:/i.test(uri)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), uri.split(/[?#]/)[0])))
                }
                tiles.push(...tile.children ?? [])
            }
        }))
    }
    return [...files]
}

/** The entries of the lists, fetched to --src: {file, extra: [paths next to it], sourceZip, ...row fields}. */
async function* lists() {
    for (const listFile of fs.readdirSync(LISTS).filter(f => f.endsWith('.json')).sort()) {
        const list = JSON.parse(fs.readFileSync(path.join(LISTS, listFile), 'utf8'))
        for (const a of list.assets) {
            const rootUrl = a.url ?? a.zip
            // a file we make from the source (`encode`) takes the source's name with its own extension
            const rootName = a.entry ?? path.basename(new URL(rootUrl).pathname).replace(/\.[^.]+$/, a.encode === 'draco' ? '.drc' : '$&')
            const name = a.name ?? rootName.replace(/(\.[A-Za-z0-9_]+)+$/, '')
            const dir = path.join(args.src, 'lists', a.set, slugOf(name))
            let file, extra = [], sourceZip
            if (a.crawl === 'tileset') {
                const files = await crawlTileset(a.url, dir)
                file = path.join(dir, files[0])
                extra = files.slice(1)
            } else if (a.zip) { // the source is a zip: read the entry in it; the zip itself may be what we keep
                sourceZip = await download(a.zip, path.join(dir, path.basename(new URL(a.zip).pathname)))
                const unzippedDir = path.join(dir, 'unzipped')
                if (!fs.existsSync(unzippedDir)) run('unzip', '-q', '-o', sourceZip, '-d', unzippedDir)
                file = inside(unzippedDir, a.entry)
            } else if (a.encode === 'draco') {
                const stl = await download(a.url, path.join(dir, path.basename(new URL(a.url).pathname)))
                file = await stlToDraco(stl, path.join(dir, rootName))
            } else {
                file = await download(a.url, path.join(dir, rootName))
                for (const rel of a.files ?? []) await download(new URL(rel, a.url).href, inside(dir, rel))
                extra = a.files ?? []
            }
            yield {
                set_name: a.set, name, label: a.label ?? name, tags: [...a.tags ?? [], ...list.tag ? [list.tag] : []],
                license: a.license ?? null, license_note: a.license_note, authors: a.authors, source_url: a.source_url ?? a.url ?? a.zip,
                links: a.links ?? [], changes: a.changes ?? null, file, extra, sourceZip, tileset: a.crawl === 'tileset',
            }
        }
    }
}

// ---- any format other than glTF ----

/** The format of a file, from its name: `tileset.json` is `tileset`, `x.mpd_Packed.mpd` is `mpd`. */
const formatOf = file => /(^|\/)tileset\.json$/i.test(file) || /_tileset\.json$/i.test(file) ? 'tileset' : path.extname(file).slice(1).toLowerCase()
const TILES = new Set(['tileset', 'b3dm', 'cmpt', 'i3dm', 'pnts'])
const POINTS = new Set(['xyz', 'pcd', 'pnts'])
const SPLATS = new Set(['splat', 'ksplat', 'spz'])
// formats that are already a container or compressed, or that load by URL piece by piece: never zipped
const NO_ZIP = new Set([...TILES, '3mf', 'usdz', 'drc', 'dzi', 'zip', 'ktx2'])
// a zip is kept when it is at most this much of the files, or when it saves requests (more than one file)
const ZIP_RATIO = 0.75
// a fixed date in the zips: the same files make the same zip
const ZIP_DATE = new Date('2026-01-01T00:00:00Z')

/**
 * A file the catalog doesn't read: where it goes in the bucket (as it is, zipped, or a folder with the source's layout),
 * its size and what can be counted without loading it. The render page counts the rest.
 */
function addOther(m, fields) {
    const format = formatOf(m.file)
    const root = path.basename(m.file)
    const srcDir = path.dirname(m.file)
    const all = [root, ...m.extra]
    const rawSize = all.reduce((n, rel) => n + fs.statSync(path.join(srcDir, rel)).size, 0)
    let modelPath, stored, zipped = false
    if (m.sourceZip && !NO_ZIP.has(format)) { // the source's own zip, as it is
        modelPath = `${m.set_name}/${path.basename(m.sourceZip)}`
        stored = [[m.sourceZip, path.join(args.out, 'samples', modelPath)]]
        zipped = true
    } else if (m.tileset || NO_ZIP.has(format) && all.length > 1) { // a folder, with the source's layout
        modelPath = `${m.set_name}/${m.name}/${root}`
        stored = all.map(rel => [path.join(srcDir, rel), path.join(args.out, 'samples', m.set_name, m.name, rel)])
    } else {
        const zip = NO_ZIP.has(format) ? undefined : Buffer.from(zipSync(Object.fromEntries(all.map(rel =>
            [rel, [fs.readFileSync(path.join(srcDir, rel)), {mtime: ZIP_DATE}]])), {level: 9}))
        if (zip && (all.length > 1 || zip.byteLength <= rawSize * ZIP_RATIO)) {
            modelPath = `${m.set_name}/${root}.zip`
            fs.mkdirSync(path.join(args.out, 'samples', m.set_name), {recursive: true})
            fs.writeFileSync(path.join(args.out, 'samples', modelPath), zip)
            stored = []
            zipped = true
        } else {
            modelPath = `${m.set_name}/${root}`
            stored = [[m.file, path.join(args.out, 'samples', modelPath)]]
        }
    }
    for (const [from, to] of stored) {
        fs.mkdirSync(path.dirname(to), {recursive: true})
        fs.copyFileSync(from, to)
    }
    const usedPath = modelPath.toLowerCase()
    if (paths.has(usedPath)) throw new Error(`${modelPath}: this path is already used by ${paths.get(usedPath)}`)
    paths.set(usedPath, m.name)
    const size = zipped || !stored.length || stored.length === 1 ? fs.statSync(path.join(args.out, 'samples', modelPath)).size :
        stored.reduce((n, [, to]) => n + fs.statSync(to).size, 0)
    const url = `${SAMPLES}/${modelPath.split('/').map(encodeURIComponent).join('/')}`
    const tags = new Set(m.tags)
    if (TILES.has(format)) tags.add('tiles3d')
    if (POINTS.has(format)) tags.add('pointcloud')
    if (SPLATS.has(format)) tags.add('splat')
    // a zip says which file in it to open; `count`: how many files it is
    const file = {default: true, format, url, size, ...zipped ? {zip: true, entry: m.sourceZip ? path.relative(path.join(path.dirname(m.sourceZip), 'unzipped'), m.file) : root} : {},
        ...all.length > 1 ? {count: all.length} : {}}
    const metadata = {
        // a .splat file is 32 bytes per splat (position, scale, colour, rotation)
        ...format === 'splat' ? {splats: Math.floor(fs.statSync(m.file).size / 32)} : {},
        ...m.tileset ? {tiles: m.extra.filter(rel => !rel.endsWith('.json')).length + (root.endsWith('.json') ? 0 : 1)} : {},
        ...m.license_note ? {license_note: m.license_note} : {},
    }
    return {...fields, metadata: JSON.stringify(metadata), screenshots: '[]', tags: JSON.stringify([...tags].sort()), links: JSON.stringify(m.links ?? []),
        files: JSON.stringify([file]), kind: 'model', url, previews: `p/samples/${m.set_name}/${slugOf(m.name)}`, linked: false, size,
        // counted on the render page, except a tileset: what it loads depends on the view
        triangles: null, poly: null, measure: format !== 'tileset', over_limit: Math.max(...(zipped ? [size] : stored.map(([, to]) => fs.statSync(to).size))) > MAX_BYTES,
        changes: [m.changes, zipped && !m.sourceZip ? `zipped (${(rawSize / 1e6).toFixed(1)} to ${(size / 1e6).toFixed(1)} MB${all.length > 1 ? `, ${all.length} files in one request` : ''})` : null].filter(Boolean).join('; ') || null}
}

// ---- HDRIs and materials, linked where they are ----

// Poly Haven asks API clients to name themselves (https://github.com/Poly-Haven/Public-API)
const API_HEADERS = {'user-agent': 'threepipe-asset-catalog (https://threepipe.org)'}
const getJson = async url => {
    const response = await fetch(url, {headers: API_HEADERS})
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return response.json()
}
/** Runs fn on every item, `n` at a time, in order of the results. */
async function pool(items, n, fn) {
    const out = new Array(items.length)
    let next = 0
    await Promise.all(Array.from({length: n}, async() => {
        while (next < items.length) {
            const i = next++
            out[i] = await fn(items[i], i)
        }
    }))
    return out
}
const limited = list => args.limit ? list.slice(0, parseInt(args.limit)) : list
const resolutionOrder = r => parseInt(r) || 0
// the default file of each: big enough to light and show a scene, small enough to load quickly
const HDRI_DEFAULT_RES = '2k'
const MATERIAL_DEFAULT_RES = '1k'

/** Poly Haven's HDRIs or textures (materials): {id, info, files} for each, the API's own order (by name). */
async function polyHavenAssets(type) {
    const assets = await getJson(`https://api.polyhaven.com/assets?type=${type}`)
    const ids = limited(Object.keys(assets).sort())
    return pool(ids, 8, async id => ({id, info: assets[id], files: await getJson(`https://api.polyhaven.com/files/${id}`)}))
}

const polyHavenRow = (id, info) => ({
    set_name: 'poly-haven', name: id, label: info.name ?? id, license: 'CC0-1.0',
    tags: [...new Set([...info.categories ?? [], ...info.tags ?? []])].filter(c => !c.startsWith('collection:')),
    authors: Object.entries(info.authors ?? {}).map(([name, role]) => `${name} (${role})`),
    source_url: `https://polyhaven.com/a/${id}`, links: [], changes: null, linked: true,
    images: [], remoteImages: [{label: 'thumbnail', url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=1024&height=1024`}],
})

async function* polyHavenHdris() {
    for (const {id, info, files} of await polyHavenAssets('hdris')) {
        const list = Object.entries(files.hdri ?? {}).sort(([a], [b]) => resolutionOrder(a) - resolutionOrder(b))
            .flatMap(([res, formats]) => Object.entries(formats).map(([format, f]) => ({format, resolution: res, url: f.url, size: f.size})))
        const main = list.find(f => f.resolution === HDRI_DEFAULT_RES && f.format === 'hdr') ?? list.find(f => f.format === 'hdr')
        if (!main) continue
        const row = polyHavenRow(id, info)
        if (files.tonemapped?.url) row.remoteImages.push({label: 'tonemapped', url: files.tonemapped.url})
        yield {...row, kind: 'hdri', url: main.url, size: main.size, files: [{default: true, ...main}, ...list.filter(f => f !== main)],
            width: resolutionOrder(main.resolution) * 1024, height: resolutionOrder(main.resolution) * 512,
            // Poly Haven's own measurements: the brightest light's direction and how bright it is
            extra: {evs: info.evs_cap, whitebalance: info.whitebalance}}
    }
}

async function* polyHavenMaterials() {
    for (const {id, info, files} of await polyHavenAssets('textures')) {
        const gltfs = Object.entries(files.gltf ?? {}).sort(([a], [b]) => resolutionOrder(a) - resolutionOrder(b))
            .map(([res, v]) => ({format: 'gltf', load_as: 'phmatgltf', resolution: res, url: v.gltf.url, size: v.gltf.size + Object.values(v.gltf.include ?? {}).reduce((n, f) => n + f.size, 0)}))
        const main = gltfs.find(f => f.resolution === MATERIAL_DEFAULT_RES) ?? gltfs[0]
        if (!main) continue
        yield {...polyHavenRow(id, info), kind: 'material', url: main.url, size: main.size, files: [{default: true, ...main}, ...gltfs.filter(f => f !== main)],
            // the maps it has (Diffuse, nor_gl, Rough, arm, AO, Displacement, ...), each at every resolution on Poly Haven
            extra: {maps: Object.keys(files).filter(k => !['blend', 'gltf', 'mtlx'].includes(k)).sort(), dimensions: info.dimensions}}
    }
}

/**
 * ambientCG's assets of a type, with their downloads. A download link (`ambientcg.com/get?file=`) redirects without a CORS
 * header, so a page can't load it: the file URL it redirects to is stored. That URL has a code per asset, the same for all
 * of its files, so one redirect is read per asset.
 */
async function ambientcgAssets(type) {
    const found = []
    for (let offset = 0; ; offset += 250) {
        const page = await getJson(`https://ambientcg.com/api/v2/full_json?type=${type}&limit=250&offset=${offset}&sort=Alphabet&include=downloadData,tagData,displayData,imageData`)
        found.push(...page.foundAssets)
        if (!page.foundAssets.length || found.length >= page.numberOfResults || args.limit && found.length >= parseInt(args.limit)) break
    }
    return pool(limited(found), 8, async a => {
        const downloads = a.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? []
        if (!downloads.length) return {a, downloads}
        const response = await fetch(downloads[0].downloadLink, {method: 'HEAD', redirect: 'manual', headers: API_HEADERS})
        const location = response.headers.get('location')
        const base = location ? location.slice(0, location.lastIndexOf('/') + 1) : undefined
        return {a, downloads: downloads.map(d => ({attribute: d.attribute, size: d.size, url: base ? base + d.fileName : d.downloadLink, page: d.downloadLink}))}
    })
}

const ambientcgRow = a => ({
    set_name: 'ambientcg', name: a.assetId, label: a.displayName ?? a.assetId, license: 'CC0-1.0',
    tags: [...new Set([a.displayCategory, ...a.tags ?? []].filter(Boolean).map(t => String(t).toLowerCase()))].filter(t => !/^\d+$/.test(t)),
    authors: ['ambientCG'], source_url: `https://ambientcg.com/view?id=${a.assetId}`, links: [], changes: null, linked: true, images: [],
    remoteImages: a.previewImage?.['1024-PNG'] ? [{label: 'preview', url: a.previewImage['1024-PNG']}] : [],
})
// the extension of threepipe's ambientCG zip loader (src/assetmanager/import), so viewer.load picks it for these zips
const AMBIENTCG_LOAD_AS = 'acgzip'

async function* ambientcgHdris() {
    for (const {a, downloads} of await ambientcgAssets('HDRI')) {
        const list = downloads.sort((x, y) => resolutionOrder(x.attribute) - resolutionOrder(y.attribute))
            .map(d => ({format: 'zip', load_as: AMBIENTCG_LOAD_AS, resolution: d.attribute.toLowerCase(), url: d.url, size: d.size}))
        const main = list.find(f => f.resolution === HDRI_DEFAULT_RES) ?? list[0]
        if (!main) continue
        yield {...ambientcgRow(a), kind: 'hdri', url: main.url, size: main.size, files: [{default: true, ...main}, ...list.filter(f => f !== main)],
            width: resolutionOrder(main.resolution) * 1024, height: resolutionOrder(main.resolution) * 512}
    }
}

async function* ambientcgMaterials() {
    for (const {a, downloads} of await ambientcgAssets('Material')) {
        // 1K-JPG, 2K-PNG, ...: the resolution and the image format of the maps
        const list = downloads.sort((x, y) => resolutionOrder(x.attribute) - resolutionOrder(y.attribute) || x.attribute.localeCompare(y.attribute))
            .map(d => ({format: 'zip', load_as: AMBIENTCG_LOAD_AS, resolution: d.attribute.split('-')[0].toLowerCase(), maps: d.attribute.split('-')[1]?.toLowerCase(), url: d.url, size: d.size}))
        const main = list.find(f => f.resolution === MATERIAL_DEFAULT_RES && f.maps === 'jpg') ?? list[0]
        if (!main) continue
        yield {...ambientcgRow(a), kind: 'material', url: main.url, size: main.size, files: [{default: true, ...main}, ...list.filter(f => f !== main)],
            extra: {maps: a.maps, dimensions: [a.dimensionX, a.dimensionY, a.dimensionZ].some(Boolean) ? {x: a.dimensionX, y: a.dimensionY, z: a.dimensionZ} : undefined}}
    }
}

/** A row for an HDRI or a material: everything is linked, and the render page makes its previews. */
function linkedRow(m, fields) {
    const {extra, remoteImages, files, width, height, ...rest} = fields
    const metadata = {...Object.fromEntries(Object.entries(extra ?? {}).filter(([, v]) => v !== undefined && v !== null))}
    return {...rest, kind: m.kind, metadata: JSON.stringify(metadata), screenshots: JSON.stringify(remoteImages ?? []), tags: JSON.stringify([...new Set(m.tags)].sort()),
        links: JSON.stringify(m.links ?? []), files: JSON.stringify(files), url: m.url, previews: `p/samples/${m.set_name}/${m.name}`, linked: true,
        size: m.size ?? null, triangles: null, poly: null, width, height, over_limit: false}
}

/** A research scene's image is in Git LFS, so the shallow clone has only a pointer to it. */
function researchThumbnail(id) {
    const dir = path.join(args.src, 'gltf-research-thumbnails')
    const file = path.join(dir, `${id}_thumbnail.png`)
    fs.mkdirSync(dir, {recursive: true})
    if (!fs.existsSync(file)) {
        try {
            run('curl', '-sSLf', '-o', file, `https://media.githubusercontent.com/media/ErfanMo77/gltf-research-scenes/${RESEARCH_TAG}/scenes/${id}/${id}_thumbnail.png`)
        } catch {
            return []
        }
    }
    return [{file, label: 'thumbnail'}]
}

function* research() {
    const dir = path.join(args.src, 'gltf-research-scenes')
    fetchRepo('https://github.com/ErfanMo77/gltf-research-scenes', dir, RESEARCH_TAG)
    const zipDir = path.join(args.src, 'gltf-research-scenes-glb')
    if (!fs.existsSync(zipDir)) {
        const zip = `${zipDir}.zip`
        run('curl', '-sSLf', '-o', zip, `https://github.com/ErfanMo77/gltf-research-scenes/releases/download/${RESEARCH_TAG}/gltf_research_scenes_glb.zip`)
        run('unzip', '-q', zip, '-d', zipDir)
        fs.rmSync(zip)
    }
    const scenes = path.join(zipDir, 'gltf_research_scenes/scenes')
    // the licenses in the table of the README: a conversion.yaml may only say "see source license file"
    const licenses = Object.fromEntries([...fs.readFileSync(path.join(dir, 'README.md'), 'utf8').matchAll(/^\| \[`([^`]+)`\][^|]*\|[^|]*\| ([^|]+?) \|/gm)].map(m => [m[1], m[2]]))
    for (const id of fs.readdirSync(scenes).sort()) {
        const gltf = path.join(scenes, id, 'gltf')
        if (!fs.existsSync(gltf)) continue // `common`: shared environment maps
        // the extended file has the material extensions threepipe supports; a scene without them has one file
        const glbs = fs.readdirSync(gltf).filter(f => f.endsWith('.glb'))
        const chosen = glbs.find(f => f.endsWith('_extended.glb')) ?? glbs.find(f => !f.endsWith('_core.glb')) ?? glbs[0]
        if (!chosen) continue
        const file = path.join(gltf, chosen)
        const yaml = fs.readFileSync(path.join(dir, 'scenes', id, 'gltf/conversion.yaml'), 'utf8')
        const {links, authors} = parseSceneReadme(fs.readFileSync(path.join(dir, 'scenes', id, 'README.md'), 'utf8'))
        yield {
            set_name: 'gltf-research-scenes', name: id, label: /^# (.+)$/m.exec(fs.readFileSync(path.join(dir, 'scenes', id, 'README.md'), 'utf8'))?.[1] ?? id,
            tags: ['research'], license: licenses[id] ?? /^\s*license:\s*"([^"]+)"/m.exec(yaml)?.[1], authors,
            source_url: `https://github.com/ErfanMo77/gltf-research-scenes/tree/${RESEARCH_TAG}/scenes/${id}`, links, file, changes: null,
            images: researchThumbnail(id),
        }
    }
}

/** Lets a file with an extension the library doesn't know be read, to measure it. The file is copied as it is, never written from this. */
class KnownOnlyByName extends Extension {
    read() { return this }
    write() { return this }
}
class KHRNodeVisibility extends KnownOnlyByName {
    extensionName = 'KHR_node_visibility'
    static EXTENSION_NAME = 'KHR_node_visibility'
}
const UNKNOWN_EXTENSIONS = [KHRNodeVisibility]

/** Under the upload limit: lossless first, then WebP textures, then meshopt geometry (it needs the decoder plugin to load). */
async function shrink(doc) {
    const steps = []
    await doc.transform(dedup(), prune())
    const size = async() => (await io.writeBinary(doc)).byteLength
    if (await size() > MAX_BYTES) {
        await doc.transform(textureCompress({encoder: sharp, targetFormat: 'webp', quality: 85}))
        steps.push('textures to WebP (quality 85)')
    }
    if (await size() > MAX_BYTES) {
        await doc.transform(meshopt({encoder: MeshoptEncoder, level: 'medium'}))
        steps.push('geometry with meshopt')
    }
    return steps
}

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
const io = new NodeIO(fetch).setAllowNetwork(true).registerExtensions([...ALL_EXTENSIONS, ...UNKNOWN_EXTENSIONS])
    .registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder, 'draco3d.decoder': await draco3d.createDecoderModule()})
fs.mkdirSync(args.out, {recursive: true})
const rows = [], failed = []
const textures = new Map(), links = new Set(), names = new Map(), paths = new Map()
const sets = {khronos, 'gltf-research-scenes': research, bucket, 'poly-haven': polyHaven, lists,
    'poly-haven-hdris': polyHavenHdris, 'poly-haven-materials': polyHavenMaterials, 'ambientcg-hdris': ambientcgHdris, 'ambientcg-materials': ambientcgMaterials}
for (const [set, list] of Object.entries(sets)) {
    if (args.set && args.set !== set) continue
    for await (const {file, ...m} of list()) {
        if (args.only && args.only !== m.name && args.only !== slugOf(m.name)) continue
        m.label ??= m.name
        m.name = slugOf(m.name)
        const unique = `${m.set_name}/${m.name.toLowerCase()}`
        if (names.has(unique)) throw new Error(`${m.set_name}/${m.name}: this name is already used by ${names.get(unique)}`)
        names.set(unique, m.label)
        const {images = [], linked, read, pack, extra, sourceZip, tileset, ...fields} = m
        delete fields.files // a row's files go into metadata, with its default file first
        delete fields.license_note // in metadata, for a file of a list
        try {
            if (m.kind === 'hdri' || m.kind === 'material') {
                rows.push(linkedRow(m, {...fields, files: m.files, extra}))
                continue
            }
            if (!/\.(glb|gltf)$/i.test(file)) {
                rows.push(addOther({...m, file, extra: extra ?? [], sourceZip, tileset}, fields))
                continue
            }
            const doc = await io.read(read ?? file)
            // a file saved from the viewer has its settings and camera, and maybe the credit of where it came from (Sketchfab)
            const raw = linked ? await rawJson(read ?? file) : undefined
            const firstScene = raw?.scenes?.[0]
            const saved = firstScene?.extensions?.WEBGI_viewer?.scene?.defaultCamera
            const credit = raw?.nodes?.[firstScene?.nodes?.[0]]?.extras?.gltfAsset?.extras
            if (credit?.license) fields.license = m.license = credit.license.split(' ')[0]
            if (credit?.author) fields.authors = m.authors = [credit.author]
            if (credit?.source) fields.source_url = m.source_url = credit.source
            const root = doc.getRoot()
            // a GLB directly under its set; the files of a glTF stay together, as in the source
            const several = !linked && !pack && file.endsWith('.gltf')
            const modelPath = linked ? file.slice(SAMPLES.length + 1) : several ?
                `${m.set_name}/${m.name}/${path.basename(path.dirname(file))}/${path.basename(file)}` : `${m.set_name}/${slugOf(path.parse(file).name)}.glb`
            const usedPath = modelPath.toLowerCase() // a case-only difference is one file on a Mac disk
            if (paths.has(usedPath)) throw new Error(`${modelPath}: this path is already used by ${paths.get(usedPath)}`)
            paths.set(usedPath, m.name)
            const url = linked ? file : `${SAMPLES}/${modelPath.split('/').map(encodeURIComponent).join('/')}`
            const previews = `p/samples/${modelPath.replace(/(\.glb)?\.[^./]+$/, '').split('/').map(slugOf).join('/')}`
            const dest = path.join(args.out, 'samples', modelPath)
            if (several) fs.cpSync(path.dirname(file), path.dirname(dest), {recursive: true})
            else if (pack) { // one GLB with WebP textures, from a glTF of several files
                fs.mkdirSync(path.dirname(dest), {recursive: true})
                await doc.transform(dedup(), prune(), textureCompress({encoder: sharp, targetFormat: 'webp', quality: 85}))
                fs.writeFileSync(dest, await io.writeBinary(doc))
            } else if (!linked) {
                fs.mkdirSync(path.dirname(dest), {recursive: true})
                fs.copyFileSync(file, dest)
            }
            if (!linked && !several && fs.statSync(dest).size > MAX_BYTES) {
                const was = fs.statSync(dest).size
                const steps = await shrink(doc)
                fs.writeFileSync(dest, await io.writeBinary(doc))
                m.changes = fields.changes = `compressed to fit the upload limit, ${(was / 1e6).toFixed(0)} to ${(fs.statSync(dest).size / 1e6).toFixed(0)} MB: ${steps.join(', ')}`
            }
            // a glTF is several files: all of them; a linked one is measured as the same model in one file
            const sizes = several ? fs.readdirSync(path.dirname(dest), {recursive: true, withFileTypes: true}).filter(f => f.isFile()).map(f => fs.statSync(path.join(f.parentPath, f.name)).size) : []
            const size = several ? sizes.reduce((n, v) => n + v, 0) :
                !linked ? fs.statSync(dest).size : file.endsWith('.gltf') ? (await io.writeBinary(doc)).byteLength :
                    parseInt((await fetch(file, {method: 'HEAD'})).headers.get('content-length'))
            // the upload limit is per file, and a linked model isn't uploaded
            const overLimit = !linked && (several ? Math.max(...sizes) : size) > MAX_BYTES
            const screenshots = images.map(({file: image, label}) => {
                const name = slugOf(path.basename(image))
                fs.mkdirSync(path.join(args.out, previews), {recursive: true})
                fs.copyFileSync(image, path.join(args.out, previews, name))
                return {label, url: `${FILES}/${previews}/${name}`, size: fs.statSync(image).size}
            })
            const triangles = sceneTriangles(root)
            // every file of the asset, the default one first; other versions, levels of detail and formats add entries
            const files = [{default: true, format: file.endsWith('.gltf') && !pack ? 'gltf' : 'glb', url, size, triangles}, ...m.files ?? []]
            const broken = BROKEN[modelPath]
            const tags = [...new Set([...tagsOf(m.tags, root), ...fileTags(files), ...broken ? ['broken'] : []])].sort()
            rows.push({...fields, metadata: JSON.stringify({views: viewsOf(root, m.name, saved), ...animationsOf(root), ...broken ? {broken} : {}, ...m.license_note ? {license_note: m.license_note} : {}}), screenshots: JSON.stringify(screenshots), tags: JSON.stringify(tags), links: JSON.stringify(m.links), files: JSON.stringify(files), kind: 'model', url, previews, linked, size, triangles,
                vertices: root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((v, p) => v + (p.getAttribute('POSITION')?.getCount() ?? 0), 0), 0), meshes: root.listMeshes().length, materials: root.listMaterials().length,
                textures: root.listTextures().length, animations: root.listAnimations().length,
                extensions: JSON.stringify(root.listExtensionsUsed().map(e => e.extensionName)), poly: polyClass(triangles), over_limit: overLimit})
            rows.push(...await addTextures(root, {...m, url}, textures, links))
        } catch (e) {
            failed.push({set: m.set_name, name: m.name, error: String(e.message ?? e).slice(0, 160)})
        }
    }
}
const linkRows = [...links].map(l => {
    const [from_asset, relation, to_asset] = l.split('|')
    return {from_asset, relation, to_asset}
})
// what isn't a column goes into `metadata`; `animations` there is the list of clips, so its count stays out
const IN_METADATA = ['links', 'changes', 'screenshots', 'files', 'vertices', 'meshes', 'materials', 'textures', 'extensions', 'width', 'height']
const JSON_VALUES = new Set(['links', 'screenshots', 'files', 'extensions'])
const written = rows.map(({animations: _count, ...row}) => {
    const metadata = JSON.parse(row.metadata ?? '{}')
    for (const key of IN_METADATA) {
        const value = JSON_VALUES.has(key) && row[key] ? JSON.parse(row[key]) : row[key]
        delete row[key]
        if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)) metadata[key] = value
    }
    // json columns take JSON text (teenybase 0.1.1 refuses arrays and objects as values)
    return {...row, authors: row.authors?.length ? JSON.stringify(row.authors) : null, metadata: JSON.stringify(metadata)}
})
fs.writeFileSync(path.join(args.out, 'catalog.json'), JSON.stringify({rows: written, links: linkRows, failed}, null, 2))

const tagCounts = {}
for (const r of rows) for (const t of JSON.parse(r.tags)) tagCounts[t] = (tagCounts[t] ?? 0) + 1
console.log('tags', Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).join('  '))
const count = key => Object.entries(rows.reduce((a, r) => (a[r[key]] = (a[r[key]] ?? 0) + 1, a), {})).sort((a, b) => b[1] - a[1])
console.log(`assets ${rows.length}, links ${linkRows.length}, ${(rows.reduce((n, r) => n + r.size, 0) / 1e6).toFixed(0)} MB, failed ${failed.length}`)
const shots = rows.flatMap(r => JSON.parse(r.screenshots ?? '[]'))
console.log(`screenshots ${shots.length}, ${(shots.reduce((n, x) => n + x.size, 0) / 1e6).toFixed(0)} MB, models without any: ${rows.filter(r => r.kind === 'model' && !JSON.parse(r.screenshots).length).map(r => r.name).join(' ') || 'none'}`)
console.log('kinds', count('kind').join('  '))
console.log('sets', count('set_name').join('  '))
console.log('poly', count('poly').join('  '))
console.log('licenses', count('license').join('  '))
console.log('no license:', rows.filter(r => !r.license).map(r => r.name).join(' ') || 'none')
console.log('over the upload limit:', rows.filter(r => r.over_limit).map(r => `${r.name} ${(r.size / 1e6).toFixed(0)} MB`).join(', ') || 'none')
console.log('failed:', failed.map(f => `${f.name}: ${f.error}`).join('\n  ') || 'none')
