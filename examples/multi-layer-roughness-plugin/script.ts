import {
    _testFinish, _testStart,
    GeometryGeneratorPlugin,
    LoadingScreenPlugin,
    Mesh,
    MultiLayerRoughnessPlugin,
    PhysicalMaterial,
    PickingPlugin,
    SphereGeometry,
    ThreeViewer,
} from 'threepipe'
import {FontLibrary, GeometryGeneratorExtrasPlugin} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Real metal almost always shows several reflections at once - a sharp core reflection and rougher,
// fainter "tail-off" reflections caused by sub-pixel micro scratches ("reflection tail-off").
// A single roughness value can't reproduce this - extra specular layers can.
//
// The grid below compares plain single-roughness metals (top row) with multi-layer roughness variants.

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, PickingPlugin],
    })

    const multiLayerRoughness = viewer.addPluginSync(MultiLayerRoughnessPlugin)
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    viewer.addPluginSync(GeometryGeneratorExtrasPlugin)
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    await FontLibrary.Init

    viewer.scene.setBackgroundColor('#101214')
    // dark studio environment with a bright softbox - the tail-off shows as a glow around the sharp reflection
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/studio_small_01_1k.hdr')
    viewer.scene.envMapIntensity = 0.7

    const geometry = new SphereGeometry(0.55, 96, 96)
    const addSphere = async(name: string, col: number, row: number, roughness: number, mlr?: Parameters<typeof MultiLayerRoughnessPlugin.AddMultiLayerRoughness>[1])=>{
        const material = new PhysicalMaterial({name, color: '#ffffff', metalness: 1, roughness})
        if (mlr) MultiLayerRoughnessPlugin.AddMultiLayerRoughness(material, mlr)
        const mesh = new Mesh(geometry, material)
        mesh.name = name
        mesh.position.set(colX(col), rowY(row), 0)
        await viewer.addSceneObject(mesh)
        return mesh
    }

    function addLabel(text: string, x: number, y: number, size = 0.13) {
        const label = generator.generateObject('text', {
            text, size, depth: 0.02,
            alignX: 0.5, alignY: 0.5,
            curveSegments: 8,
            bevelEnabled: false,
        })
        label.name = 'label-' + text
        label.position.set(x, y, 0)
        const mat = label.material as PhysicalMaterial
        mat.color.setStyle('#e8ecef')
        mat.emissive.setStyle('#e8ecef')
        mat.emissiveIntensity = 0.6
        mat.roughness = 0.9
        mat.metalness = 0
        viewer.scene.addObject(label)
        return label
    }

    const colX = (col: number)=>(col - 1.5) * 1.35
    const rowY = (row: number)=>(1.5 - row) * 1.35
    const underLabel = (text: string, col: number, row: number)=>addLabel(text, colX(col), rowY(row) - 0.75)
    const rowLabel = (text: string, row: number)=>addLabel(text, -3.3, rowY(row), 0.15)

    // Row 1 - control: plain single roughness sweep, no layers.
    rowLabel('single', 0)
    for (const [i, r] of [0.05, 0.2, 0.4, 0.7].entries()) {
        await addSphere(`Single Roughness ${r}`, i, 0, r)
        underLabel(`r ${r}`, i, 0)
    }

    // Row 2 - tail weight sweep (mix): sharp base (0.05) + one 0.4-roughness lobe with increasing presence.
    rowLabel('+ tail w', 1)
    for (const [i, w] of [0.1, 0.25, 0.45, 0.7].entries()) {
        await addSphere(`Tail Weight ${w}`, i, 1, 0.05, {layers: [{weight: w, roughness: 0.4, baseInfluence: 0}]})
        underLabel(`w ${w}`, i, 1)
    }

    // Row 3 - tail roughness sweep (mix): sharp base (0.05) + one 30%-weight lobe getting rougher.
    rowLabel('+ tail r', 2)
    for (const [i, r] of [0.2, 0.4, 0.6, 0.85].entries()) {
        await addSphere(`Tail Roughness ${r}`, i, 2, 0.05, {layers: [{weight: 0.3, roughness: r, baseInfluence: 0}]})
        underLabel(`r ${r}`, i, 2)
    }

    // Row 4 - blend modes and layer stacks on the same two layers, plus a 3-layer cascade.
    rowLabel('modes', 3)
    const layers2 = [{weight: 0.35, roughness: 0.35, baseInfluence: 0}, {weight: 0.15, roughness: 0.7, baseInfluence: 0}]
    await addSphere('Mode Mix', 0, 3, 0.05, {layers: layers2})
    underLabel('mix', 0, 3)
    await addSphere('Mode Additive', 1, 3, 0.05, {blendMode: 'additive', layers: layers2.map(l=>({...l}))})
    underLabel('additive', 1, 3)
    await addSphere('Mode Chain', 2, 3, 0.05, {blendMode: 'chain', layers: layers2.map(l=>({...l}))})
    underLabel('chain', 2, 3)
    const cascade = await addSphere('3 Layer Cascade', 3, 3, 0.05, {layers: [
        {weight: 0.3, roughness: 0.25, baseInfluence: 0},
        {weight: 0.2, roughness: 0.5, baseInfluence: 0},
        {weight: 0.1, roughness: 0.85, baseInfluence: 0},
    ]})
    underLabel('3 lobes', 3, 3)

    addLabel('Multi Layer Roughness - click a sphere to edit its layers', -0.4, 2.75, 0.16)

    viewer.scene.mainCamera.position.set(-0.4, 0, 9)
    viewer.scene.mainCamera.target.set(-0.4, 0, 0)

    ui.setupPluginUi(multiLayerRoughness)
    ui.setupPluginUi(PickingPlugin)
    ui.appendChild(multiLayerRoughness.materialExtension.getUiConfig?.(cascade.material), {expanded: false})

    ;(window as any).viewer = viewer // for debugging in console

}

_testStart()
init().finally(_testFinish)
