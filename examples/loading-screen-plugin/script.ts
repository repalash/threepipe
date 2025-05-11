import {_testFinish, _testStart, IObject3D, LoadingScreenPlugin, ThreeViewer} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    })

    const loadingScreen = viewer.addPluginSync(new LoadingScreenPlugin())
    loadingScreen.loadingTextHeader = 'Loading Helmet 3D Model'
    loadingScreen.errorTextHeader = 'Error Loading Helmet 3D Model'
    loadingScreen.showFileNames = true
    loadingScreen.showProcessStates = true
    loadingScreen.showProgress = true
    loadingScreen.backgroundOpacity = 0.4 // 0-1
    loadingScreen.backgroundBlur = 28 // px

    await viewer.setEnvironmentMap('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr')
    await viewer.load<IObject3D>('https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf')

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    ui.setupPluginUi(LoadingScreenPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
