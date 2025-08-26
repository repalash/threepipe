import {
    _testFinish, _testStart,
    downloadBlob,
    FloatType,
    GBufferPlugin,
    HalfFloatType,
    IObject3D,
    LoadingScreenPlugin,
    RenderTargetPreviewPlugin,
    ThreeViewer,
} from 'threepipe'
import {createSimpleButtons} from '../examples-utils/simple-bottom-buttons.js'

const viewer = new ThreeViewer({
    canvas: document.getElementById('mcanvas') as HTMLCanvasElement,
    msaa: true,
    zPrepass: true,
    plugins: [LoadingScreenPlugin],
})

async function init() {

    const gbufferPlugin = viewer.addPluginSync(new GBufferPlugin(
        HalfFloatType,
        true, // isPrimaryGBuffer (used for zprepass etc)
        true, // enabled by default
        true, // render the flags buffer (used for eg selective tonemapping)
        true, // render depth texture
        FloatType)) // render depth texture as Float type. available - UnsignedShort(16 bits), UnsignedInt(24 bits) or Float(32 bits)

    await viewer.setEnvironmentMap('https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
    const model = await viewer.load<IObject3D>('https://samples.threepipe.org/demos/kira.glb', {
        autoCenter: true,
        autoScale: true,
    })

    let id = 1
    model?.traverse((o) => {
        o.materials?.forEach(m=>{
            if (!m.userData.gBufferData) m.userData.gBufferData = {}
            if (!m.userData.gBufferData.materialId) m.userData.gBufferData.materialId = id += 10
        })
    })

    // Disable automatic near/far plane calculation based on scene bounding box
    viewer.scene.mainCamera.userData.autoNearFar = false
    viewer.scene.mainCamera.userData.minNearPlane = 1
    viewer.scene.mainCamera.userData.maxFarPlane = 10
    viewer.scene.refreshScene()

    const gbufferTarget = gbufferPlugin.target
    if (!gbufferTarget) {
        throw new Error('gbufferPlugin.target returned undefined')
    }

    // to render depth buffer to screen, uncomment this line:
    // viewer.renderManager.screenPass.overrideReadBuffer = gbufferTarget

    const getNormalDepth = ()=>({texture: gbufferPlugin.normalDepthTexture})
    const getFlags = ()=>({texture: gbufferPlugin.flagsTexture})
    const getDepthTexture = ()=>({texture: gbufferPlugin.depthTexture})

    const targetPreview = viewer.addPluginSync(RenderTargetPreviewPlugin)
    targetPreview.addTarget(getNormalDepth, 'normalDepth')
    targetPreview.addTarget(getFlags, 'gBufferFlags')
    targetPreview.addTarget(getDepthTexture, 'depthTexture')

    const screenPass = viewer.renderManager.screenPass

    createSimpleButtons({
        ['Toggle Normal+Depth']: () => {
            const rt = getNormalDepth()
            screenPass.overrideReadBuffer = screenPass.overrideReadBuffer?.texture === rt.texture ? null : rt
            viewer.setDirty()
        },
        ['Toggle Gbuffer Flags']: () => {
            const rt = getFlags()
            screenPass.overrideReadBuffer = screenPass.overrideReadBuffer?.texture === rt.texture ? null : rt
            viewer.setDirty()
        },
        ['Toggle Depth Texture']: () => {
            const rt = getDepthTexture()
            screenPass.overrideReadBuffer = screenPass.overrideReadBuffer?.texture === rt.texture ? null : rt
            viewer.setDirty()
        },
        ['Download snapshot']: async(btn: HTMLButtonElement) => {
            btn.disabled = true
            const blob = await viewer.getScreenshotBlob({mimeType: 'image/png'})
            if (blob) downloadBlob(blob, 'file.png')
            else console.error('Unable to get screenshot')
            btn.disabled = false
        },
    })

}

_testStart()
init().finally(_testFinish)
