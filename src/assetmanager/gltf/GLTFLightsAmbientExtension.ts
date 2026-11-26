import type {GLTFLoaderPlugin, GLTFParser} from 'three/examples/jsm/loaders/GLTFLoader.js'
import type {GLTFExporterPlugin, GLTFWriter} from 'three/examples/jsm/exporters/GLTFExporter.js'
import {AmbientLight, Color, HemisphereLight, LinearSRGBColorSpace, Object3D} from 'three'
import {AmbientLight2, HemisphereLight2} from '../../core'

/**
 * A light of the `WEBGI_lights_ambient` extension: an entry of the `lights` array at the root of the file.
 */
export interface GLTFLightsAmbientLightDef {
    type: 'ambient' | 'hemisphere'
    name?: string
    /**
     * Linear sRGB, default `[1, 1, 1]`. The sky colour of a hemisphere light.
     */
    color?: [number, number, number]
    /**
     * Linear sRGB, default `[1, 1, 1]`. Hemisphere lights only.
     */
    groundColor?: [number, number, number]
    /**
     * Default 1, the `intensity` of three.js `AmbientLight` and `HemisphereLight`.
     */
    intensity?: number
}

/**
 * `WEBGI_lights_ambient`: saves ambient and hemisphere lights in glTF, which `KHR_lights_punctual` leaves out (it has only
 * directional, point and spot lights; its first draft also had ambient and hemisphere lights).
 *
 * It is laid out like `KHR_lights_punctual`: the lights are in a `lights` array in the extension at the root of the
 * file, and a node uses one with `{"light": <index>}` in its own extension. On import, the node is the light
 * ({@link AmbientLight2} or {@link HemisphereLight2}), with the node's name, transform and extras.
 *
 * ```json
 * "extensions": {"WEBGI_lights_ambient": {"lights": [
 *     {"type": "ambient", "color": [1, 1, 1], "intensity": 0.5},
 *     {"type": "hemisphere", "color": [0.6, 0.8, 1], "groundColor": [0.3, 0.25, 0.2], "intensity": 1}
 * ]}},
 * "nodes": [{"name": "Ambient", "extensions": {"WEBGI_lights_ambient": {"light": 0}}}]
 * ```
 *
 * The light comes from all directions, so the node's rotation and scale are not used. A hemisphere light, as three.js
 * `HemisphereLight`, takes its sky direction from the world origin to the node's world position (`[0, 1, 0]` in
 * three.js by default, so the sky is up).
 *
 * The other properties of the light object (`visible`, the `userData` and so on) are saved by `WEBGI_object3d_extras`.
 */
export class GLTFLightsAmbientExtension {
    static readonly WebGiLightsAmbientExtension = 'WEBGI_lights_ambient'

    /**
     * Also {@link Export}
     * @param parser
     */
    static Import = (parser: GLTFParser): GLTFLoaderPlugin => ({
        name: this.WebGiLightsAmbientExtension,
        createNodeAttachment: (nodeIndex: number) => {
            const json = parser.json
            const index = json.nodes?.[nodeIndex]?.extensions?.[this.WebGiLightsAmbientExtension]?.light
            if (index === undefined) return null
            const def: GLTFLightsAmbientLightDef | undefined = json.extensions?.[this.WebGiLightsAmbientExtension]?.lights?.[index]
            if (!def) {
                console.warn(`GLTFLightsAmbientExtension: no light ${index} in ${this.WebGiLightsAmbientExtension}.lights, node ${nodeIndex}`)
                return null
            }
            // a new light for each node that uses it, like the meshes of a node; the node's name and transform are set on it after
            const light = createLight(def)
            if (!light) {
                console.warn('GLTFLightsAmbientExtension: unknown light type', def.type)
                return null
            }
            light.name = parser.createUniqueName(def.name || 'light_' + index)
            return Promise.resolve(light)
        },
    })

    /**
     * Also {@link Import}
     */
    static Export = (w: GLTFWriter): GLTFExporterPlugin => ({
        writeNode: (object: any, nodeDef: any) => {
            const isAmbient = !!(object as AmbientLight)?.isAmbientLight
            const isHemisphere = !!(object as HemisphereLight)?.isHemisphereLight
            if (!isAmbient && !isHemisphere) return
            const light = object as AmbientLight | HemisphereLight
            const def: GLTFLightsAmbientLightDef = {type: isAmbient ? 'ambient' : 'hemisphere'}
            if (light.name) def.name = light.name
            const color = light.color.toArray() as [number, number, number] // linear, as the working colour space
            if (!isWhite(color)) def.color = color
            if (isHemisphere) {
                const groundColor = (light as HemisphereLight).groundColor.toArray() as [number, number, number]
                if (!isWhite(groundColor)) def.groundColor = groundColor
            }
            if (light.intensity !== 1) def.intensity = light.intensity

            const json = w.json as any
            if (!json.extensions) json.extensions = {}
            if (!json.extensions[this.WebGiLightsAmbientExtension]) json.extensions[this.WebGiLightsAmbientExtension] = {lights: []}
            const lights = json.extensions[this.WebGiLightsAmbientExtension].lights as GLTFLightsAmbientLightDef[]
            lights.push(def)
            if (!nodeDef.extensions) nodeDef.extensions = {}
            nodeDef.extensions[this.WebGiLightsAmbientExtension] = {light: lights.length - 1}
            w.extensionsUsed[this.WebGiLightsAmbientExtension] = true
        },
    })
}

function createLight(def: GLTFLightsAmbientLightDef): Object3D | undefined {
    const color = new Color(1, 1, 1)
    if (def.color) color.setRGB(def.color[0], def.color[1], def.color[2], LinearSRGBColorSpace)
    let light: AmbientLight2 | HemisphereLight2
    if (def.type === 'ambient') {
        light = new AmbientLight2(color)
    } else if (def.type === 'hemisphere') {
        const groundColor = new Color(1, 1, 1)
        if (def.groundColor) groundColor.setRGB(def.groundColor[0], def.groundColor[1], def.groundColor[2], LinearSRGBColorSpace)
        light = new HemisphereLight2(color, groundColor)
    } else return undefined
    if (def.intensity !== undefined) light.intensity = def.intensity
    // HemisphereLight starts at [0, 1, 0]. The node sets the position only when it has a translation (as in KHR_lights_punctual)
    light.position.set(0, 0, 0)
    return light
}

function isWhite(c: number[]) {
    return c[0] === 1 && c[1] === 1 && c[2] === 1
}
