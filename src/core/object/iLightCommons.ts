import {ILight} from '../light/ILight'
import {IObjectProcessor, IObjectSetDirtyOptions} from '../IObject'
import {iObjectCommons} from './iObjectCommons'

export const iLightCommons = {
    setDirty: function(this: ILight, options?: IObjectSetDirtyOptions): void {
        this.dispatchEvent({bubbleToParent: true, ...options, type: 'lightUpdate', light: this, object: this}) // this sets sceneUpdate in root scene
        iObjectCommons.setDirty.call(this, options)
    },
    upgradeLight: upgradeLight,
    refreshUi: iObjectCommons.refreshUi,
}

/**
 * Converts three.js Light to ILight setup object events, adds utility methods, and runs objectProcessor.
 * @param parent
 * @param objectProcessor
 */
function upgradeLight(this: ILight, parent?: ILight|undefined, objectProcessor?: IObjectProcessor): void {
    if (!this) return

    iObjectCommons.upgradeObject3D.call(this, parent, objectProcessor)
}
