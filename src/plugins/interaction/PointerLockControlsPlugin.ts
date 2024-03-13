import {ACameraControlsPlugin} from '../base/ACameraControlsPlugin'
import {TControlsCtor} from '../../core'
import {PointerLockControls2} from '../../three'

export class PointerLockControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'PointerLockControlsPlugin'
    readonly controlsKey = 'pointerLock'

    protected _controlsCtor: TControlsCtor = (object, domElement) => new PointerLockControls2(object, !domElement?.ownerDocument ? (domElement || document).documentElement : domElement)
}
