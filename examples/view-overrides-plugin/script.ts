import {
    _testFinish,
    _testStart,
    BoxGeometry,
    DirectionalLight2,
    EllipseCurve,
    GeometryGeneratorPlugin,
    IObject3D,
    LineMaterial2,
    LoadingScreenPlugin,
    Mesh2,
    PhysicalMaterial,
    PickingPlugin,
    SphereGeometry,
    ThreeViewer,
    TorusKnotGeometry,
    TransformControlsPlugin,
    ViewOverridesPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin, GeometryGeneratorPlugin],
})

async function init() {
    // Debug materials (unlit, depth, normals, material ID, UV) and lighting presets for the whole scene.
    // Applied only while rendering: the scene, its materials and its lights do not change.
    // In code: overrides.setMaterial('normal'), await overrides.setLighting('env-studio'), overrides.clear()
    const overrides = viewer.addPluginSync(ViewOverridesPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    // a scene light: the lighting presets hide it while they are on
    const light = new DirectionalLight2(0xffffff, 2)
    light.position.set(2, 3, 2)
    viewer.scene.addObject(light)

    // a fat line around the model: it stays a line in the material views (the depth ramp, its material ID colour, ...)
    const ring = viewer.getPlugin(GeometryGeneratorPlugin)!.generateObject('line', {
        curve: new EllipseCurve(0, 0, 1.3, 1.3, 0, Math.PI * 2),
        segments: 96,
        material: new LineMaterial2({color: '#ff6b3d', linewidth: 4}),
    })
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.9
    viewer.scene.addObject(ring, {autoScale: false, autoCenter: false})

    // more objects, each with its own material: a colour each in the Material ID view, and shapes for the other views
    const shapes: [string, Mesh2, [number, number, number]][] = [
        ['Gold knot', new Mesh2(new TorusKnotGeometry(0.28, 0.09, 128, 16), new PhysicalMaterial({color: '#e8b34b', metalness: 1, roughness: 0.25})), [-1.6, 0.4, 0]],
        ['Red box', new Mesh2(new BoxGeometry(0.55, 0.55, 0.55), new PhysicalMaterial({color: '#d9402b', roughness: 0.6})), [1.6, 0.4, 0]],
        ['Glass sphere', new Mesh2(new SphereGeometry(0.32, 48, 24), new PhysicalMaterial({color: '#9fd3ff', roughness: 0.05, transmission: 1, thickness: 0.5})), [-1.6, -0.5, 0]],
        ['Matte sphere', new Mesh2(new SphereGeometry(0.32, 48, 24), new PhysicalMaterial({color: '#4f9d69', roughness: 0.9})), [1.6, -0.5, 0]],
    ]
    for (const [name, mesh, position] of shapes) {
        mesh.name = name
        mesh.position.set(...position)
        viewer.scene.addObject(mesh, {autoScale: false, autoCenter: false})
    }

    // click an object to select it, then move or rotate it with the gizmo (its mode in the Transform Controls panel)
    const picking = viewer.addPluginSync(PickingPlugin)
    viewer.addPluginSync(TransformControlsPlugin)
    picking.setSelectedObject(shapes[1][1])

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(overrides, {expanded: true})
    ui.setupPluginUi(TransformControlsPlugin, {expanded: true})
}

_testStart()
init().finally(_testFinish)
