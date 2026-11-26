import {_testFinish, _testStart, DropzonePlugin, IObject3D, LoadingScreenPlugin, Rhino3dmLoadPlugin, ThreeViewer} from 'threepipe'
import {createExampleCard} from '../examples-utils/example-card.js'
import {modelStats} from '../examples-utils/model-stats.js'

async function init() {

    const viewer = new ThreeViewer({
        renderScale: 'auto',
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        msaa: true,
        dropzone: {
            allowedExtensions: ['3dm', 'hdr'],
            addOptions: {
                disposeSceneObjects: true,
                autoSetEnvironment: true, // when hdr is dropped
                autoSetBackground: true,
            },
        },
        plugins: [LoadingScreenPlugin],
    })

    viewer.scene.mainCamera.position.set(5, 0.14, 3)
    viewer.scene.mainCamera.target.set(-0.2, 0, 0)

    viewer.addPluginSync(Rhino3dmLoadPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr', {
        setBackground: true,
    })
    const loadStart = performance.now()
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/Pistons.3dm', {
        autoCenter: true,
        autoScale: true,
    })
    const loadMs = Math.round(performance.now() - loadStart)
    console.log(result)

    // Some objects are invisible in this file, set visible to true for all objects
    result?.traverse(object => {
        object.visible = true
    })
    result?.setDirty && result?.setDirty()

    const stats = modelStats(viewer)
    createExampleCard(viewer, {
        description: 'Rhino3dmLoadPlugin loads Rhino .3dm files with the rhino3dm library: a set of pistons. Some objects in this file are hidden; the example shows all of them. Drop or open another .3dm.',
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
