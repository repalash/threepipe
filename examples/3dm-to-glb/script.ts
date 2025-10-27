import {
    _testFinish,
    _testStart,
    downloadBlob,
    IObject3D,
    LoadingScreenPlugin,
    Rhino3dmLoadPlugin,
    ThreeViewer,
} from 'threepipe'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    viewer.scene.mainCamera.position.set(5, 0.14, 3)
    viewer.scene.mainCamera.target.set(-0.2, 0, 0)

    viewer.addPluginSync(Rhino3dmLoadPlugin)

    // load a 3dm file
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/Pistons.3dm', {
        autoCenter: true,
        autoScale: true,
    })
    // await viewer.load<IObject3D>('https://threejs.org/examples/models/3dm/Rhino_Logo.3dm')

    // export to glb
    const blob = await viewer.export(result)
    // const blob = await viewer.exportScene(); // its possible to export the whole scene also

    if (!blob || blob.ext !== 'glb') {
        console.error('Unable to export scene')
        return
    }

    // clear scene
    viewer.scene.disposeSceneModels()

    // load environment map and glb
    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    await viewer.load({
        path: 'file.glb',
        file: blob,
    })

    // add download button
    const downloadButton = document.createElement('button')
    downloadButton.innerText = 'Download .glb'
    downloadButton.style.position = 'absolute'
    downloadButton.style.bottom = '3rem'
    downloadButton.style.right = '3rem'
    downloadButton.style.zIndex = '10000'
    downloadButton.onclick = () => downloadBlob(blob, 'file.glb')
    document.body.appendChild(downloadButton)

}

_testStart()
init().finally(_testFinish)
