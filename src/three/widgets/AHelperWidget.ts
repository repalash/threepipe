import {Object3D, PerspectiveCamera} from 'three'
import {generateUiFolder, IUiConfigContainer, uiToggle} from 'uiconfig.js'
import {iObjectCommons, IWidget} from '../../core'
import {onChange2} from 'ts-browser-helpers'

export abstract class AHelperWidget extends Object3D implements IWidget {
    isWidget = true as const
    assetType = 'widget'

    object: (Object3D & IUiConfigContainer) | undefined

    @uiToggle()
    @onChange2(AHelperWidget.prototype.update)
        visible = true

    protected constructor(object: Object3D & IUiConfigContainer) {
        super()
        this.object = object
        this.object.updateMatrixWorld()
        if ((this.object as PerspectiveCamera).updateProjectionMatrix)
            (this.object as PerspectiveCamera).updateProjectionMatrix()

        this.matrix = object.matrixWorld
        this.matrixAutoUpdate = false

        this.dispose = this.dispose.bind(this)
        this._objectUpdate = this._objectUpdate.bind(this)
        this._objectBeforeRender = this._objectBeforeRender.bind(this)
        this.attach(object)
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    dispose() {
        this.detach()
    }

    update(setDirty = true) {
        setDirty && iObjectCommons.setDirty.call(this)
    }

    private _objectUpdated = false
    protected _objectUpdate() {
        this._objectUpdated = true
    }
    // todo in threejs onbeforerender is not called on objects, only meshes and scene, see skeleton helper
    protected _objectBeforeRender() {
        if (!this._objectUpdated) return
        this._objectUpdated = false
        if (this.object) this.update()
    }

    attach(object: Object3D): this {
        if (this.object) this.detach()
        this.object = object
        if (this.object) {
            this.update()
            this.object.addEventListener('beforeRender', this._objectBeforeRender)
            this.object.addEventListener('objectUpdate', this._objectUpdate)
            this.object.addEventListener('geometryUpdate', this._objectUpdate)
            this.object.addEventListener('dispose', this.dispose)
            this.uiConfig && this.object.uiConfig?.children?.push(this.uiConfig)
            this.visible = true
        }
        return this
    }

    detach(): this {
        if (!this.object) return this
        this.object.removeEventListener('beforeRender', this._objectBeforeRender)
        this.object.removeEventListener('objectUpdate', this._objectUpdate)
        this.object.removeEventListener('geometryUpdate', this._objectUpdate)
        this.object.removeEventListener('dispose', this.dispose)
        if (this.uiConfig) {
            const i = this.object.uiConfig?.children?.indexOf(this.uiConfig)
            if (i !== undefined && i >= 0)
                this.object.uiConfig?.children?.splice(i, 1)
        }
        this.object = undefined
        this.visible = false
        return this
    }

    uiConfig = generateUiFolder('Widget', this)

    /**
     * @deprecated - not required
     */
    modelObject = this

}

