import {
    _testFinish,
    _testStart,
    Color, EditorViewWidgetPlugin,
    getUrlQueryParam,
    GLTFLoader2, IObject3D,
    Object3DGeneratorPlugin,
    Object3DWidgetsPlugin,
    ObjectConstraintsPlugin, OrbitControls3, PhysicalMaterial,
    PickingPlugin,
    PopmotionPlugin,
    ThreeViewer,
    TransformControlsPlugin,
} from 'threepipe'
import {GeometryGeneratorPlugin, LineGeometryGenerator} from '@threepipe/plugin-geometry-generator'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Read more about the plugin - https://threepipe.org/plugin/object-constraint-plugin

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [
            Object3DGeneratorPlugin,
            GeometryGeneratorPlugin,
            ObjectConstraintsPlugin,
            PopmotionPlugin,
            Object3DWidgetsPlugin,
            PickingPlugin,
            TransformControlsPlugin,
            EditorViewWidgetPlugin,
        ],
        dropzone: false,
    })

    await viewer.setEnvironmentMap(
        getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'
    )

    GLTFLoader2.UseMeshLines = true
    LineGeometryGenerator.UseMeshLines = true

    viewer.scene.mainCamera.position.set(0, 0, 60)
    viewer.scene.mainCamera.fov = 10
    const controls = viewer.scene.mainCamera.controls as OrbitControls3
    controls.enableRotate = false

    // viewer.scene.backgroundColor = new Color(0x2a2a2a)

    const model = (await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    }))!
    model.userData.userSelectable = false
    model.children[0].scale.setScalar(2)

    const geometryGenerator = viewer.getPlugin(GeometryGeneratorPlugin)!

    const material = new PhysicalMaterial({
        color: 0xff6666, roughness: 0.2, metalness: 0.2,
        transmission: 1, thickness: 0.5,
    })
    const box = geometryGenerator.generateObject('box', {material})
    box.translateY(2)
    box.scale.setScalar(0.5)
    box.userData.transformControls = {
        showX: true, showY: false, showZ: false,
        mode: 'translate', lockProps: ['mode'],
    }
    viewer.scene.addObject(box)

    const box2 = geometryGenerator.generateObject('box', {material: material.clone()})
    box2.translateY(-4)
    box2.translateX(-4)
    box2.scale.setScalar(1)
    box2.name = 'box2'
    box2.userData.transformControls = {
        showX: false, showY: true, showZ: false,
        mode: 'scale', lockProps: ['mode'],
    }
    ;(box2.material as PhysicalMaterial)!.color = new Color(0x6666ff)
    box.add(box2)

    const sphere = geometryGenerator.generateObject('sphere', {material: material.clone()})
    sphere.translateY(-2)
    sphere.translateZ(3.5)
    sphere.scale.setScalar(0.3)
    sphere.userData.transformControls = {
        showX: true, showY: true, showZ: false,
        mode: 'translate', lockProps: ['mode'],
    }
    ;(sphere.material as PhysicalMaterial)!.color = new Color(0x99ff99)
    viewer.scene.addObject(sphere)

    const constraintsPlugin = viewer.getPlugin(ObjectConstraintsPlugin)!

    const posConstraint = constraintsPlugin.addConstraint(model, 'copy_position', box)
    posConstraint.props.axis = ['x']
    posConstraint.influence = 0.1

    const lookConstraint = constraintsPlugin.addConstraint(model, 'look_at', sphere)
    // lookConstraint.props.axis = ['x']
    lookConstraint.influence = 0.1

    const scaleConstraint = constraintsPlugin.addConstraint(model, 'copy_scale', box2)
    scaleConstraint.props.axis = ['y']
    scaleConstraint.props.uniform = true
    scaleConstraint.influence = 0.1

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin())
    ui.setupPluginUi(ObjectConstraintsPlugin)
    ui.appendChild(posConstraint.uiConfig)
    ui.appendChild(scaleConstraint.uiConfig)
    ui.appendChild(lookConstraint.uiConfig)
    ui.setupPluginUi(PickingPlugin)

}

_testStart()
init().finally(_testFinish)
