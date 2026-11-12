import {
    _testFinish,
    _testStart,
    downloadBlob,
    HemisphereLight,
    IObject3D,
    LoadingScreenPlugin,
    ThreeViewer,
} from 'threepipe'
import {AssimpJsPlugin} from '@threepipe/plugin-assimpjs'
import {createExampleBar} from '../examples-utils/example-bar.js'

const viewer = new ThreeViewer({
    renderScale: 'auto',
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    plugins: [LoadingScreenPlugin],
})

// Export to fbx is done by first exporting to glb and converting that to fbx using AssimpJsPlugin

async function init() {

    const assimp = viewer.addPluginSync(AssimpJsPlugin)
    await assimp.init()

    viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    // load a file
    const result = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })

    let fbxBlob: Blob | undefined = undefined
    let converting = false
    async function exportFbx() {
        if (fbxBlob) return fbxBlob
        if (converting) {
            console.warn('Already converting, please wait...')
            return
        }
        converting = true

        // export to glb
        fbxBlob = await assimp.exportModel('fbx', result, {
            embedUrlImages: true,
        })
        // const blob = await viewer.exportScene(); // its possible to export the whole scene also
        if (!fbxBlob) {
            alert('Failed to convert glb to fbx')
            converting = false
            return
        }

        // clear scene
        viewer.scene.disposeSceneModels()

        // load a light and fbx file
        const hemiLight = viewer.scene.addObject(new HemisphereLight(0xffffff, 0x444444, 5), {addToRoot: true})
        hemiLight.name = 'Hemisphere Light'
        await viewer.load({
            path: 'file.fbx',
            file: fbxBlob,
        }, {
            autoCenter: true,
            autoScale: true,
        })

        converting = false
        return fbxBlob
    }

    createExampleBar(viewer, [
        {type: 'button', label: 'Convert to fbx', icon: 'refresh-cw', value: async() => exportFbx()},
        {type: 'button', label: 'Download as .fbx', icon: 'download', value: async() => {
            await exportFbx()
            if (fbxBlob) downloadBlob(fbxBlob, 'file.fbx')
        }},
    ])

}

_testStart()
init().finally(_testFinish)
