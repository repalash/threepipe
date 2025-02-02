import {DataTexture, EquirectangularReflectionMapping, ShaderLib, Vector3} from 'three'
import {onChange, serialize} from 'ts-browser-helpers'
import hdriGroundProj from './HDRiGroundPlugin.glsl'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {shaderReplaceString} from '../../utils'
import {uiPanelContainer, uiSlider, uiToggle, uiVector} from 'uiconfig.js'

@uiPanelContainer('HDRi Ground')
export class HDRiGroundPlugin extends AViewerPluginSync {
    static readonly PluginType = 'HDRiGroundPlugin'

    @serialize()
    @onChange(HDRiGroundPlugin.prototype.setDirty)
    @uiToggle('Enabled')
        enabled = false

    @serialize()
    @onChange(HDRiGroundPlugin.prototype.setDirty)
    @uiSlider('World Radius', [1, 1000], 0.01)
        worldRadius = 100

    @serialize()
    @onChange(HDRiGroundPlugin.prototype.setDirty)
    @uiSlider('Tripod height', [0, 50], 0.01)
        tripodHeight = 10

    @serialize()
    @onChange(HDRiGroundPlugin.prototype.setDirty)
    @uiVector('Origin Position', undefined, 0.001, (t: HDRiGroundPlugin)=>({
        onChange: t.setDirty, // this is for x, y, z values.
    }))
        originPosition = new Vector3(0, 0, 0)

    @serialize()
    @onChange(HDRiGroundPlugin.prototype.setDirty)
        promptOnBackgroundMismatch = true

    // todo
    // /**
    //  * Automatically set the origin position based on the ground position in GroundPlugin
    //  */
    // @serialize()
    // @onChange(HDRiGroundPlugin.prototype.setDirty)
    // @uiToggle('Auto Ground Position')
    // autoGroundPosition = false

    constructor(enabled = false, promptOnBackgroundMismatch = true) {
        super()
        this.setDirty = this.setDirty.bind(this)
        this.enabled = enabled
        this.promptOnBackgroundMismatch = promptOnBackgroundMismatch

        this.addEventListener('deserialize', this.setDirty)
    }

    setDirty() {
        if (!this._viewer) return
        const bg = this._viewer.scene.background
        if (this.enabled && bg !== this._viewer.scene.environment && bg !== 'environment') {
            if (bg && (bg as any).isDataTexture) (bg as DataTexture).mapping = EquirectangularReflectionMapping
            else {
                const change = this.promptOnBackgroundMismatch ? this._viewer.dialog.confirmSync('Background must be same as environment, do you want to change it?') : true
                if (change) {
                    // const bgui = this._viewer.getPlugin<SimpleBackgroundEnvUiPlugin>('SimpleBackgroundEnvUiPlugin1')
                    // if (bgui) {
                    //     bgui.envmapBg = true
                    //     bgui.uiConfig.uiRefresh?.(true, 'postFrame')
                    // } else
                    this._viewer.scene.background = 'environment'
                } else this.enabled = false
            }
        }

        const cubeMat = this._viewer.renderManager.renderer.background.getBoxMesh2()?.material
        const unif = cubeMat?.uniforms ?? ShaderLib.backgroundCube.uniforms
        if (!unif.tripodHeight) unif.tripodHeight = {value: 1.0}
        if (!unif.worldRadius) unif.worldRadius = {value: 1.0}
        if (!unif.originPosition) unif.originPosition = {value: new Vector3()}
        unif.tripodHeight.value = this.tripodHeight
        unif.worldRadius.value = this.worldRadius
        unif.originPosition.value.copy(this.originPosition)
        if (cubeMat) {
            if (this.isDisabled() && cubeMat.defines.HDRi_GROUND_PROJ)
                delete cubeMat.defines.HDRi_GROUND_PROJ
            else if (!this.isDisabled())
                cubeMat.defines.HDRi_GROUND_PROJ = '1'
            cubeMat.needsUpdate = true
        }
        this._viewer.setDirty()
        // const m = this._viewer?.scene.modelRoot.children ?? []
        // for (const m1 of m) {
        //     m1.position.y = -this.tripodHeight + new Box3B().expandByObject(m1, true, true).getSize(new Vector3()).y / 2
        // }
    }

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        if (this._viewer?.renderManager.webglRenderer?.background.getBoxMesh())
            viewer.console.error('HDRi Ground Plugin must be added before setting any cube or env map')

        if (!ShaderLib.backgroundCube.fragmentShader.includes('#ifdef HDRi_GROUND_PROJ')) {
            ShaderLib.backgroundCube.fragmentShader = shaderReplaceString(ShaderLib.backgroundCube.fragmentShader, 'void main() {', hdriGroundProj, {prepend: true})
            ShaderLib.backgroundCube.fragmentShader = shaderReplaceString(ShaderLib.backgroundCube.fragmentShader, 'vec3 vReflect = vWorldDirection;', `
vec3 vReflect = 
#ifdef HDRi_GROUND_PROJ
hdriProject()
#else
vWorldDirection
#endif
;
`)
        }

        viewer.scene.addEventListener('environmentChanged', this.setDirty)
    }


}
