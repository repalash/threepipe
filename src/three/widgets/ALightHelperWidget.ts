import {Light} from 'three'
import {IUiConfigContainer} from 'uiconfig.js'
import {AHelperWidget} from './AHelperWidget'

export abstract class ALightHelperWidget extends AHelperWidget {

    light: (Light & IUiConfigContainer)|undefined
    protected constructor(object: Light & IUiConfigContainer) {
        super(object)
        this.light = object
        this.traverse(o => {
            o.userData.__keepShadowDef = true
            o.castShadow = false
            o.receiveShadow = false
        })
    }

}
