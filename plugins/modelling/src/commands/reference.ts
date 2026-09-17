/**
 * `reference` - calibrated reference planes.
 *
 * The SU-152 report named this its most valuable missing tool, twice: "the photograph was not
 * calibrated", and "keep the reference, editable part, and resulting comparison visible together".
 * Its proportion errors came from eyeballing a photo at an unknown scale and only noticing 115
 * operations later, by which point every attached fitting had to move too.
 *
 * So this is not a picture-in-picture overlay - `ReferenceImagePlugin` in `@threepipe/plugin-mesh-edit`
 * already does that, for a human working by eye. This is a plane in the world at a *known* scale,
 * with two extras that make it a measuring instrument rather than a backdrop:
 *
 * - `calibrate`: name two points on the photo and the real distance between them, and the plane
 *   sizes itself. Everything modelled against it is then in real units from the first command.
 * - a saved camera view, registered to the plane, added automatically. `camera {view: "ref:side"}`
 *   puts the eye exactly where the photograph was framed from, so a capture and the photo can be
 *   compared directly instead of approximately.
 */

import {
    DoubleSide,
    IGeometry,
    iGeometryCommons,
    ITexture,
    IObject3D,
    Mesh2,
    PlaneGeometry,
    SRGBColorSpace,
    UnlitMaterial,
    Vector3,
} from 'threepipe'
import {CommandDefinition, S, schema} from './types'
import {readVec3, Vec3Tuple} from './params'
import {applyCamera} from './session'

/** Orientation of each named plane: its normal, and which way is up on it. */
const PLANES: Record<string, {normal: Vec3Tuple, up: Vec3Tuple}> = {
    front: {normal: [0, 0, 1], up: [0, 1, 0]},
    back: {normal: [0, 0, -1], up: [0, 1, 0]},
    right: {normal: [1, 0, 0], up: [0, 1, 0]},
    left: {normal: [-1, 0, 0], up: [0, 1, 0]},
    top: {normal: [0, 1, 0], up: [0, 0, -1]},
    bottom: {normal: [0, -1, 0], up: [0, 0, 1]},
}

export interface ReferencePlaneState {
    name: string
    src: string
    plane: string
    width: number
    height: number
    origin: Vec3Tuple
    align: 'center' | 'bottom'
    opacity: number
    /** World units per unit of normalised image coordinate. The calibration, in one number. */
    unitsPerImageWidth: number
    object: IObject3D
}

