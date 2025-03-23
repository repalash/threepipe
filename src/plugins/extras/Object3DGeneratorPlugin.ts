import {AViewerPluginSync} from '../../viewer'
import {
    AmbientLight2,
    DirectionalLight2,
    HemisphereLight2,
    IObject3D,
    PerspectiveCamera2,
    PointLight2,
    RectAreaLight2,
    SpotLight2,
} from '../../core'
import {uiButton, uiDropdown, uiPanelContainer} from 'uiconfig.js'
import {Vector3} from 'three'

/**
 * Adds support for generating different types of lights and camera objects in the viewer.
 * @category Plugins
 */
@uiPanelContainer('Generate Scene Objects')
export class Object3DGeneratorPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'Object3DGeneratorPlugin'
    enabled = true
    toJSON: any = undefined

    @uiDropdown('Type', undefined, (that)=>({
        children: [()=>Object.keys(that.generators).map(label=>({label}))],
    }))
    protected _selectedType = ''

    @uiButton('Generate', {sendArgs: false})
    generate(type?: string, params?: any, addToScene = true, select = true) {
        if (!this._viewer) throw new Error('No viewer')
        const obj = this.generators[type ?? this._selectedType]?.(params)
        addToScene && obj && this._viewer.scene.addObject(obj)
        select && obj.dispatchEvent({type: 'select', value: obj, object: obj, ui: true})
        return obj
    }

    generators: Record<string, (params?: any)=>IObject3D> = {
        ['camera-perspective']: (params: {
            controlsMode?: string,
            autoAspect?: boolean,
            fov?: number,
            aspect?: number,
            position?: Vector3,
            target?: Vector3,
            autoLookAtTarget?: boolean,
            name?: string,
        } = {})=>{
            const camera = new PerspectiveCamera2(
                params.controlsMode ?? '',
                this._viewer?.canvas,
                params.autoAspect,
                params.fov,
                params.aspect,
            )
            params.position ? camera.position.copy(params.position) : camera.position.set(0, 0, 5)
            params.target ? camera.target.copy(params.target) : camera.target.set(0, 0, 0)
            camera.autoLookAtTarget = params.autoLookAtTarget ?? true
            camera.setDirty()
            camera.name = params.name ?? 'Perspective Camera'
            return camera
        },
        ['light-directional']: (params: {
            color?: number,
            intensity?: number,
            position?: Vector3,
            target?: Vector3,
            name?: string,
        } = {})=>{
            const light = new DirectionalLight2(params.color ?? 0xff0000, params.intensity ?? 3)
            params.position ? light.position.copy(params.position) : light.position.set(5, 5, 5)
            light.lookAt(params.target ?? new Vector3(0, 0, 0))
            light.name = 'Directional Light'
            return light
        },
        ['light-ambient']: (params: {
            color?: number,
            intensity?: number,
            name?: string,
        } = {})=>{
            const light = new AmbientLight2(params.color ?? 0xffffff, params.intensity ?? 1)
            light.name = 'Ambient Light'
            return light
        },
        ['light-point']: (params: {
            color?: number,
            intensity?: number,
            position?: Vector3,
            name?: string,
        } = {})=>{
            const light = new PointLight2(params.color ?? 0xff0000, params.intensity ?? 3)
            params.position ? light.position.copy(params.position) : light.position.set(5, 5, 5)
            light.name = 'Point Light'
            return light
        },
        ['light-spot']: (params: {
            color?: number,
            intensity?: number,
            position?: Vector3,
            target?: Vector3,
            name?: string,
        } = {})=>{
            const light = new SpotLight2(params.color ?? 0xff0000, params.intensity ?? 3)
            params.position ? light.position.copy(params.position) : light.position.set(5, 5, 5)
            light.lookAt(params.target ?? new Vector3(0, 0, 0))
            light.name = 'Spot Light'
            return light
        },
        ['light-hemisphere']: (params: {
            color?: number,
            intensity?: number,
            name?: string,
        } = {})=>{
            const light = new HemisphereLight2(params.color ?? 0xaaaaff, 0x555443, params.intensity ?? 1)
            light.name = 'Hemisphere Light'
            return light
        },
        ['light-rect-area']: (params: {
            color?: number,
            intensity?: number,
            position?: Vector3,
            target?: Vector3,
            name?: string,
        } = {})=>{
            const light = new RectAreaLight2(params.color ?? 0x000ff, params.intensity ?? 3, 2, 2)
            params.position ? light.position.copy(params.position) : light.position.set(5, 5, 5)
            light.lookAt(params.target ?? new Vector3(0, 0, 0))
            light.name = 'Rect Area Light'
            return light
        },
    }

    constructor() {
        super()
        this._selectedType = Object.keys(this.generators)[0]
    }

}
