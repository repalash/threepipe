import {Object3D, PerspectiveCamera} from 'three'
import {generateUiFolder, IUiConfigContainer, uiToggle} from 'uiconfig.js'
import {Group2, iObjectCommons, IWidget} from '../../core'
import {onChange2} from 'ts-browser-helpers'

export abstract class AHelperWidget extends Group2 implements IWidget {
    isWidget = true as const
    assetType = 'widget' as const

    object: (Object3D & IUiConfigContainer) | undefined

    @uiToggle()
    @onChange2(AHelperWidget.prototype.update)
        visible = true

    protected constructor(object: Object3D & IUiConfigContainer, attach = true) {
        super()
        this.object = object
        this.object.updateMatrixWorld()
        if ((this.object as PerspectiveCamera).updateProjectionMatrix)
            (this.object as PerspectiveCamera).updateProjectionMatrix()

        this.matrix = object.matrixWorld
        this.matrixAutoUpdate = false

        this.detach = this.detach.bind(this)
        this._objectUpdate = this._objectUpdate.bind(this)
        this._objectBeforeRender = this._objectBeforeRender.bind(this)
        attach && this.attach(object)
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
        this.renderOrder = 100

    }

    update(setDirty = true) {
        setDirty && iObjectCommons.setDirty.call(this)
    }

    private _objectUpdated = false
    protected _objectUpdate() {
        this._objectUpdated = true
    }
    // todo in threejs onbeforerender is not called on objects, lights etc, only meshes and scene, see ALightHelperWidget and skeleton helper
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
        if (this.uiConfig) {
            const i = this.object.uiConfig?.children?.indexOf(this.uiConfig)
            if (i !== undefined && i >= 0)
                this.object.uiConfig?.children?.splice(i, 1)
        }
        this.object = undefined
        this.visible = false
        return this
    }

    uiConfig = generateUiFolder('Widget', this, {tags: 'widget'})

    dispose() {
        this.detach()
    }
}

