import {Camera, Object3D} from 'three'
import {IUiConfigContainer} from 'uiconfig.js'
import {AHelperWidget} from './AHelperWidget'

export abstract class ACameraHelperWidget extends AHelperWidget {
    camera: (Camera & IUiConfigContainer) | undefined
    protected constructor(object: Camera & IUiConfigContainer) {
        super(object)
        this.camera = object
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

    preRender() { // req because its a camera
        if (!this.visible) return
        this._objectBeforeRender()
    }

    attach(object: Object3D): this {
        super.attach(object)
        // listening to cameraUpdate is not needed here
        return this
    }

    detach(): this {
        return super.detach()
    }

}
