import {Camera} from 'three'
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

}
