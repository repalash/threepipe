import {_testFinish, downloadBlob, ThreeViewer} from 'threepipe'

const viewer = new ThreeViewer({canvas: document.getElementById('mcanvas') as HTMLCanvasElement, msaa: true})

async function init() {

    // load obj + mtl
    await viewer.load('https://threejs.org/examples/models/obj/male02/male02.obj', {
        autoCenter: true,
        autoScale: true,
    })

    // todo wait for images to load

    // export to glb
    const blob = await viewer.exportScene()
    if (!blob || blob.ext !== 'glb') {
        console.error('Unable to export scene')
        return
    }

    // clear scene
    viewer.scene.disposeSceneModels()

    // load environment map and glb
    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
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

init().then(_testFinish)
