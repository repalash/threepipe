import {
    _testFinish,
    _testStart,
    AnimationObjectPlugin,
    IMaterial,
    LineMaterial2,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    Path,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {FontLibrary, GeometryGeneratorPlugin} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [PickingPlugin, Object3DGeneratorPlugin, LoadingScreenPlugin, AnimationObjectPlugin],
    })
    const generator = viewer.addPluginSync(GeometryGeneratorPlugin)

    await FontLibrary.Init // required for text geometry generation

    viewer.scene.setBackgroundColor('#444466')

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    console.log(generator.generators)

    // Add a ground plane
    const plane = generator.generateObject('plane', {
        width: 8, height: 6, widthSegments: 10, heightSegments: 10,
    })
    plane.position.set(0, -1.5, 0)
    plane.rotation.x = -Math.PI / 2
    viewer.scene.addObject(plane)

    // Create a grid of all available geometry types
    const geometries = [
        {type: 'sphere', params: {radius: 0.5, widthSegments: 32, heightSegments: 32}, color: '#ff6b6b', roughness: 0.1, metalness: 0.8},
        {type: 'box', params: {width: 1, height: 1, depth: 1, widthSegments: 10, heightSegments: 10, depthSegments: 10}, color: '#4ecdc4', roughness: 0.3, metalness: 0.2},
        {type: 'cylinder', params: {radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 32, heightSegments: 1}, color: '#45b7d1', roughness: 0.7, metalness: 0.0},
        {type: 'text', params: {text: 'yello', alignX: 0.5, alignY: 0.5, size: 0.5, height: 0.1, curveSegments: 120, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: 0, bevelSegments: 15}, color: '#fd79a8', roughness: 0.4, metalness: 0.6},
        {type: 'torus', params: {radius: 0.5, tube: 0.2, radialSegments: 32, tubularSegments: 64}, color: '#f9ca24', roughness: 0.2, metalness: 0.9},
        {type: 'circle', params: {radius: 0.5, segments: 32}, color: '#6c5ce7', roughness: 0.8, metalness: 0.1},
        {type: 'line', params: {curve: new Path().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5), closePath: true, segments: 10}, color: '#6c5ce7', roughness: 0.8, metalness: 0.1, lineWidth: 0.1, worldUnits: true},
    ]

    // Arrange in a 3x2 grid with tighter spacing
    const gridCols = 3
    const spacing = 1.8

    geometries.forEach((geom, index) => {
        const obj = generator.generateObject(geom.type, geom.params)
        const material = obj.material as IMaterial
        material.name = geom.type + ' Material'
        material.color?.setStyle(geom.color)
        material.roughness = geom.roughness
        material.metalness = geom.metalness
        if (geom.lineWidth !== undefined) (material as LineMaterial2).linewidth = geom.lineWidth
        if (geom.worldUnits !== undefined) (material as LineMaterial2).worldUnits = geom.worldUnits

        // Calculate grid position
        const col = index % gridCols
        const row = Math.floor(index / gridCols)
        const x = (col - (gridCols - 1) / 2) * spacing
        const y = (row - 0.5) * spacing

        obj.position.set(x, y, 0)

        viewer.scene.addObject(obj)
        console.log(obj)
    })

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(AnimationObjectPlugin)
    ui.setupPluginUi(GeometryGeneratorPlugin)
    ui.setupPluginUi(PickingPlugin)
    ui.setupPluginUi(Object3DGeneratorPlugin)

}

_testStart()
init().finally(_testFinish)
