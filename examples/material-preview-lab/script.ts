import {
    _testFinish,
    _testStart,
    Color,
    IMaterial,
    LatheGeometry,
    LoadingScreenPlugin,
    MaterialPreview,
    MaterialPreviewGenerator,
    MaterialPreviewHandle,
    materialPreviewOptionsFromViewer,
    MaterialPreviewPlugin,
    Mesh,
    PhysicalMaterial,
    ThreeViewer,
    Vector2,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// A material lab with MaterialPreviewPlugin: a palette of materials, each with its live preview. A click puts a
// material on the vase. Some materials animate in each frame (they call setDirty, as an animation does): their previews
// render at most every dragInterval ms, and the number on each swatch counts its renders. The benchmark compares the
// offscreen preview with the old full canvas snapshot.

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    renderScale: 'auto',
    plugins: [LoadingScreenPlugin, MaterialPreviewPlugin],
})

const previews = viewer.getPlugin(MaterialPreviewPlugin)!
const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

type Animate = (m: PhysicalMaterial, t: number) => void
const palette: [PhysicalMaterial, Animate?][] = [
    [new PhysicalMaterial({name: 'Gold', color: new Color('#ffc861'), metalness: 1, roughness: 0.15})],
    [new PhysicalMaterial({name: 'Rose gold', color: new Color('#f2b3a0'), metalness: 1, roughness: 0.2})],
    [new PhysicalMaterial({name: 'Chrome', color: new Color('#ffffff'), metalness: 1, roughness: 0.02})],
    [new PhysicalMaterial({name: 'Brushed steel', color: new Color('#c8ccd2'), metalness: 1, roughness: 0.45})],
    [new PhysicalMaterial({name: 'Copper', color: new Color('#e08a5a'), metalness: 1, roughness: 0.3})],
    [new PhysicalMaterial({name: 'Car paint', color: new Color('#9a0414'), metalness: 0.3, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03})],
    [new PhysicalMaterial({name: 'Ceramic', color: new Color('#f4f1ea'), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1})],
    [new PhysicalMaterial({name: 'Rubber', color: new Color('#1b1b1d'), roughness: 0.9})],
    [new PhysicalMaterial({name: 'Velvet', color: new Color('#4a1260'), roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: new Color('#e8a6ff')})],
    [new PhysicalMaterial({name: 'Pearl', color: new Color('#f3eee6'), roughness: 0.25, iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 600]})],
    [new PhysicalMaterial({name: 'Glass', color: new Color('#ffffff'), roughness: 0, transmission: 1, ior: 1.5, thickness: 0.6})],
    [new PhysicalMaterial({name: 'Frosted glass', color: new Color('#dbe9f2'), roughness: 0.35, transmission: 1, ior: 1.5, thickness: 0.6})],
    [new PhysicalMaterial({name: 'Jade', color: new Color('#3fa36b'), roughness: 0.3, transmission: 0.6, thickness: 1})],
    // animated: a change in every frame, as an animation or a material transition
    [new PhysicalMaterial({name: 'Neon (animated)', color: new Color('#101014'), roughness: 0.5, emissive: new Color('#ff2a8a')}),
        (m, t) => m.emissiveIntensity = 1.5 + Math.sin(t * 4) * 1.4],
    [new PhysicalMaterial({name: 'Soap bubble (animated)', color: new Color('#ffffff'), roughness: 0, transmission: 1, iridescence: 1, iridescenceIOR: 1.33}),
        (m, t) => m.iridescenceThicknessRange = [100 + 150 * (1 + Math.sin(t * 1.3)), 500 + 300 * (1 + Math.cos(t))]],
    [new PhysicalMaterial({name: 'Lava (animated)', color: new Color('#200804'), roughness: 0.8, emissive: new Color('#ff4a00'), emissiveIntensity: 2}),
        (m, t) => m.emissive.setHSL(0.02 + 0.05 * (1 + Math.sin(t * 2)), 1, 0.5)],
]

// a vase: the "This mesh" shape renders it alone
const profile = [[0, 0], [0.55, 0], [0.62, 0.08], [0.78, 0.45], [0.82, 0.8], [0.6, 1.3], [0.38, 1.6], [0.36, 1.85], [0.46, 2.0]]
const vase = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 96), palette[0][0])
vase.name = 'Vase'

let active = palette[0][0]
let stopLarge: (() => void) | undefined

