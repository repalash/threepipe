import {ACameraControlsPlugin} from '../base/ACameraControlsPlugin'
import {TControlsCtor} from '../../core'
import {FirstPersonControls2} from '../../three'

export class ThreeFirstPersonControlsPlugin extends ACameraControlsPlugin {
    public static readonly PluginType = 'ThreeFirstPersonControlsPlugin'
    readonly controlsKey = 'threeFirstPerson'

    protected _controlsCtor: TControlsCtor = (object, domElement) => new FirstPersonControls2(object, domElement || document.documentElement)
}
