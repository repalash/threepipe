import {
    _testFinish,
    _testStart, AssetExporterPlugin,
    Color, generateUiConfig,
    LineGeometry2,
    LineMaterial2,
    LoadingScreenPlugin,
    MeshLine,
    PickingPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

// Read more about the example - https://threepipe.org/notes/fat-lines

async function init() {
    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin, PickingPlugin, AssetExporterPlugin],
        dropzone: true,
    })

    viewer.scene.autoNearFarEnabled = false

    viewer.scene.backgroundColor = new Color(0x333333)

    const spiral = {
        radius: 1,
        height: 2,
        loops: 10,
        width: 5,
    }

    const line = new MeshLine(new LineGeometry2(), new LineMaterial2())
    line.material.color = new Color(0xffffff)
    line.material.vertexColors = true
    line.material.linewidth = 5 // pixels
    line.rotateX(Math.PI / 2)
    line.name = 'Spiral Mesh'
    line.material.name = 'Spiral Material'
    function updateSpiral() {
        const {positions, colors} = makeSpiral(spiral.radius, spiral.height, spiral.loops)
        line.geometry.setPositions(positions)
        line.geometry.setColors(colors)
        line.material.linewidth = spiral.width
        line.setDirty()
    }
    updateSpiral()

    viewer.scene.addObject(line)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(PickingPlugin)
    ui.appendChild({
        type: 'folder',
        label: 'Spiral',
        children: generateUiConfig(spiral),
        onChange: updateSpiral,
        expanded: true,
    })
    ui.appendChild(line.uiConfig)
    ui.setupPluginUi(AssetExporterPlugin)

}

_testStart()
init().finally(_testFinish)

function makeSpiral(radius = 1, height = 2, loops = 10) {
    const positions: number[] = []
    const colors: number[] = []
    const segments = 1000
    const angleStep = Math.PI * 2 * loops / segments
    const heightStep = height / segments

    for (let i = 0; i <= segments; i++) {
        const angle = i * angleStep
        const x = radius * Math.cos(angle)
        const y = radius * Math.sin(angle)
        const z = i * heightStep - height / 2

        positions.push(x, y, z)

        // Color gradient from blue to red
        const colorValue = i / segments
        colors.push(colorValue, 0, 1 - colorValue) // RGB
    }

    return {positions, colors}
}
