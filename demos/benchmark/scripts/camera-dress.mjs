// R3 + R4 on the camera (16-realism.md §3.4): the re-blocked camera with its controls, lens rings, eyecup and lugs
// rebuilt from @threepipe/modelling-parts, surface presets with relief maps, and printed markings as decals.
// Positions are the transcript's own (the measured controls of §3.3); prints are generic type, not logotypes.
//
//   node demos/benchmark/scripts/camera-dress.mjs [camera-reblock.json] [out.json]
//   node plugins/modelling-cli/dist/cli.mjs run <out.json> --doc <out.glb> --browser   # textures need a browser
import {readFileSync, writeFileSync} from 'node:fs'
import {ringLabels, ringText, scaleLabels, wordmark} from '../../../plugins/modelling-cli/dist/index.mjs'

const src = JSON.parse(readFileSync(process.argv[2] ?? 'tmp/realism/reblock/camera-reblock.json', 'utf8'))
const outPath = process.argv[3] ?? 'tmp/realism/dress/camera-dress.json'
const PI = Math.PI, toZ = [PI / 2, 0, 0], toMinusZ = [-PI / 2, 0, 0]
const LENS = [15.5, 48]   // lens axis (x, y); it runs along +z

// ------------------------------------------------------------------ the parts that replace hand-made ones
const replaced = new Set(['lens-focus-ring', 'lens-zoom-ring', 'dial-mode', 'dial-main', 'dial-quick', 'btn-set',
    'btn-rear-column', 'btn-menu', 'btn-af', 'btn-q', 'btn-start', 'btn-joystick', 'btn-top', 'btn-mfn', 'btn-release',
    'btn-front', 'eyecup', 'lug', 'lens-red-ring', 'rubber-thumb'])
const named = c => [c.name, typeof c.object === 'string' ? c.object : null].filter(Boolean)
const gone = o => replaced.has(o) || (o.endsWith('*') && replaced.has(o.slice(0, -1)))
const kept = src.map(c => Array.isArray(c.object) ? {...c, object: c.object.filter(o => !gone(o))} : c).filter(c => {
    if (Array.isArray(c.object) && !c.object.length) return false
    if (named(c).some(gone)) return false
    // the demo film's close-up wireframes (duplicate, wireframe, delete) leave nothing in the model
    if (named(c).some(n => n.startsWith('edges-'))) return false
    if (c.op === 'modifier' && c.object === 'lug') return false
    if (c.op === 'shade' || (c.op === 'modifier' && c.add?.type === 'weightedNormal')) return false // re-added at the end
    return true
})

