import {DirectionalLight, Light, Matrix4, SpotLight} from 'three'
import {IUiConfigContainer} from 'uiconfig.js'
import {onChange2} from 'ts-browser-helpers'
import {AHelperWidget} from './AHelperWidget'
import {CameraHelper2} from './CameraHelper2'

export abstract class ALightHelperWidget extends AHelperWidget {

    light: (Light & IUiConfigContainer)|undefined

    /**
     * Draw the frustum of the shadow camera (what the shadows of the light cover) when the light casts shadows.
     * Directional and spot lights only. Set for all widgets with `Object3DWidgetsPlugin.showShadowFrustum`.
     */
    @onChange2(ALightHelperWidget.prototype.update)
        showShadowFrustum = false

    /**
     * The helper of the shadow camera, there while {@link showShadowFrustum} is on and the light casts shadows.
     * It cannot be picked.
     */
    shadowHelper: CameraHelper2 | undefined

    protected constructor(object: Light & IUiConfigContainer) {
        super(object)
        this.light = object
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    preRender() { // req because its a light
        if (!this.visible) return
        this._objectBeforeRender()
    }

    update(setDirty = true) {
        this._updateShadowHelper()
        super.update(setDirty)
    }

    protected _updateShadowHelper() {
        const light = this.object as (DirectionalLight | SpotLight) | undefined
        const shadow = (light as DirectionalLight)?.isDirectionalLight || (light as SpotLight)?.isSpotLight ? light?.shadow : undefined
        if (!light || !shadow || !this.showShadowFrustum || !light.castShadow) {
            if (this.shadowHelper) {
                this.shadowHelper.dispose()
                this.shadowHelper.removeFromParent()
                this.shadowHelper = undefined
            }
            return
        }
        // as the renderer does before rendering the shadow map: the position, direction and projection of the camera
        shadow.updateMatrices(light)
        if (!this.shadowHelper) {
            const helper = new CameraHelper2(shadow.camera)
            helper.showIcon = false
            helper.showFar = true
            helper.userData.userSelectable = false
            // the helper is inside this widget (which has the transform of the light), so it gets its own matrix
            helper.matrix = new Matrix4()
            this.shadowHelper = helper
            this.add(helper)
        }
        const helper = this.shadowHelper
        helper.color = this._lineColor
        helper.matrix.copy(light.matrixWorld).invert().multiply(shadow.camera.matrixWorld)
        helper.matrixWorldNeedsUpdate = true
        helper.update()
    }

    dispose() {
        this.shadowHelper?.dispose()
        super.dispose()
    }
}
