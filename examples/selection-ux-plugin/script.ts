import {
    _testFinish,
    _testStart,
    BoxGeometry,
    CylinderGeometry,
    Group2,
    LoadingScreenPlugin,
    Mesh,
    Object3D,
    PhysicalMaterial,
    SphereGeometry,
    ThreeViewer,
    TorusGeometry,
    UndoManagerPlugin,
} from 'threepipe'
import {SelectionBoxStyle, SelectionUxPlugin} from '@threepipe/plugin-tweakpane-editor'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        plugins: [LoadingScreenPlugin],
    })
    // each selection change is one undo step (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)
    viewer.addPluginSync(UndoManagerPlugin)
    // the selection is the PickingPlugin's; this plugin decides what a click or a key selects, and draws the overlay:
    // the box of the selection with its name and size, and the box of what a click would select
    const ux = viewer.addPluginSync(SelectionUxPlugin)
    ux.unit = 'cm'

    // the style of the box: a screen rectangle, the 3D box, or its corners
    const style = document.getElementById('box-style') as HTMLSelectElement
    style.onchange = () => ux.boxStyle = style.value as SelectionBoxStyle

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    buildScene(viewer)
    await viewer.fitToView(undefined, 1.1, 0)
}

/** Jewellery with nested groups: Ring > Band, Head > (Gem > Crown, Pavilion), Prongs; a glTF-like wrapper chain */
function buildScene(viewer: ThreeViewer) {
    const gold = new PhysicalMaterial({color: '#e8c372', metalness: 1, roughness: 0.22})
    const white = new PhysicalMaterial({color: '#dfe3e8', metalness: 1, roughness: 0.18})
    const gem = new PhysicalMaterial({color: '#a9dcff', metalness: 0.2, roughness: 0.04})
    const pearl = new PhysicalMaterial({color: '#f4efe6', metalness: 0, roughness: 0.32})
    const paper = new PhysicalMaterial({color: '#e25c5c', metalness: 0, roughness: 0.6})
    const leather = new PhysicalMaterial({color: '#5b4636', metalness: 0, roughness: 0.7})

    const mesh = (name: string, g: any, m: PhysicalMaterial, p: [number, number, number] = [0, 0, 0], r?: [number, number, number]) => {
        const o = new Mesh(g, m)
        o.name = name
        o.position.set(...p)
        if (r) o.rotation.set(...r)
        return o
    }
    const group = (name: string, p: [number, number, number], ...children: Object3D[]) => {
        const g = new Group2()
        g.name = name
        g.position.set(...p)
        g.add(...children)
        return g
    }

    const prongs = [0, 1, 2, 3].map(i => {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4
        return mesh(`Prong ${i + 1}`, new CylinderGeometry(0.035, 0.05, 0.62, 12), white, [Math.cos(a) * 0.33, 0.12, Math.sin(a) * 0.33], [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25])
    })
    const ring = group('Solitaire Ring', [0, 0, 0],
        mesh('Band', new TorusGeometry(1, 0.12, 32, 128), gold, [0, 1.12, 0]),
        group('Head', [0, 2.32, 0],
            group('Gem', [0, 0.2, 0],
                mesh('Crown', new CylinderGeometry(0.26, 0.4, 0.14, 16), gem, [0, 0.07, 0]),
                mesh('Pavilion', new CylinderGeometry(0.4, 0.01, 0.42, 16), gem, [0, -0.21, 0]),
            ),
            group('Prongs', [0, 0, 0], ...prongs),
        ),
    )
    const stud = (name: string, x: number) => group(name, [x, 0, 0],
        mesh('Pearl', new SphereGeometry(0.36, 32, 16), pearl, [0, 0.62, 0]),
        mesh('Post', new CylinderGeometry(0.03, 0.03, 0.3, 8), gold, [0, 0.15, 0]),
    )
    const earrings = group('Pearl Earrings', [3.5, 0, 0.5], stud('Left Stud', -0.6), stud('Right Stud', 0.6))
    const gift = group('Gift Box', [-3.5, 0, 0],
        mesh('Base', new BoxGeometry(2, 1.2, 2), paper, [0, 0.6, 0]),
        mesh('Lid', new BoxGeometry(2.1, 0.22, 2.1), paper, [0, 1.3, 0]),
    )
    // like an imported glTF: Scene > root > Watch is one level, a click selects "Scene", a double click its parts
    const watch = group('Scene', [0, 0, -3.5], group('root', [0, 0, 0], group('Watch', [0, 0, 0],
        mesh('Case', new CylinderGeometry(0.9, 0.9, 0.3, 48), white, [0, 0.25, 0]),
        mesh('Strap', new BoxGeometry(0.9, 0.1, 3.6), leather, [0, 0.05, 0]),
    )))
    for (const o of [ring, earrings, gift, watch]) viewer.scene.addObject(o)
}

_testStart()
init().finally(_testFinish)
