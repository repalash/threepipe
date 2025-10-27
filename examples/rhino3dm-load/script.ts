import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, Rhino3dmLoadPlugin, ThreeViewer} from 'threepipe'

async function init() {

    const viewer = new ThreeViewer({
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
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/Pistons.3dm', {
        autoCenter: true,
        autoScale: true,
    })
    console.log(result)

    // Some objects are invisible in this file, set visible to true for all objects
    result?.traverse(object => {
        object.visible = true
    })
    result?.setDirty && result?.setDirty()

}

_testStart()
init().finally(_testFinish)
