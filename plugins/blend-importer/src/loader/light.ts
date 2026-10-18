import {Light, LinearSRGBColorSpace} from 'threepipe'
import {Ctx} from './ctx'

// Blender Light.type — DNA_light_types.h (eLightType).
const LA_LOCAL = 0, LA_SUN = 1, LA_SPOT = 2, LA_AREA = 4
// Blender Light.area_shape — DNA_light_types.h (eLightAreaShape).
const LA_AREA_RECT = 1, LA_AREA_DISK = 4, LA_AREA_ELLIPSE = 5
// Radiometric watts → photometric lumens (Blender's PBR_WATTS_TO_LUMENS), matching the glTF exporter's
// physically-based ("SPEC", the default) lighting mode (lights.py:181-183). three.js r155+ uses physical
// photometric units — PointLight/SpotLight in candela (lm/sr), DirectionalLight in lux (lm/m²) — and
// threepipe removed `useLegacyLights` in r168, so this is the correct intensity for the current renderer.
const PBR_WATTS_TO_LUMENS = 683

// Emitter area (m²) for an Area lamp — the exporter scales intensity by this since glTF has no area light.
function areaOf(ldata: any): number {
    const x = typeof ldata.area_size === 'number' ? ldata.area_size : 0.25
    const y = typeof ldata.area_sizey === 'number' ? ldata.area_sizey : x
    switch (ldata.area_shape) {
    case LA_AREA_RECT: return x * y
    case LA_AREA_DISK: return Math.PI * (x / 2) * (x / 2)
    case LA_AREA_ELLIPSE: return Math.PI * (x / 2) * (y / 2)
    default: return x * x // LA_AREA_SQUARE
    }
}

/**
 * Convert a Blender Lamp datablock to a three.js light, following the Blender glTF exporter's
 * KHR_lights_punctual mapping (`lights.py` / `light_spots.py`) and three.js's own GLTFLoader light setup.
 *
 * The light's world transform (position/rotation, including the Blender `-Z`-forward → three correction
 * shared with cameras) is applied by `setTransform` in `index.ts` — NOT here. Sun/Spot directionality
 * uses three's target-child trick: a `target` at local `(0,0,-1)` so the object's orientation aims it.
 */
export function createLight(lamp: any, ctx: Ctx): Light | undefined {
    const ldata = lamp.data
    if (!ldata) return undefined

    const energy = typeof ldata.energy === 'number' ? ldata.energy : 0
    const exposure = typeof ldata.exposure === 'number' ? ldata.exposure : 0
    const exp = Math.pow(2, exposure)
    // Point/Spot are omnidirectional W → candela (÷4π); Sun is W/m² → lux (no ÷4π). (lights.py:175-183)
    const candela = energy / (4 * Math.PI) * PBR_WATTS_TO_LUMENS * exp
    const lux = energy * PBR_WATTS_TO_LUMENS * exp

    let light: Light
    switch (ldata.type) {
    case LA_SUN: {
        const l = new ctx.DirectionalLight(0xffffff, lux)
        l.target.position.set(0, 0, -1); l.add(l.target) // GLTFLoader.js:595-596
        light = l
        break
    }
    case LA_SPOT: {
        const l = new ctx.SpotLight(0xffffff, candela)
        // three `angle` = outer cone half-angle = spotsize/2; `penumbra` = spotblend (light_spots.py:39,47,57).
        l.angle = (typeof ldata.spotsize === 'number' ? ldata.spotsize : Math.PI / 4) / 2
        l.penumbra = typeof ldata.spotblend === 'number' ? ldata.spotblend : 0
        l.target.position.set(0, 0, -1); l.add(l.target)
        light = l
        break
    }
    case LA_AREA:
        // glTF has no area light: the exporter emits a Point with intensity scaled by emitter area
        // (lights.py:145,160). (RectAreaLight is unsuitable — no shadows, MeshStandardMaterial-only.)
        light = new ctx.PointLight(0xffffff, candela * areaOf(ldata))
        break
    case LA_LOCAL:
        light = new ctx.PointLight(0xffffff, candela)
        break
    default:
        console.warn('BlendLoader - unsupported light type', ldata.type)
        return undefined
    }

    // Blender stores light color as scene-linear RGB floats; three.js light color lives in the linear
    // working space — match GLTFLoader (color.setRGB(..., LinearSRGBColorSpace)), no 8-bit packing.
    if ((light as any).color && typeof ldata.r === 'number')
        (light as any).color.setRGB(ldata.r, ldata.g, ldata.b, LinearSRGBColorSpace)
    light.castShadow = true
    return light
}
