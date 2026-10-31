import {
    _testFinish,
    _testStart,
    BackSide,
    DoubleSide,
    FrontSide,
    LoadingScreenPlugin,
    Mesh,
    PhysicalMaterial,
    ThreeViewer,
    TorusKnotGeometry,
    UiObjectConfig,
    UndoManagerPlugin,
} from 'threepipe'
import {UiConfigForm} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })
    // Ctrl+Z / Ctrl+Shift+Z undo and redo the edits in the form
    const undo = viewer.addPluginSync(UndoManagerPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const material = new PhysicalMaterial({color: '#d4af37', metalness: 1, roughness: 0.25})
    const mesh = new Mesh(new TorusKnotGeometry(0.6, 0.2, 160, 24), material)
    mesh.name = 'Torus knot'
    viewer.scene.addObject(mesh)

    // any uiconfig.js configs: here written by hand, bound to the mesh and its material.
    // The children of an object's uiConfig work the same, e.g. UiConfigMethods.GetChildren(material.uiConfig)
    const configs: UiObjectConfig[] = [
        {type: 'input', label: 'Name', property: [mesh, 'name']},
        {type: 'checkbox', label: 'Visible', property: [mesh, 'visible'], onChange: () => mesh.setDirty()},
        {type: 'vec3', label: 'Position', property: [mesh, 'position'], onChange: () => mesh.setDirty()},
        {
            type: 'folder', label: 'Material',
            // a change of any field in the folder
            onChange: () => material.setDirty(),
            children: [
                {type: 'color', label: 'Color', property: [material, 'color']},
                {type: 'slider', label: 'Roughness', property: [material, 'roughness'], bounds: [0, 1], stepSize: 0.01},
                {type: 'number', label: 'Metalness', property: [material, 'metalness'], bounds: [0, 1]},
                {type: 'dropdown', label: 'Side', property: [material, 'side'], children: [
                    {label: 'Front', value: FrontSide},
                    {label: 'Back', value: BackSide},
                    {label: 'Double', value: DoubleSide},
                ]},
                {type: 'button', label: 'Random color', value: () => material.color.setHSL(Math.random(), 0.6, 0.5)},
            ],
        },
        {type: 'monitor', label: 'Triangles', property: [{triangles: mesh.geometry.index!.count / 3}, 'triangles']},
    ]

    const form = new UiConfigForm(configs, {undoManager: undo.undoManager})
    const card = document.createElement('div')
    card.className = 'form-card'
    card.appendChild(form.element)
    viewer.container.appendChild(card)
}

_testStart()
init().finally(_testFinish)
