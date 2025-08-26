import {
    _testFinish, _testStart,
    IObject3D,
    LoadingScreenPlugin,
    PopmotionPlugin,
    ThreeViewer,
    TransformAnimationPlugin,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        plugins: [PopmotionPlugin, LoadingScreenPlugin],
    })
    const transformAnimPlugin = viewer.addPluginSync(TransformAnimationPlugin)
    console.log(transformAnimPlugin)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')

    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!model) return

    // Save the initial transform
    transformAnimPlugin.addTransform(model, 'front')

    // Rotate/Move the model and save other transform states

    // left
    model.rotation.set(0, Math.PI / 2, 0)
    model.setDirty?.()
    transformAnimPlugin.addTransform(model, 'left')

    // top
    model.rotation.set(Math.PI / 2, 0, 0)
    model.setDirty?.()
    transformAnimPlugin.addTransform(model, 'top')

    // up
    model.position.set(0, 2, 0)
    model.lookAt(viewer.scene.mainCamera.position)
    model.setDirty?.()
    transformAnimPlugin.addTransform(model, 'up')

    // reset
    transformAnimPlugin.setTransform(model, 'front')

    createSimpleButtons({
        ['Reset']: async() => transformAnimPlugin.animateTransform(model, 'front', 1000),
        ['Left']: async() => transformAnimPlugin.animateTransform(model, 'left', 1000),
        ['Top']: async() => transformAnimPlugin.animateTransform(model, 'top', 1000),
        ['Up']: async() => transformAnimPlugin.animateTransform(model, 'up', 1000),
    })

    const ui = viewer.addPluginSync(TweakpaneUiPlugin, true)
    ui.appendChild(model.uiConfig)

    ui.setupPluginUi(TransformAnimationPlugin, {expanded: true})

}

_testStart()
init().finally(_testFinish)
