import {Object3D, PerspectiveCamera} from 'three'
import {generateUiFolder, IUiConfigContainer, uiToggle} from 'uiconfig.js'
import {iObjectCommons, IWidget} from '../../core'
import {onChange2} from 'ts-browser-helpers'

export abstract class AHelperWidget extends Object3D implements IWidget {
    modelObject = this
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

    update() {
        iObjectCommons.setDirty.call(this)
    }

    private _objectUpdate() {
        if (this.object) this.update()
    }

    attach(object: Object3D): this {
        if (this.object) this.detach()
        this.object = object
        if (this.object) {
            this.update()
            this.object.addEventListener('objectUpdate', this._objectUpdate)
            this.object.addEventListener('dispose', this.dispose)
            this.uiConfig && this.object.uiConfig?.children?.push(this.uiConfig)
            this.visible = true
        }
        return this
    }

    detach(): this {
        if (this.object) {
            this.object.removeEventListener('objectUpdate', this._objectUpdate)
            this.object.removeEventListener('dispose', this.dispose)
            if (this.uiConfig) {
                const i = this.object.uiConfig?.children?.indexOf(this.uiConfig)
                if (i !== undefined && i >= 0)
                    this.object.uiConfig?.children?.splice(i, 1)
            }
            this.object = undefined
            this.visible = false
        }
        return this
    }

    uiConfig = generateUiFolder('Widget', this)

}

