import {
    _testFinish,
    _testStart,
    downloadBlob, HemisphereLight,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
import {createExampleCard} from '../examples-utils/example-card.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const assimp = viewer.addPluginSync(AssimpJsPlugin)
    await assimp.init()

    console.log('AssimpJsPlugin initialized:', assimp.ajs)

    // Direct way to convert without using the viewer
    const files = [
        'https://threejs.org/examples/models/obj/male02/male02.obj',
        'https://threejs.org/examples/models/obj/male02/male02.mtl', // mtl doesnt work?
    ]
    const fe = files.map(async f=>fetch(`${f}`).then(async t=>t.arrayBuffer()))
    const responses = await Promise.all(fe)
    const fileList: Record<string, ArrayBuffer> = {}
    for (let i = 0; i < files.length; i++) {
        fileList[files[i]] = responses[i]
    }
    const fbx = assimp.convertFiles(fileList, 'fbx')
    if (!fbx) {
        console.error('Failed to convert files to fbx')
        return
    }

    // load the fbx file
    await viewer.load<IObject3D>({path: 'file.fbx', file: fbx}, {
        autoCenter: true,
        autoScale: true,
    })
    viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 2))

    createExampleCard(viewer, {
        description: 'Converts an OBJ file to FBX in the browser with assimp compiled to WebAssembly (AssimpJsPlugin), then loads the FBX. Download the converted file.',
        actions: [
            {type: 'button', label: 'Download .fbx', icon: 'download', value: () => downloadBlob(fbx, 'file.fbx')},
        ],
    })

}

_testStart()
init().finally(_testFinish)
