import {ACameraControlsPlugin} from '../base/ACameraControlsPlugin'
import {TControlsCtor} from '../../core'
import {DeviceOrientationControls2} from '../../three'

export class DeviceOrientationControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'DeviceOrientationControlsPlugin'
    readonly controlsKey = 'deviceOrientation'

    protected _controlsCtor: TControlsCtor = (object, _domElement)=> new DeviceOrientationControls2(object)
}
