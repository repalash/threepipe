import {
    _testFinish,
    _testStart,
    Color,
    Object3DGeneratorPlugin,
    ObjectConstraintsPlugin,
    ThreeViewer,
    Vector3,
    CatmullRomCurve3,
    IObject3D,
    LineMaterial2,
    GLTFLoader2,
    getUrlQueryParam,
    PopmotionPlugin,
    Object3DWidgetsPlugin,
    PickingPlugin,
    TransformControlsPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {GeometryGeneratorPlugin, LineGeometryGenerator} from '@threepipe/plugin-geometry-generator'

// Read more about the example - https://threepipe.org/notes/follow-path-constraint

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        renderScale: 'auto',
        plugins: [Object3DGeneratorPlugin, GeometryGeneratorPlugin, ObjectConstraintsPlugin, PopmotionPlugin, Object3DWidgetsPlugin, PickingPlugin, TransformControlsPlugin],
        dropzone: false,
    })
    await viewer.setEnvironmentMap(getUrlQueryParam('env') ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    GLTFLoader2.UseMeshLines = true
    LineGeometryGenerator.UseMeshLines = true

    viewer.scene.backgroundColor = new Color(0x2a2a2a)

    // Create a big spiral using CatmullRomCurve3
    const spiralPoints = []
    const loops = 4 // Number of complete loops
    const pointsPerLoop = 6 // Points per loop for smooth curve
    const totalPoints = loops * pointsPerLoop
    const maxRadius = 5 // Maximum radius of the spiral
    const height = 8 // Total height of the spiral

    for (let i = 0; i <= totalPoints; i++) {
        const t = i / pointsPerLoop // Parameter that goes from 0 to loops
        const angle = t * 2 * Math.PI // Angle in radians
        const radius = 1 + (maxRadius - 1) * (i / totalPoints) // Gradually increasing radius
        const y = i / totalPoints * height - height / 2 // Y goes from -height/2 to height/2

        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius

        spiralPoints.push(new Vector3(x, -y, z))
    }

    const curve = new CatmullRomCurve3(spiralPoints, false) // false = open curve (no loop)

    // Generate the line object from the curve
    const generator = viewer.getPlugin(Object3DGeneratorPlugin)
    if (!generator) {
        console.error('Object3DGeneratorPlugin not found')
        return
    }

    const pathLine = generator.generate('geometry-line', {
        curve, // this can also be a CurvePath3 to create a line with multiple curves
        segments: 200,
    })

    if (pathLine) {
        pathLine.name = 'Path Line'
        const material = pathLine.material as LineMaterial2
        if (material) {
            material.color = new Color(0x00ff88)
            material.linewidth = 2
        }
        viewer.scene.addObject(pathLine)
    }

    // Create objects that will follow the path using the object manager
    const constraintsPlugin = viewer.getPlugin(ObjectConstraintsPlugin)
    if (!constraintsPlugin) {
        console.error('ObjectConstraintsPlugin not found')
        return
    }

    // Create a model that follows the path
    const obj = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoScale: true,
        autoCenter: true,
    })
    if (!obj) {
        console.error('Failed to load obj object')
        return
    }

    const objConstraint = constraintsPlugin.addConstraint(obj, 'follow_path', pathLine)
    objConstraint.props.offset = 0.01 // offset along the curve (0-1)
    objConstraint.props.followCurve = true // look at the path while moving
    objConstraint.influence = 0.2 // like damping, so the animation is not jerky

    // Set up UI
    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))

    // Constraint controls
    ui.appendChild(objConstraint.uiConfig, {expanded: true})
    ui.appendChild(pathLine.geometry?.uiConfig, {expanded: false, label: 'Line'})

    // Position camera to get a good view of the scene
    viewer.scene.mainCamera.position.set(14, 8, 14)

    const pop = viewer.getPlugin(PopmotionPlugin)!
    pop.animate({
        target: objConstraint.props,
        key: 'offset',
        from: 0,
        to: 1,
        repeat: Infinity,
        duration: 5000,
        repeatType: 'reverse',
        onUpdate: () => {
            objConstraint.setDirty()
        },
        onRepeat: () => {
            const helmet = obj.children[0]
            helmet.rotateZ(Math.PI) // look around
        },
    })
}

_testStart()
init().finally(_testFinish)
