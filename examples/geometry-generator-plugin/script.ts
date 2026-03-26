import {
    _testFinish,
    _testStart,
    AnimationObjectPlugin,
    EllipseCurve3D,
    GeometryGeneratorPlugin,
    IMaterial,
    LineMaterial2,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    Path,
    PickingPlugin,
    ThreeViewer,
    Vector3,
} from 'threepipe'
import {FontLibrary, GeometryGeneratorExtrasPlugin} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, LoadingScreenPlugin, AnimationObjectPlugin],
    })
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)
    viewer.addPluginSync(GeometryGeneratorExtrasPlugin) // adds text geometry generator

    await FontLibrary.Init // required for text geometry generation

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    console.log(generator.generators)

    // All registered generators — 10 core + 1 from extras (text)
    // Layout: 4x3 grid, text spans 2 cells in last row
    const geometries: {type: string, params: any, color: string, roughness: number, metalness: number, lineWidth?: number, worldUnits?: boolean, colSpan?: number}[] = [
        {type: 'sphere', params: {radius: 0.5, widthSegments: 32, heightSegments: 32}, color: '#ff6b6b', roughness: 0.1, metalness: 0.8},
        {type: 'box', params: {width: 0.8, height: 0.8, depth: 0.8}, color: '#4ecdc4', roughness: 0.3, metalness: 0.2},
        {type: 'cylinder', params: {radiusTop: 0.4, radiusBottom: 0.4, height: 0.8, radialSegments: 32}, color: '#45b7d1', roughness: 0.7, metalness: 0.0},
        {type: 'torus', params: {radius: 0.4, tube: 0.15, radialSegments: 24, tubularSegments: 48}, color: '#f9ca24', roughness: 0.2, metalness: 0.9},
        {type: 'circle', params: {radius: 0.5, segments: 32}, color: '#6c5ce7', roughness: 0.8, metalness: 0.1},
        {type: 'tube', params: {path: new EllipseCurve3D(0, 0, 0.4, 0.4, 0, 2 * Math.PI, false, 0) as any, tubularSegments: 48, radius: 0.06, radialSegments: 12, closed: true}, color: '#e17055', roughness: 0.2, metalness: 0.7},
        {type: 'shape', params: {shapeType: 'polygon', sides: 6, polygonRadius: 0.45, curveSegments: 1}, color: '#00b894', roughness: 0.4, metalness: 0.3},
        {type: 'tubeShape', params: {path: new EllipseCurve3D(0, 0, 0.4, 0.4, 0, 2 * Math.PI, false, 0) as any, shapeType: 'polygon', sides: 5, polygonRadius: 0.1, shapeSegments: 8, tubularSegments: 48, closed: true, primary: 'shape'}, color: '#fdcb6e', roughness: 0.2, metalness: 0.7},
        {type: 'line', params: {curve: new Path().moveTo(-0.4, -0.4).lineTo(0.4, -0.4).lineTo(0.4, 0.4).lineTo(-0.4, 0.4), closePath: true, segments: 10}, color: '#a29bfe', roughness: 0.8, metalness: 0.1, lineWidth: 0.08, worldUnits: true},
        {type: 'shape', params: {shapeType: 'polygon', sides: 3, polygonRadius: 0.45, curveSegments: 1}, color: '#55efc4', roughness: 0.3, metalness: 0.4},
        {type: 'text', params: {text: 'threepipe', alignX: 0.5, alignY: 0.5, size: 0.4, depth: 0.08, curveSegments: 24, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelOffset: 0, bevelSegments: 8}, color: '#fd79a8', roughness: 0.4, metalness: 0.6, colSpan: 2},
    ]

    const gridCols = 4
    const spacing = 1.8
    let cellIndex = 0

    geometries.forEach((geom) => {
        const obj = generator.generateObject(geom.type, geom.params)
        const material = obj.material as IMaterial
        material.name = geom.type + ' Material'
        material.color?.setStyle(geom.color)
        material.roughness = geom.roughness
        material.metalness = geom.metalness
        if (geom.lineWidth !== undefined) (material as LineMaterial2).linewidth = geom.lineWidth
        if (geom.worldUnits !== undefined) (material as LineMaterial2).worldUnits = geom.worldUnits

        const span = geom.colSpan ?? 1
        const col = cellIndex % gridCols
        const row = Math.floor(cellIndex / gridCols)
        const x = (col + (span - 1) / 2 - (gridCols - 1) / 2) * spacing
        const y = -(row - 0.5) * spacing

        obj.position.set(x, y, 0)
        viewer.scene.addObject(obj)
        cellIndex += span
    })

    // ── Camera ──
    const camera = viewer.scene.mainCamera
    camera.position.set(-0.05, -0.96, 10)
    camera.target = new Vector3(-0.05, -0.96, 0)
    camera.setDirty?.()

    const baseFov = 38
    function refreshFov() {
        const size = viewer.renderManager.renderSize
        camera.fov = baseFov * (size.y / size.x)
        camera.updateProjectionMatrix()
    }
    refreshFov()
    viewer.renderManager.addEventListener('resize', refreshFov)

    // ── UI ──
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(AnimationObjectPlugin)
    ui.setupPluginUi(GeometryGeneratorPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(Object3DGeneratorPlugin)

}

_testStart()
init().finally(_testFinish)
