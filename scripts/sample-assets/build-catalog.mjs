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
import {execFileSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'
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
            links: '[]', variants: '[]', changes: `taken from the model ${model.name}`, url: model.url,
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
        out[name] = {license, authors: copy ? [...copy.matchAll(/"([^"]+)"/g)].map(m => m[1]).join('; ') : undefined}
    }
    return out
}

/** The links and author in the Source section of a research scene's README. */
function parseSceneReadme(text) {
    const section = /## Source\n([\s\S]*?)(?:\n## |$)/.exec(text)?.[1] ?? ''
    const links = [...section.matchAll(/^- ([^:\n]+): \[[^\]]*\]\((https?:[^)]+)\)/gm)].map(m => ({label: m[1], url: m[2]}))
    return {links, authors: /^- Original author: (.+)$/m.exec(section)?.[1]}
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
            // the other versions Khronos has (Draco, KTX, ...), read from its repository
            images: imagesIn(path.join(dir, 'Models', m.name, 'screenshot'), f => f.replace(IMAGE, '').replace(/^screenshot-?/, '') || 'screenshot'),
            variants: Object.entries(m.variants).filter(([v]) => v !== variant).map(([v, f]) => ({
                name: v, url: `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${sha}/Models/${m.name}/${v}/${f}`,
            })),
        }
    }
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
            authors: Object.entries(info.authors ?? {}).map(([name, role]) => `${name} (${role})`).join('; ') || undefined,
            source_url: `https://polyhaven.com/a/${id}`, links: [], file, pack: true,
            changes: `packed to one GLB from the ${POLY_HAVEN_RES} glTF, textures to WebP (quality 85)`,
            images: fs.existsSync(thumb) && fs.statSync(thumb).size > 1024 ? [{file: thumb, label: 'thumbnail'}] : [],
            variants: Object.entries(gltfs).map(([res, v]) => ({name: `${res} glTF (original)`, url: v.gltf.url})),
        }
    }
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
const sets = {khronos, 'gltf-research-scenes': research, bucket, 'poly-haven': polyHaven}
for (const [set, list] of Object.entries(sets)) {
    if (args.set && args.set !== set) continue
    for (const {file, ...m} of list()) {
        if (args.only && args.only !== m.name && args.only !== slugOf(m.name)) continue
        m.label ??= m.name
        m.name = slugOf(m.name)
        const unique = `${m.set_name}/${m.name.toLowerCase()}`
        if (names.has(unique)) throw new Error(`${m.set_name}/${m.name}: this name is already used by ${names.get(unique)}`)
        names.set(unique, m.label)
        const {images = [], linked, read, pack, ...fields} = m
        try {
            const doc = await io.read(read ?? file)
            // a file saved from the viewer has its settings and camera, and maybe the credit of where it came from (Sketchfab)
            const raw = linked ? await rawJson(read ?? file) : undefined
            const firstScene = raw?.scenes?.[0]
            const saved = firstScene?.extensions?.WEBGI_viewer?.scene?.defaultCamera
            const credit = raw?.nodes?.[firstScene?.nodes?.[0]]?.extras?.gltfAsset?.extras
            if (credit?.license) fields.license = m.license = credit.license.split(' ')[0]
            if (credit?.author) fields.authors = m.authors = credit.author
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
            rows.push({...fields, metadata: JSON.stringify({views: viewsOf(root, m.name, saved), ...animationsOf(root)}), screenshots: JSON.stringify(screenshots), tags: JSON.stringify(tagsOf(m.tags, root)), links: JSON.stringify(m.links), variants: JSON.stringify(m.variants ?? []), kind: 'model', url, previews, linked, size, triangles,
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
const IN_METADATA = ['links', 'changes', 'screenshots', 'variants', 'vertices', 'meshes', 'materials', 'textures', 'extensions', 'width', 'height']
const JSON_VALUES = new Set(['links', 'screenshots', 'variants', 'extensions'])
const written = rows.map(({animations: _count, ...row}) => {
    const metadata = JSON.parse(row.metadata ?? '{}')
    for (const key of IN_METADATA) {
        const value = JSON_VALUES.has(key) && row[key] ? JSON.parse(row[key]) : row[key]
        delete row[key]
        if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)) metadata[key] = value
    }
    return {...row, metadata: JSON.stringify(metadata)}
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
