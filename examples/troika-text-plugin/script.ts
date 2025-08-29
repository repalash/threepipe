import {
    _testFinish,
    _testStart,
    DepthBufferPlugin,
    IObject3D,
    LoadingScreenPlugin,
    Object3DGeneratorPlugin,
    PickingPlugin,
    PopmotionPlugin,
    ThreeViewer,
} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import {BloomPlugin} from '@threepipe/webgi-plugins'
import {TroikaTextPlugin} from '@threepipe/plugin-troika-text'

async function init() {

    const viewer = new ThreeViewer({
        canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
        renderScale: 'auto',
        plugins: [LoadingScreenPlugin, DepthBufferPlugin, Object3DGeneratorPlugin, BloomPlugin, PickingPlugin, TroikaTextPlugin],
    })

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const object = await viewer.load<IObject3D>('https://samples.threepipe.org/minimal/DamagedHelmet/glTF/DamagedHelmet.gltf', {
        autoCenter: true,
        autoScale: true,
    })
    if (!object) {
        console.error('Failed to load model')
        return
    }

    const popmotion = viewer.getOrAddPluginSync(PopmotionPlugin)
    popmotion.animate({
        from: 0,
        to: 1,
        duration: 8000,
        repeat: Infinity,
        repeatType: 'mirror',
        onUpdate: (v) => {
            object.position.x = Math.sin(v * Math.PI * 2) * 2
            object.position.y = Math.cos(v * Math.PI * 2) * 2
            // object.position.z = Math.sin(v * Math.PI * 4) * 1
            object.rotation.y = v * Math.PI * 2
            object.setDirty()
        },
    })

    const plugin = viewer.getPlugin(TroikaTextPlugin)!
    const positionText = plugin.createText({
        text: `Position: ${object.position.toArray().map(v=>v.toFixed(2)).join(' ')}`,
        fontSize: 0.2,
    })
    object.add(positionText)
    positionText.position.set(0, 1.6, 0)
    const rotationText = plugin.createText({
        text: `Rotation: ${object.rotation.y.toFixed(2)}`,
        fontSize: 0.2,
    })
    object.add(rotationText)
    rotationText.position.set(0, 1.3, 0)
    // or viewer.getPlugin(Object3DGeneratorPlugin)?.generate('troika-text-plane', {text: 'Hello'})

    viewer.addEventListener('preFrame', ()=>{
        positionText.lookAt(viewer.scene.mainCamera.position)
        rotationText.lookAt(viewer.scene.mainCamera.position)
        plugin.updateText(positionText, {text: `Position: ${object.position.toArray().map(v=>v.toFixed(2)).join(' ')}`})
        plugin.updateText(rotationText, {text: `Rotation: ${object.rotation.y.toFixed(2)}`})
    })

    viewer.scene.backgroundColor?.set(0x222222)

    const ui = viewer.addPluginSync(new TweakpaneUiPlugin(true))
    // ui.appendChild(obj.uiConfig)
    ui.setupPluginUi(Object3DGeneratorPlugin, {expanded: true})
    ui.setupPluginUi(PickingPlugin)

    viewer.fitToView(undefined, 3)

}

_testStart()
init().finally(_testFinish)

