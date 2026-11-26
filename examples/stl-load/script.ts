import {_testFinish, _testStart, DropzonePlugin, IObject3D, LoadingScreenPlugin, STLLoadPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['stl', 'hdr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.addPluginSync(STLLoadPlugin)

    const options = {
        autoCenter: true,
        autoScale: true,
    }
    const loadStart = performance.now()
    const res = await Promise.all([
        viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr'),
        viewer.load<IObject3D>('https://threejs.org/examples/models/stl/ascii/slotted_disk.stl', options),
        viewer.load<IObject3D>('https://threejs.org/examples/models/stl/binary/pr2_head_pan.stl', options),
    ])
    const loadMs = Math.round(performance.now() - loadStart)
    console.log(res)

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'STLLoadPlugin loads STL files, ASCII and binary: two parts from the three.js examples. STL has only geometry, so they get a default material. Drop or open another .stl.',
        actions: [
            {type: 'button', label: 'Open file…', icon: 'file-code', value: () => viewer.getPlugin(DropzonePlugin)?.promptForFile()},
            {type: 'monitor', label: 'Meshes', getValue: () => stats.meshes.toLocaleString()},
            {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
            {type: 'monitor', label: 'Load time', getValue: () => `${loadMs} ms`},
        ],
    })

}

_testStart()
init().finally(_testFinish)