/** Follows a material: a preview now, and a new one on each change (in the next frame, or every dragInterval ms) */
function watch(material: IMaterial, options: {shape: 'sphere' | 'mesh', size: number}, draw: (p: MaterialPreview) => void) {
    let handle: MaterialPreviewHandle | undefined
    const request = () => {
        handle?.cancel()
        handle = previews.request(material, {...options, geometry: options.shape === 'mesh' ? vase.geometry : undefined}, draw)
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

function setActive(material: PhysicalMaterial) {
    if (active.uiConfig) ui.removeChild(active.uiConfig)
    active = material
    vase.material = material
    vase.setDirty?.()
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', (s as HTMLElement).dataset.name === material.name))
    document.getElementById('active-name')!.textContent = material.name
    stopLarge?.()
    const draw = drawInto(document.getElementById('large') as HTMLCanvasElement)
    const time = document.getElementById('active-time')!
    stopLarge = watch(material, {shape: 'mesh', size: 256}, p => {
        draw(p)
        time.textContent = p.renderTime.toFixed(1) + ' ms'
    })
    if (material.uiConfig) ui.appendChild(material.uiConfig)
}

async function init() {
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {setBackground: false})
    viewer.scene.setBackgroundColor('#202024')
    viewer.scene.addObject(vase)
    const camera = viewer.scene.mainCamera
    camera.position.set(0, 1.6, 4.4)
    camera.target.set(0, 1, 0)
    camera.setDirty()
    const controls = camera.controls as any
    if (controls) {
        controls.autoRotate = true
        controls.autoRotateSpeed = 1.5
    }

    const grid = document.getElementById('palette')!
    for (const [material] of palette) {
        const swatch = document.createElement('button')
        swatch.className = 'swatch'
        swatch.dataset.name = material.name
        swatch.title = material.name
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const name = document.createElement('span')
        name.textContent = material.name.replace(' (animated)', '')
        const renders = document.createElement('i')
        renders.title = 'Renders of this preview'
        swatch.append(canvas, name, renders)
        let count = 0
        const draw = drawInto(canvas)
        const seen = new WeakSet<MaterialPreview>()
        watch(material, {shape: 'sphere', size: 128}, p => {
            if (!seen.has(p)) renders.textContent = String(++count)
            seen.add(p)
            draw(p)
        })
        swatch.onclick = () => setActive(material)
        grid.append(swatch)
    }

    // the animated materials change in every frame and call setDirty, so the viewport and their previews follow
    viewer.addEventListener('preFrame', () => {
        const t = performance.now() / 1000
        for (const [material, animate] of palette) {
            if (!animate) continue
            animate(material, t)
            material.setDirty()
        }
    })

    document.getElementById('benchmark')!.onclick = () => benchmark(active)

    ui.setupPluginUi(MaterialPreviewPlugin)
    setActive(active)
}

// Time per preview: the offscreen render (256px) and the old full canvas snapshot (render to the canvas, toDataURL of the canvas).
function benchmark(material: IMaterial) {
    const out = document.getElementById('benchmark-result')!
    out.textContent = 'running...'
    const renderer = viewer.renderManager.renderer
    const generator = new MaterialPreviewGenerator()
    const options = materialPreviewOptionsFromViewer(viewer, material)
    const runs = 10
    const time = (f: () => void) => {
        f(); f() // warm up: shader compile
        const start = performance.now()
        for (let i = 0; i < runs; i++) f()
        return (performance.now() - start) / runs
    }
    viewer.doOnce('preFrame', () => {
        const canvas = document.createElement('canvas')
        const offscreen = time(() => generator.renderToCanvas(material, renderer, {...options, size: 256}, canvas))
        const offscreenUrl = time(() => generator.renderToCanvas(material, renderer, {...options, size: 256}, canvas).toDataURL('image/png'))
        const fullCanvas = time(() => generator.generate(material, renderer, options.environment, 'sphere'))
        // the two images: the full canvas snapshot has no tone mapping and is stretched to the canvas aspect
        const images = document.getElementById('benchmark-images')!
        images.innerHTML = ''
        for (const [title, src] of [
            ['offscreen', canvas.toDataURL('image/png')],
            ['full canvas', generator.generate(material, renderer, options.environment, 'sphere')],
        ]) {
            const img = document.createElement('img')
            img.src = src
            img.title = title
            img.dataset.kind = title
            images.append(img)
        }
        generator.dispose()
        viewer.setDirty() // the full canvas snapshots drew on the canvas
        const c = renderer.domElement
        out.textContent = [
            `offscreen 256px, canvas: ${offscreen.toFixed(2)} ms`,
            `offscreen 256px, data url: ${offscreenUrl.toFixed(2)} ms`,
            `full canvas ${c.width}x${c.height}, data url: ${fullCanvas.toFixed(2)} ms`,
        ].join('\n')
        out.dataset.offscreen = String(offscreen)
        out.dataset.offscreenUrl = String(offscreenUrl)
        out.dataset.fullCanvas = String(fullCanvas)
    })
}

_testStart()
init().finally(_testFinish)