const part = (type, name, params, position, rotation) => ({op: 'part', type, name, params, position, ...(rotation ? {rotation} : {})})
const button = (name, x, y, z, r, h, rot, extra = {}) => part('product/button', name, {radius: r, height: h, ...extra}, [x, y, z], rot)
const parts = [
    // lens rings: real ribs, the ref's focus ring is fine-ribbed, the zoom ring coarser
    part('product/knurled-ring', 'lens-focus-ring', {radius: 38.7, innerRadius: 36.9, length: 13.8, ribs: 96, ribDepth: 0.55, ribWidth: 0.5, chamfer: 0.5}, [...LENS, 96.8], toZ),
    part('product/knurled-ring', 'lens-zoom-ring', {radius: 41.75, innerRadius: 40.3, length: 19, ribs: 64, ribDepth: 0.8, ribWidth: 0.55, chamfer: 0.6}, [...LENS, 144.2], toZ),
    // top: mode dial with its lock button, main dial rolling front to back
    part('product/dial', 'dial-mode', {radius: 11.25, height: 8.7, ribs: 60, ribDepth: 0.4, lockRadius: 4.6, lockHeight: 1.4}, [56, 88.2, 23]),
    part('product/dial', 'dial-main', {radius: 7.5, height: 6, ribs: 36, ribDepth: 0.45, topChamfer: 0.5, skirt: 0.4}, [-55.3, 83.4, 43], toZ),
    // rear: quick control dial round SET
    part('product/knurled-ring', 'dial-quick', {radius: 15, innerRadius: 8.4, length: 2.9, ribs: 56, ribDepth: 0.45, chamfer: 0.5}, [-36.4, 27.3, 0.3], toMinusZ),
    button('btn-set', -36.4, 27.3, 0, 6.4, 2.2, toMinusZ, {dome: 0.25}),
    ...[0, 1, 2, 3, 4].map(k => button(`btn-rear-column.${k}`, 64.8, 64.9 - 11.87 * k, 0, 3.5, 1.8, toMinusZ, {dome: 0.2})),
    button('btn-menu.0', 62.2, 79.5, 0, 3.3, 1.8, toMinusZ, {dome: 0.2}),
    button('btn-menu.1', 50.9, 79.5, 0, 3.3, 1.8, toMinusZ, {dome: 0.2}),
    ...[0, 1, 2].map(k => button(`btn-af.${k}`, -44.2 - 10.15 * k, 84.3 - 3.2 * k, 0, 3, 1.8, toMinusZ, {dome: 0.25})),
    button('btn-q', -24.8, 46.6, 0, 3.3, 1.6, toMinusZ, {dome: 0.15}),
    button('btn-start', -21.3, 78.7, 0, 5, 1.6, toMinusZ, {dome: 0.2, collar: 0.9}),
    button('btn-joystick', -28.6, 62.7, 0, 4.5, 2.6, toMinusZ, {dome: 0.9, chamfer: 1.2}),
    // top plate buttons and M-Fn
    ...[0, 1, 2, 3].map(k => button(`btn-top.${k}`, -54.4 + 9.667 * k, 88.8, 33, 3.25, 3.2, null, {dome: 0.3})),
    button('btn-mfn', -45, 88.8, 53, 2.5, 2, null, {dome: 0.2}),
    // front: lens release and the two front buttons
    button('btn-release', 59.5, 50, 57.7, 4.6, 3.4, toZ, {dome: 0.4, collar: 0.8}),
    button('btn-front.0', -19.5, 21, 57.7, 4, 2.2, toZ, {dome: 0.3}),
    button('btn-front.1', -19.5, 34, 57.7, 4, 2.2, toZ, {dome: 0.3}),
    // eyecup: rubber frame round the eyepiece, standing 10.4 out of the rear
    part('product/eyecup', 'eyecup', {width: 54, height: 35.6, depth: 10.4, radius: 14, windowWidth: 33, windowHeight: 24, windowRadius: 4, windowDepth: 8.8, flare: 1.6}, [15.5, 90, 0.2], toMinusZ),
    // the lens bore: a matte baffle and an inner element behind the front glass, so the glass shows a dark,
    // reflective interior instead of the chrome mount through an empty tube
    part('product/lens-barrel', 'lens-baffle', {stations: [[22.6, 0], [22.6, 1.2]], segments: 64}, [...LENS, 150], toZ),
    // inner elements wider than the bore (r 22.5), so their edges sit inside the barrel and only their faces show
    part('product/lens-barrel', 'lens-inner-element', {stations: [[24, 0], [26, 1.5], [26, 3], [24, 4.5]], segments: 64}, [...LENS, 156], toZ),
    part('product/lens-barrel', 'lens-inner-element-2', {stations: [[24, 0], [26, 1.8], [26, 3.2], [24, 5]], segments: 64}, [...LENS, 162], toZ),
    // a matte retaining ring just behind the front element: its edge is what the eye finds through the glass
    part('product/lens-barrel', 'lens-retainer', {stations: [[33.4, 0], [33.4, 1.2]], bore: 29.5, segments: 96}, [...LENS, 169.2], toZ),
    // the red ring: a raised band with crisp edges, proud of the barrel
    part('product/lens-barrel', 'lens-red-ring', {stations: [[41.7, 0], [42.05, 0.15], [42.05, 1.15], [41.7, 1.3]], bore: 41.2, segments: 128}, [...LENS, 168.2], toZ),
    // the rubber thumb rest on the rear, wrapping the quick dial, the multi-controller, Q and START (holes cut below)
    part('product/pad', 'rubber-thumb', {outline: [[-73.5, -72], [-73.5, -9], [-46, -8], [-22, -10], [-18, -30], [-18, -52], [-22, -70], [-40, -73]],
        thickness: 1.3, round: 0.8, smooth: 3, samples: 140}, [0, 0, 0.3], toMinusZ),
    {op: 'primitive', type: 'cylinder', name: 'cut-pad-dial', axis: 'z', radius: 16.6, height: 8, position: [-36.4, 27.3, -2]},
    {op: 'primitive', type: 'cylinder', name: 'cut-pad-joy', axis: 'z', radius: 6.4, height: 8, position: [-28.6, 62.7, -2]},
    {op: 'primitive', type: 'cylinder', name: 'cut-pad-q', axis: 'z', radius: 4.4, height: 8, position: [-24.8, 46.6, -2]},
    {op: 'primitive', type: 'cylinder', name: 'cut-pad-start', axis: 'z', radius: 6.7, height: 8, position: [-21.3, 78.7, -2]},
    {op: 'boolean', object: 'rubber-thumb', with: 'cut-pad-*'},
    // eyecup inner frame: a thin hard bezel at the bottom of the window
    part('product/eyecup', 'eyepiece-frame', {width: 31, height: 23, depth: 1.6, radius: 4, windowWidth: 22, windowHeight: 14, windowRadius: 2.5, windowDepth: 1.4, flare: 0.3}, [15.5, 90, -1.3], toMinusZ),
    // strap lugs on both sides, at the measured height
    part('product/strap-lug', 'lug.0', {width: 11, height: 5.2, wire: 1.3}, [74.6, 72.8, 30]),
    part('product/strap-lug', 'lug.1', {width: 11, height: 5.2, wire: 1.3}, [-74.6, 72.8, 30], [0, PI, 0]),
]

