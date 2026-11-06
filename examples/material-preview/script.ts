import {
    _testFinish,
    _testStart,
    Color,
    IMaterial,
    IObject3D,
    LoadingScreenPlugin,
    MaterialPreview,
    MaterialPreviewHandle,
    MaterialPreviewPlugin,
    MaterialPreviewShape,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// A material inspector with MaterialPreviewPlugin: every material of a model is in the panel with its live preview.
// Click a material, or an object in the viewport, to select it: its settings show in the Tweakpane UI, and its large
// preview follows each change in the next frame, or at most every dragInterval ms while a slider moves or the colour
// animates ("Animate colour"). The counters show the renders and the cached previews.

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, MaterialPreviewPlugin, PickingPlugin],
})

const previews = viewer.getPlugin(MaterialPreviewPlugin)!
const picking = viewer.getPlugin(PickingPlugin)!
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

/** The first mesh of each material, for the "This mesh" shape */
const users = new Map<IMaterial, IObject3D>()
let shape: MaterialPreviewShape = 'sphere'
let selected: IMaterial | undefined

// the counters: a preview seen before is a cached one
const seen = new WeakSet<MaterialPreview>()
const stats = {renders: 0, cached: 0, last: 0}
function count(p: MaterialPreview) {
    if (seen.has(p)) stats.cached++
    else {
        seen.add(p)
        stats.renders++
        stats.last = p.renderTime
    }
    document.getElementById('stats')!.textContent =
        `${stats.renders} renders · ${stats.cached} from the cache · last ${stats.last.toFixed(1)} ms · waiting ${previews.pending}`
}

/**
 * Follows a material: a preview now, and a new one on each change of the material. Returns the function that stops it.
 * The plugin renders in the next frame, and at most every dragInterval ms while the material changes continuously.
 */
function watch(material: IMaterial, size: number, draw: (p: MaterialPreview) => void) {
    let handle: MaterialPreviewHandle | undefined
    const request = () => {
        handle?.cancel()
        const geometry = shape === 'mesh' ? (users.get(material) as any)?.geometry : undefined
        handle = previews.request(material, {shape, geometry, size}, p => {
            count(p)
            draw(p)
        })
    }
    material.addEventListener('materialUpdate', request)
    request()
    return () => {
        handle?.cancel()
        material.removeEventListener('materialUpdate', request)
    }
}

function drawInto(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!
    return (p: MaterialPreview) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(p.canvas, 0, 0, canvas.width, canvas.height)
    }
}

const cards = new Map<IMaterial, HTMLElement>()
let stops: (() => void)[] = []
let stopLarge: (() => void) | undefined

/** The cards of the materials, each with its preview */
function showCards() {
    stops.forEach(s => s())
    stops = []
    for (const [material, card] of cards) {
        const canvas = card.querySelector('canvas')!
        stops.push(watch(material, 128, drawInto(canvas)))
    }
    if (selected) showLarge(selected)
}

function showLarge(material: IMaterial) {
    stopLarge?.()
    const canvas = document.getElementById('large') as HTMLCanvasElement
    const time = document.getElementById('large-time')!
    const draw = drawInto(canvas)
    stopLarge = watch(material, 256, p => {
        draw(p)
        time.textContent = p.renderTime.toFixed(1) + ' ms'
    })
}

function select(material: IMaterial | undefined) {
    if (!material || material === selected) return
    if (selected) ui.removeChild(selected.uiConfig!)
    stopAnimation()
    selected = material
    for (const [m, card] of cards) card.classList.toggle('on', m === material)
    cards.get(material)?.scrollIntoView({block: 'nearest'})
    document.getElementById('large-name')!.textContent = material.name || material.type
    showLarge(material)
    // the settings of the material: a change sends materialUpdate (with last: false while a slider moves)
    if (material.uiConfig) ui.appendChild(material.uiConfig)
}

// "Animate colour": a hue shift in each frame, as an animation does; the preview renders at most every dragInterval ms
let animation: {material: IMaterial, color: Color, start: number} | undefined
function animate() {
    if (!animation) return
    const c = (animation.material as any).color as Color
    const hsl = {h: 0, s: 0, l: 0}
    animation.color.getHSL(hsl)
    c.setHSL((hsl.h + (performance.now() - animation.start) / 4000) % 1, Math.max(hsl.s, 0.6), Math.min(Math.max(hsl.l, 0.35), 0.65))
    animation.material.setDirty()
}
function stopAnimation() {
    if (!animation) return
    ;((animation.material as any).color as Color).copy(animation.color)
    animation.material.setDirty()
    animation = undefined
    document.getElementById('animate')!.classList.remove('on')
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/kira.glb', {autoCenter: true, autoScale: true})

    model?.traverse(o => {
        const m = (o as any).material as IMaterial | IMaterial[] | undefined
        for (const material of Array.isArray(m) ? m : m ? [m] : []) if (!users.has(material)) users.set(material, o)
    })

    const grid = document.getElementById('materials')!
    for (const material of users.keys()) {
        const card = document.createElement('button')
        card.className = 'card'
        card.title = material.name || material.type
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const name = document.createElement('span')
        name.textContent = material.name || material.type
        card.append(canvas, name)
        card.onclick = () => {
            select(material)
            const mesh = users.get(material)
            if (mesh && picking.getSelectedObject() !== mesh) picking.setSelectedObject(mesh)
        }
        grid.append(card)
        cards.set(material, card)
    }
    document.getElementById('count')!.textContent = String(cards.size)
    showCards()

    // an object picked in the viewport selects its material
    picking.addEventListener('selectedObjectChanged', e => {
        const m = (e.object as any)?.material as IMaterial | IMaterial[] | undefined
        select(Array.isArray(m) ? m[0] : m)
    })

    document.querySelectorAll<HTMLButtonElement>('#preview-panel .shapes button').forEach(b => b.onclick = () => {
        shape = b.dataset.shape as MaterialPreviewShape
        document.querySelectorAll('#preview-panel .shapes button').forEach(x => x.classList.toggle('on', x === b))
        showCards()
    })
    document.getElementById('animate')!.onclick = () => {
        if (animation) return stopAnimation()
        if (!selected || !(selected as any).color) return
        animation = {material: selected, color: ((selected as any).color as Color).clone(), start: performance.now()}
        document.getElementById('animate')!.classList.add('on')
    }
    viewer.addEventListener('preFrame', animate)

    // the plugin settings (drag interval, max per frame, size, cache size)
    ui.setupPluginUi(MaterialPreviewPlugin)
    select(users.keys().next().value)
}

_testStart()
init().finally(_testFinish)
