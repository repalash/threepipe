import type {Light} from 'threepipe'
import {Ctx} from './ctx'

// Blender Light.type — DNA_light_types.h (eLightType).
const LA_LOCAL = 0, LA_SUN = 1, LA_SPOT = 2, LA_AREA = 4
// Blender Light.area_shape — DNA_light_types.h (eLightAreaShape).
const LA_AREA_RECT = 1, LA_AREA_DISK = 4, LA_AREA_ELLIPSE = 5
// Light.mode: the light's "Normalize" box unticked (Blender 4.2+), its power given per square metre of its area.
const LA_UNNORMALIZED = 1 << 25
// Watts -> lumens (Blender's PBR_WATTS_TO_LUMENS), the glTF exporter's "Standard" lighting mode. Only with
// `lightUnits: 'photometric'`: see BlendLightUnits.
const PBR_WATTS_TO_LUMENS = 683

/**
 * How Blender's light power becomes three.js light intensity.
 *
 * - `'blender'` (the default): the light looks as it does in Blender's renders (Standard view transform,
 *   exposure 0). Blender's watts are radiometric and its renderers shade with them as they are: a point or spot
 *   light of P watts has the intensity P / 4π (W/sr), a sun of strength S lights a surface facing it with S W/m².
 *   three.js shades a light of intensity I the same way, so the importer uses I = P / 4π and S.
 * - `'photometric'`: those values x 683 (watts to lumens), as Blender's glTF exporter does in its default
 *   "Standard" lighting mode. For a renderer that applies a physical camera exposure; three.js doesn't, and
 *   lights are then 683 times brighter than in Blender.
 */
export type BlendLightUnits = 'blender' | 'photometric'

// The power Blender renders the light with, in W (W/m² for a sun). Files from Blender 4.0 on store it as
// `energy_new` and write `energy` for older versions, exposure applied and area lights / (π/4)
// (light.cc light_blend_write). Files before 4.0 have only `energy`, area lights on a scale Blender converts
// with x π/4 when it opens them (versioning_400.cc, "Fix area light scaling").
export function lightPower(ldata: any): number {
    const exposure = typeof ldata.exposure === 'number' ? Math.pow(2, ldata.exposure) : 1
    if (typeof ldata.energy_new === 'number') return ldata.energy_new * exposure
    const energy = typeof ldata.energy === 'number' ? ldata.energy : 0
    return (ldata.type === LA_AREA ? energy * Math.PI / 4 : energy) * exposure
}

/**
 * The area Blender multiplies the power of a light with "Normalize" unticked by (`BKE_light_area`, light.cc):
 * an area light's size times its object's scale, a point or spot light's sphere (its radius, not its scale;
 * 4 with no radius), a sun's disk.
 */
export function unnormalizedArea(ldata: any, scale: {x: number, y: number}): number {
    switch (ldata.type) {
    case LA_AREA: {
        const sx = typeof ldata.area_size === 'number' ? ldata.area_size : 0.25
        const sy = ldata.area_shape === LA_AREA_RECT || ldata.area_shape === LA_AREA_ELLIPSE
            ? typeof ldata.area_sizey === 'number' ? ldata.area_sizey : sx
            : sx
        const area = sx * scale.x * sy * scale.y
        return ldata.area_shape === LA_AREA_DISK || ldata.area_shape === LA_AREA_ELLIPSE ? area * Math.PI / 4 : area
    }
    case LA_LOCAL:
    case LA_SPOT: {
        const r = typeof ldata.radius === 'number' ? ldata.radius : 0
        return r > 0 ? 4 * Math.PI * r * r : 4
    }
    case LA_SUN: {
        const half = (typeof ldata.sun_angle === 'number' ? ldata.sun_angle : 0) / 2
        return half > 0 ? Math.PI * Math.sin(half) ** 2 : 1
    }
    }
    return 1
}

/**
 * Convert a Blender Light datablock to a three.js light that lights the scene as Blender's renderers do
 * (see {@link BlendLightUnits}; checked against Cycles renders of each light type in Blender 5.3).
 *
 * - Point: a PointLight of intensity P / 4π.
 * - Spot: a SpotLight of intensity P / 4π (Blender's spot power is that of the point light it cuts the cone
 *   from); cone half-angle spotsize / 2, penumbra spotblend.
 * - Sun: a DirectionalLight of intensity S.
 * - Area: a SpotLight that lights the half-space in front, of intensity P / π: Blender's area light is a
 *   one-sided emitter whose intensity is P / π straight ahead and falls off with the cosine to the side, and
 *   three's spot falloff over a 90° cone with full penumbra (smoothstep(0, 1, cos)) is close to that cosine, with
 *   the same total power. Up close a big area light is softer than any point source.
 *
 * `worldScale` is the light object's scale, for the area of an area light with "Normalize" unticked.
 *
 * The world transform (with the Blender `-Z`-forward → three correction shared with cameras) is applied by
 * `setTransform` in `index.ts`. Sun and Spot lights aim at a `target` child at local `(0,0,-1)`.
 */
export function createLight(lamp: any, ctx: Ctx, worldScale = {x: 1, y: 1}): Light | undefined {
    const ldata = lamp.data
    if (!ldata) return undefined

    let power = lightPower(ldata)
    if ((ldata.mode ?? 0) & LA_UNNORMALIZED) power *= unnormalizedArea(ldata, worldScale)
    if (ctx.lightUnits === 'photometric') power *= PBR_WATTS_TO_LUMENS

    let light: Light
    switch (ldata.type) {
    case LA_SUN: {
        const l = new ctx.DirectionalLight(0xffffff, power)
        l.target.position.set(0, 0, -1); l.add(l.target)
        light = l
        break
    }
    case LA_SPOT: {
        const l = new ctx.SpotLight(0xffffff, power / (4 * Math.PI))
        l.angle = (typeof ldata.spotsize === 'number' ? ldata.spotsize : Math.PI / 4) / 2
        l.penumbra = typeof ldata.spotblend === 'number' ? ldata.spotblend : 0
        l.target.position.set(0, 0, -1); l.add(l.target)
        light = l
        break
    }
    case LA_AREA: {
        const l = new ctx.SpotLight(0xffffff, power / Math.PI)
        l.angle = Math.PI / 2
        l.penumbra = 1
        // the shadow camera's field of view is 2 x angle x focus: 180° can't be projected
        l.shadow.focus = 0.8
        l.target.position.set(0, 0, -1); l.add(l.target)
        light = l
        break
    }
    case LA_LOCAL:
        light = new ctx.PointLight(0xffffff, power / (4 * Math.PI))
        break
    default:
        console.warn('BlendLoader - unsupported light type', ldata.type)
        return undefined
    }

    // Blender stores light color as scene-linear RGB floats; three.js light color lives in the linear
    // working space — match GLTFLoader (color.setRGB(..., LinearSRGBColorSpace)), no 8-bit packing.
    if ((light as any).color && typeof ldata.r === 'number')
        (light as any).color.setRGB(ldata.r, ldata.g, ldata.b) // the default colour space is the linear working space
    light.castShadow = true
    return light
}
