import {SVGRenderer} from 'three/examples/jsm/renderers/SVGRenderer.js'
import {uiDropdown, uiFolderContainer, uiNumber, uiToggle} from 'uiconfig.js'
import {onChange2} from 'ts-browser-helpers'

@uiFolderContainer('Basic SVG Renderer')
export class BasicSVGRenderer extends SVGRenderer {
    @uiToggle()
    declare autoClear: boolean
    @uiToggle()
    declare sortObjects: boolean
    @uiToggle()
    declare sortElements: boolean
    @uiNumber()
    declare overdraw: number

    @uiDropdown(undefined, ['low', 'high'])
    @onChange2(BasicSVGRenderer.prototype._refresh)
        quality: 'low' | 'high' = 'high'

    private _refresh() {
        this.setQuality(this.quality)
    }
}