// ------------------------------------------------------------------ surfaces
const uv = (object, size) => ({op: 'uv', object, size})
const mat = (object, preset, extra = {}) => ({op: 'material', object, preset, ...extra})
const surfaces = [
    // one UV unit = one relief tile at its designed size (RELIEF_TILE_MM): plastic grain 8, leather 14, rubber 6
    uv(['body', 'body-prism', 'lens-barrel', 'lens-mount', 'mount-boss'], 8),
    uv(['grip'], 14),
    uv(['rubber-thumb', 'lens-focus-ring', 'lens-zoom-ring', 'eyecup'], 6),
    mat(['body', 'body-prism', 'mount-boss'], 'plastic-satin-black'),
    mat('grip', 'leather-black'),
    mat('rubber-thumb', 'rubber-matte'),
    mat('eyepiece-frame', 'plastic-gloss-black'),
    mat('lens-retainer', 'matte-black'),
    mat('lens-barrel', 'plastic-satin-black', {roughness: 0.3}),
    mat(['lens-focus-ring', 'lens-zoom-ring'], 'rubber'),
    mat('eyecup', 'rubber-matte'),
    mat(['dial-*', 'btn-*', 'eyepiece', 'lens-switch-*'], 'plastic-gloss-black'),
    mat(['mount-flange', 'lug.*', 'lens-mount'], 'chrome'),
    mat('shoe', 'metal-satin'),
    mat('shoe-contact', 'gold-contact'),
    mat('lens-red-ring', 'accent-red', {roughness: 0.35}),
    mat('mount-index', 'accent-red'),
    mat('lens-front-element', 'glass-coated'),
    // inner elements: their coatings tint the reflections green and magenta
    mat('lens-inner-element', 'glass-coated', {color: '#d6f0de'}),
    mat('lens-inner-element-2', 'glass-coated', {color: '#ecd6ef'}),
    mat('lens-baffle', 'matte-black'),
    // the monitor shows its screen as a print over an opaque glossy panel: on a transmissive one the print vanished
    mat('lcd-screen', 'plastic-gloss-black', {roughness: 0.1}),
    mat('top-lcd-glass', 'screen-glass'),
    mat('eyepiece-glass', 'screen-glass'),
]

