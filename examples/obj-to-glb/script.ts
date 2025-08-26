import {_testFinish, _testStart, downloadBlob, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    // load obj + mtl
    const result = await viewer.load<IObject3D>('https://threejs.org/examples/models/obj/male02/male02.obj', {
        autoCenter: true,
        autoScale: true,
    })

    // todo wait for images to load

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