export const referenceCommand: CommandDefinition = {
    op: 'reference',
    summary: 'Place a calibrated reference photograph on a plane in the scene.',
    description:
        'Give it a real-world size with `width`, or let it work one out with `calibrate`: two points '
        + 'on the image in normalised coordinates (0-1, origin top-left) and the distance between '
        + 'them in world units. A camera view named `ref:<name>` is saved at the same time, so '
        + '`camera {view: "ref:<name>"}` frames the model exactly as the photo frames its subject.\n\n'
        + 'Call with no parameters to list the planes currently placed.',
    mutates: false,
    schema: schema({
        name: S.string('Name for this reference. Defaults to the plane name.'),
        image: S.string('Image URL or data URL.'),
        plane: S.enum('Which world plane it sits on.', Object.keys(PLANES)),
        width: S.number('Real-world width the image spans, in scene units.'),
        height: S.number('Real-world height. Defaults to width divided by the image aspect ratio.'),
        origin: S.vec3('Where the plane sits. Default the world origin.'),
        align: S.enum('`center` puts `origin` at the middle; `bottom` puts it at the bottom edge, '
            + 'which lines a side-on photo up with the ground.', ['center', 'bottom']),
        opacity: S.number('0 to 1. Default 0.5.', {minimum: 0, maximum: 1}),
        behind: S.boolean('Draw behind the model rather than intersecting it. Default true.'),
        visible: S.boolean('Show or hide without removing.'),
        calibrate: {
            type: 'object',
            description: 'Set the scale from a known distance in the photo.',
            properties: {
                from: {type: 'array', items: {type: 'number'}, minItems: 2, maxItems: 2,
                    description: 'First point, normalised image coordinates, origin top-left.'},
                to: {type: 'array', items: {type: 'number'}, minItems: 2, maxItems: 2,
                    description: 'Second point.'},
                distance: {type: 'number', description: 'Real distance between them, in scene units.'},
            },
            required: ['from', 'to', 'distance'],
        },
        remove: S.boolean('Remove this reference plane.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const plugin = ctx.plugin
        if (Object.keys(p).filter(k => k !== 'op').length === 0) {
            return {data: {planes: [...plugin.references.values()].map(describe)}}
        }

        const planeName = (p.plane as string) ?? 'front'
        const name = (p.name as string) ?? planeName
        const existing = plugin.references.get(name)

        if (p.remove) {
            if (!existing) throw new Error(`no reference plane named "${name}"`)
            existing.object.removeFromParent()
            existing.object.dispose?.(true)
            plugin.references.delete(name)
            ctx.viewer.setDirty()
            return {data: {removed: name}}
        }

        if (!existing && !p.image) throw new Error('a new reference plane needs an `image`')
        const orientation = PLANES[planeName]
        if (!orientation) {
            throw new Error(`unknown plane "${planeName}" - use one of ${Object.keys(PLANES).join(', ')}`)
        }

        // Load the texture first: its pixel dimensions are what the calibration is expressed in.
        let texture = existing ? (existing.object.material as UnlitMaterial).map as ITexture | null : null
        let src = existing?.src ?? ''
        if (p.image) {
            src = p.image as string
            texture = await ctx.viewer.load<ITexture>(src) ?? null
            if (!texture) throw new Error(`could not load the reference image "${src}"`)
            // A photograph is sRGB; without this it is displayed washed out and the comparison lies.
            texture.colorSpace = SRGBColorSpace
        }
        const image = texture?.image as {width?: number, height?: number} | undefined
        const aspect = image?.width && image?.height ? image.width / image.height : 1

        // Work out the size. `calibrate` wins over `width`, because it is the measured one.
        let width = (p.width as number) ?? existing?.width ?? 1
        if (p.calibrate) {
            const c = p.calibrate as {from: number[], to: number[], distance: number}
            if (!Array.isArray(c.from) || !Array.isArray(c.to) || typeof c.distance !== 'number') {
                throw new Error('calibrate needs {from: [u, v], to: [u, v], distance}')
            }
            // Normalised coordinates are square-space; convert v to the same units as u using aspect.
            const du = c.to[0] - c.from[0]
            const dv = (c.to[1] - c.from[1]) / aspect
            const span = Math.hypot(du, dv)
            if (span < 1e-6) throw new Error('the two calibration points are in the same place')
            if (!(c.distance > 0)) throw new Error('the calibration distance must be positive')
            width = c.distance / span
        }
        const height = (p.height as number) ?? width / aspect

        let state = existing
        if (!state) {
            const material = new UnlitMaterial({
                transparent: true,
                side: DoubleSide,
                depthWrite: false,
                toneMapped: false,
            })
            // A plain three geometry has to be upgraded before threepipe will take it: that is what
            // gives it `setDirty`, disposal tracking and an asset type.
            const geometry = iGeometryCommons.upgradeGeometry.call(
                new PlaneGeometry(1, 1) as unknown as IGeometry)
            const object = new Mesh2(geometry, material) as unknown as IObject3D
            object.name = `reference:${name}`
            // Not an editable object: it must not be picked, exported or counted as model geometry.
            object.userData.__isReferencePlane = true
            object.userData.userSelectable = false
            object.userData.excludeFromExport = true
            ctx.viewer.scene.addObject(object, {autoScale: false, autoCenter: false})
            state = {
                name, src, plane: planeName, width, height,
                origin: [0, 0, 0], align: 'center', opacity: 0.5,
                unitsPerImageWidth: width, object,
            }
            plugin.references.set(name, state)
        }

        const material = state.object.material as UnlitMaterial
        if (texture) material.map = texture as never
        if (p.opacity !== undefined) state.opacity = p.opacity as number
        material.opacity = state.opacity
        material.depthTest = p.behind === undefined ? true : !(p.behind as boolean)
        state.object.renderOrder = p.behind === false ? 0 : -1
        material.setDirty?.()

        state.src = src
        state.plane = planeName
        state.width = width
        state.height = height
        state.unitsPerImageWidth = width
        if (p.align !== undefined) state.align = p.align as 'center' | 'bottom'
        if (p.origin !== undefined) state.origin = readVec3(p.origin, [0, 0, 0], 'origin')
        if (p.visible !== undefined) state.object.visible = p.visible as boolean

        // Place it: face the normal, size to the calibrated dimensions, and offset for `align`.
        const normal = new Vector3(...orientation.normal)
        const up = new Vector3(...orientation.up)
        const origin = new Vector3(...state.origin)
        state.object.scale.set(width, height, 1)
        state.object.position.copy(origin)
        if (state.align === 'bottom') state.object.position.addScaledVector(up, height / 2)
        state.object.lookAt(state.object.position.clone().add(normal))
        state.object.up.copy(up)
        state.object.setDirty?.()
        ctx.viewer.setDirty()

        // Register the matching camera view, so a capture can be compared to the photo directly.
        const views = ctx.viewer.getPlugin<any>('CameraViews')
        let savedView: string | null = null
        if (views) {
            const camera = ctx.viewer.scene.mainCamera
            const fov = (camera as unknown as {fov?: number}).fov ?? 45
            // Distance at which the plane's height exactly fills the frame.
            const distance = height / 2 / Math.tan(fov * Math.PI / 360)
            const centre = state.object.position.clone()
            const savedPos = camera.position.clone()
            const savedTarget = camera.target.clone()
            applyCamera(ctx.viewer, centre.clone().addScaledVector(normal, distance), centre)
            const view = views.getView()
            view.name = `ref:${name}`
            const prev = views.camViews?.find((v: any) => v.name === view.name)
            if (prev) views.deleteView(prev, true)
            views.addView(view, true)
            savedView = view.name
            // Leave the camera where it was; placing a reference should not move the user's view.
            applyCamera(ctx.viewer, savedPos, savedTarget)
        } else {
            ctx.warn('CameraViewPlugin is not loaded, so no registered view was saved for this plane')
        }

        return {
            data: {
                ...describe(state),
                savedView,
                imagePixels: image?.width && image?.height ? [image.width, image.height] : null,
                unitsPerPixel: image?.width ? width / image.width : null,
            },
        }
    },
}

function describe(state: ReferencePlaneState) {
    return {
        name: state.name,
        plane: state.plane,
        src: state.src.length > 120 ? state.src.slice(0, 60) + '...' : state.src,
        width: state.width,
        height: state.height,
        origin: state.origin,
        align: state.align,
        opacity: state.opacity,
        visible: state.object.visible,
    }
}

export const referenceCommands = [referenceCommand]