// ------------------------------------------------------------------ prints
const decal = (name, p) => ({op: 'decal', name, ...p})
const text = (t, extra = {}) => ({text: {text: t, color: '#ffffff', ...extra}})
const prismN = (() => { const l = Math.hypot(22, 21); return [0, 22 / l, 21 / l] })()
const prismUp = [0, prismN[2], -prismN[1]]
const svgIcon = (body, w = 64, h = 64) => ({svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`})
// legends are dropped onto their button's domed cap
const rearLegend = (name, x, y, content, w = 5.2, h = 1.9, button) =>
    decal(name, {mode: 'project', object: button, at: [x, y, -2], normal: [0, 0, -1], up: [0, 1, 0], size: [w, h], content, offset: 0.03, pxPerUnit: 48, segments: [4, 2]})

const lcdUi = `<svg xmlns="http://www.w3.org/2000/svg" width="1352" height="902" viewBox="0 0 1352 902">
<rect width="1352" height="902" fill="#06080b"/>
<g font-family="Helvetica, Arial, sans-serif" fill="#e9eef2">
<rect x="40" y="40" width="110" height="110" fill="none" stroke="#c9b37a" stroke-width="5"/><text x="95" y="122" font-size="84" text-anchor="middle">M</text>
<text x="210" y="122" font-size="54">-3..2..1..0..1..2..+3</text><text x="1300" y="122" font-size="56" text-anchor="end">04/01 23:59</text>
<text x="120" y="300" font-size="74">F4.0</text><text x="120" y="450" font-size="74">1/250</text><text x="120" y="600" font-size="74">ISO 100</text>
<g fill="none" stroke="#e9eef2" stroke-width="4"><rect x="760" y="300" width="400" height="260"/><rect x="900" y="330" width="120" height="200"/></g>
<rect x="60" y="760" width="300" height="70" fill="#3a3f45"/><text x="210" y="808" font-size="44" text-anchor="middle">RAW</text>
<rect x="420" y="760" width="300" height="70" fill="#3a3f45"/><text x="570" y="808" font-size="44" text-anchor="middle">AF ONE SHOT</text>
<text x="1290" y="808" font-size="44" text-anchor="end">[ 640 ]</text></g></svg>`
const topLcd = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="480" viewBox="0 0 1120 480">
<rect width="1120" height="480" fill="#7f8c7a"/><g font-family="'Courier New', monospace" font-weight="bold" fill="#1d231c">
<text x="60" y="190" font-size="150">250</text><text x="520" y="190" font-size="150">4.0</text>
<text x="60" y="400" font-size="90">ISO 100</text><text x="640" y="400" font-size="90">[ 640 ]</text></g></svg>`

const prints = [
    // front: maker word mark on the prism, model badge right of the mount (x 51..67, y 67..83 in the front photo)
    decal('decal-front-canon', {mode: 'project', object: 'body-prism', at: [15, 101.4, 63], normal: prismN, up: prismUp, size: [29, 6.5],
        content: {svg: wordmark({width: 696, height: 156, text: 'Canon'})}, segments: [12, 3]}),
    decal('decal-front-badge', {mode: 'project', object: 'body', at: [59, 75, 58], normal: [0, 0, 1], size: [15, 14],
        content: {svg: wordmark({width: 360, height: 336, text: 'EOS', sub: '5D Mark IV', family: 'sans', weight: 'normal'})}, segments: [6, 6]}),
    // rear: maker name under the monitor, the monitor's shooting screen, legends on the buttons
    decal('decal-rear-canon', {mode: 'plane', at: [20.9, 11.7, -0.05], normal: [0, 0, -1], size: [22, 4.6],
        content: {svg: wordmark({width: 528, height: 110, text: 'Canon'})}}),
    decal('decal-lcd-ui', {mode: 'plane', at: [20.2, 40.95, 0.6], normal: [0, 0, -1], size: [67.6, 45.1], content: {svg: lcdUi}, offset: 0, preset: 'print-white', roughness: 0.15}),
    rearLegend('decal-btn-menu', 62.2, 79.5, text('MENU', {fit: true, fontWeight: 'bold'}), 5.2, 1.9, 'btn-menu.0'),
    rearLegend('decal-btn-info', 50.9, 79.5, text('INFO.', {fit: true, fontWeight: 'bold'}), 5.2, 1.9, 'btn-menu.1'),
    rearLegend('decal-btn-col0', 64.8, 64.9, svgIcon('<rect x="14" y="14" width="36" height="36" fill="none" stroke="#fff" stroke-width="6"/><path d="M22 42 L42 22" stroke="#fff" stroke-width="6"/>'), 3.6, 3.6, 'btn-rear-column.0'),
    rearLegend('decal-btn-col1', 64.8, 53.03, text('RATE', {fit: true}), 4.6, 1.7, 'btn-rear-column.1'),
    rearLegend('decal-btn-col2', 64.8, 41.16, svgIcon('<circle cx="28" cy="28" r="14" fill="none" stroke="#fff" stroke-width="6"/><path d="M38 38 L52 52" stroke="#fff" stroke-width="7"/>'), 3.6, 3.6, 'btn-rear-column.2'),
    rearLegend('decal-btn-col3', 64.8, 29.29, svgIcon('<rect x="10" y="12" width="44" height="40" fill="none" stroke="#fff" stroke-width="5"/><path d="M26 22 L42 32 L26 42 Z" fill="#fff"/>'), 3.8, 3.8, 'btn-rear-column.3'),
    rearLegend('decal-btn-col4', 64.8, 17.42, svgIcon('<path d="M16 18 H48 M22 18 V52 H42 V18 M28 12 H36" fill="none" stroke="#fff" stroke-width="5"/>'), 3.6, 3.6, 'btn-rear-column.4'),
    rearLegend('decal-btn-set', -36.4, 27.3, text('SET', {fit: true, fontWeight: 'bold'}), 5.4, 2.4, 'btn-set'),
    rearLegend('decal-btn-q', -24.8, 46.6, svgIcon('<rect x="10" y="10" width="44" height="44" rx="6" fill="none" stroke="#fff" stroke-width="5"/><text x="32" y="44" font-size="34" font-family="Helvetica" font-weight="bold" fill="#fff" text-anchor="middle">Q</text>'), 3.6, 3.6, 'btn-q'),
    rearLegend('decal-btn-start', -21.3, 78.7, svgIcon('<text x="64" y="44" font-size="34" font-family="Helvetica" font-weight="bold" fill="#fff" text-anchor="middle">START/</text><text x="64" y="84" font-size="34" font-family="Helvetica" font-weight="bold" fill="#fff" text-anchor="middle">STOP</text>', 128, 100), 5.6, 4.4, 'btn-start'),
    // the port doors on the +x side: their legends
    decal('decal-port-a', {mode: 'project', object: 'body', at: [76, 62, 26], normal: [1, 0, 0], up: [0, 1, 0], size: [16, 8],
        content: {svg: wordmark({width: 384, height: 192, text: 'MIC', sub: 'HDMI', family: 'sans', weight: 'bold'})}, segments: [2, 2]}),
    decal('decal-port-b', {mode: 'project', object: 'body', at: [76, 26, 26], normal: [1, 0, 0], up: [0, 1, 0], size: [16, 8],
        content: {svg: wordmark({width: 384, height: 192, text: 'USB', sub: 'PC', family: 'sans', weight: 'bold'})}, segments: [2, 2]}),
    // top: the mode dial's legends round its top, the top LCD's segment display
    decal('decal-dial-mode', {mode: 'plane', at: [56, 96.95, 23], normal: [0, 1, 0], up: [0, 0, 1], size: [21.5, 21.5],
        content: {svg: ringLabels({size: 860, labels: ['M', 'B', 'C1', 'C2', 'C3', 'A+', 'P', 'Tv', 'Av'], radius: 0.8, fontScale: 0.085,
            color: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#3fc96b', '#ffffff', '#ffffff', '#ffffff']})}, offset: 0.03}),
    decal('decal-top-lcd', {mode: 'plane', at: [-37, 89.72, 15], normal: [0, 1, 0], up: [0, 0, 1], size: [45.5, 19.5], content: {svg: topLcd}, offset: 0, roughness: 0.2}),
    // lens: the word mark round the barrel, the focal-length scale behind the zoom ring, the front ring legend
    decal('decal-lens-canon', {mode: 'wrap', at: [LENS[0] - 39.7, LENS[1], 125], up: [0, 0, -1], size: [28, 6.5], wrap: {axis: [0, 0, 1], center: [...LENS, 0]},
        content: {svg: wordmark({width: 672, height: 156, text: 'Canon', color: '#d83a2e'})}, segments: [24, 2], preset: 'accent-red'}),
    decal('decal-lens-focal', {mode: 'wrap', at: [LENS[0], LENS[1] + 41, 141.7], up: [0, 0, 1], size: [52, 3.2], wrap: {axis: [0, 0, 1], center: [...LENS, 0]},
        content: {svg: scaleLabels({width: 1248, height: 77, marks: [[0.06, '105'], [0.3, '70'], [0.52, '50'], [0.73, '35'], [0.93, '24']], color: '#ffffff', fontScale: 0.62})}, segments: [24, 1]}),
    // the front legend sits on the bezel that slopes from the rim down to the front element (r 33.6 to 38.5)
    decal('decal-lens-front', {mode: 'project', object: 'lens-barrel', at: [...LENS, 181], normal: [0, 0, 1], up: [0, 1, 0], size: [78, 78],
        content: {svg: ringText({size: 1560, text: 'CANON ZOOM LENS EF 24-105mm 1:4 L IS USM   \u00d877mm', radius: 0.87, fontScale: 0.052, letterSpacing: 0.05, at: 180})}, offset: 0.04, segments: [64, 64],
        // raised silver type, as the lens has
        emboss: 5, metalness: 0.9, roughness: 0.3}),
]

// panel lines: real grooves with a dark strip in them, round the port doors, the monitor and the thumb rest
const groove = (object, name, outline, width = 0.55) => ({op: 'groove', object, name, outline, width, depth: 0.45, fill: true})
const grooves = [
    groove('body', 'gap-port-a', {at: [75.7, 58, 26], normal: [1, 0, 0], up: [0, 1, 0], size: [22, 30], radius: 2.5}),
    groove('body', 'gap-port-b', {at: [75.5, 24, 26], normal: [1, 0, 0], up: [0, 1, 0], size: [22, 22], radius: 2.5}),
    groove('body', 'gap-monitor', {at: [20.2, 40.95, 0], normal: [0, 0, -1], up: [0, 1, 0], size: [78, 55], radius: 3}),
]

const finish = [
    {op: 'shade', object: '*', mode: 'byAngle'},
    ...['lens-switch-panel', 'lens-switch-0', 'lens-switch-1', 'shoe', 'rubber-thumb', 'eyepiece']
        .map(object => ({op: 'modifier', object, add: {type: 'weightedNormal', weight: 100, keepSharp: true}})),
]
// prints are smooth quad grids; shading them by angle would not change them, but keep them out of '*'-wide edits
// Two transcripts: the geometry runs anywhere (Node is fast); surfaces and prints need a browser for their textures,
// so they run on the saved geometry: `run geometry --node`, then `run dress --doc <that glb> --browser`.
const out = [...kept, ...parts, ...grooves, ...finish, ...surfaces, ...prints]
writeFileSync(outPath, JSON.stringify(out))
writeFileSync(outPath.replace(/\.json$/, '-geometry.json'), JSON.stringify([...kept, ...parts, ...grooves, ...finish]))
writeFileSync(outPath.replace(/\.json$/, '-surface.json'), JSON.stringify([...surfaces, ...prints]))
console.log(JSON.stringify({commands: out.length, kept: kept.length, parts: parts.length, surfaces: surfaces.length, prints: prints.length}))
