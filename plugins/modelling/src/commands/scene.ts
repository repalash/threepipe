/**
 * Scene-level commands: `rename`, `material`, `select`, `light`, `lighting`, `display`.
 *
 * None of these touch topology. They exist because a modelling session is not only geometry - an
 * agent that cannot name a part cannot refer to it later, and one that cannot change a colour or a
 * light cannot tell from a screenshot whether the shape it just built is the shape it meant.
 */

import {
    AmbientLight2,
    Color,
    DirectionalLight2,
    IObject3D,
    PhysicalMaterial,
    PointLight2,
    SpotLight2,
} from 'threepipe'
import {CommandDefinition, S, schema} from './types'
import {readTarget, readTargets, readVec3} from './params'
import {setShading} from './params'

export const renameCommand: CommandDefinition = {
    op: 'rename',
    summary: 'Give an object a new name.',
    description: 'Names are how every later command refers to an object, so naming parts as you '
        + 'build them is what keeps a long session addressable.',
    mutates: true,
    schema: schema({
        object: S.objectRef('The object to rename.'),
        objects: S.objectRef('Alias for `object`.'),
        name: S.string('The new name. Must not already be taken.'),
    }, ['name']),

    run(p: Record<string, unknown>, ctx) {
        const entry = readTarget(p, ctx.doc)
        const was = entry.name
        const now = ctx.doc.rename(entry, p.name as string)
        return {objects: [now], data: {from: was, to: now}}
    },
}

export const materialCommand: CommandDefinition = {
    op: 'material',
    summary: 'Set colour and surface properties on objects.',
    mutates: true,
    schema: schema({
        object: S.objectRef('Objects to change. `prefix*` and `*` work.'),
        objects: S.objectRef('Alias for `object`.'),
        color: S.string('Base colour, any CSS colour string.'),
        metalness: S.number('0 for a dielectric, 1 for bare metal.', {minimum: 0, maximum: 1}),
        roughness: S.number('0 mirror-smooth, 1 fully diffuse.', {minimum: 0, maximum: 1}),
        opacity: S.number('1 is opaque. Below 1 turns on transparency.', {minimum: 0, maximum: 1}),
        flatShading: S.boolean('Render facets flat, without smoothing across them.'),
        wireframe: S.boolean('Draw edges only.'),
        shading: S.enum('Per-face shading written into the mesh, re-baked immediately.',
            ['auto', 'flat', 'smooth']),
    }),

    run(p: Record<string, unknown>, ctx) {
        const targets = readTargets(p, ctx.doc)
        const changed: string[] = []
        for (const entry of targets) {
            ctx.doc.record(entry)
            const mat = entry.object.material as PhysicalMaterial | undefined
            if (!mat) {
                ctx.warn(`"${entry.name}" has no material`)
                continue
            }
            if (p.color !== undefined) mat.color = new Color(p.color as string)
            if (p.metalness !== undefined) mat.metalness = p.metalness as number
            if (p.roughness !== undefined) mat.roughness = p.roughness as number
            if (p.opacity !== undefined) {
                mat.opacity = p.opacity as number
                mat.transparent = (p.opacity as number) < 1
            }
            if (p.flatShading !== undefined) mat.flatShading = p.flatShading as boolean
            if (p.wireframe !== undefined) mat.wireframe = p.wireframe as boolean
            mat.setDirty?.()

            if (p.shading !== undefined) {
                const mesh = entry.mesh.clone()
                setShading(mesh, p.shading as 'flat' | 'smooth' | 'auto')
                ctx.doc.setMesh(entry, mesh)
            }
            changed.push(entry.name)
        }
        return {objects: changed, data: {count: changed.length}}
    },
}

export const selectCommand: CommandDefinition = {
    op: 'select',
    summary: 'Select or deselect an object in the viewport.',
    description: 'Selection drives the transform gizmo and is what `camera {fit: "selected"}` '
        + 'frames. It needs `PickingPlugin`; without it the command reports a warning.',
    mutates: false,
    schema: schema({
        object: S.objectRef('The object to select. Omit with `selected: false` to clear.'),
        objects: S.objectRef('Alias for `object`.'),
        selected: S.boolean('Default true.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const picking = ctx.viewer.getPlugin<any>('Picking')
        if (!picking) {
            ctx.warn('PickingPlugin is not loaded, so there is nothing to select into')
            return {data: {selected: null}}
        }
        const selected = p.selected === undefined ? true : p.selected as boolean
        if (!selected || (p.object === undefined && p.objects === undefined)) {
            picking.setSelectedObject(null)
            return {data: {selected: null}}
        }
        const entry = readTarget(p, ctx.doc)
        picking.setSelectedObject(entry.object)
        return {objects: [entry.name], data: {selected: entry.name}}
    },
}

const LIGHT_TYPES = ['directional', 'point', 'spot', 'ambient'] as const

export const lightCommand: CommandDefinition = {
    op: 'light',
    summary: 'Add or update a light.',
    mutates: false,
    schema: schema({
        name: S.string('Name of the light. An existing light with this name is updated in place.'),
        type: S.enum('Light type. Required when creating.', LIGHT_TYPES),
        position: S.vec3('World position.'),
        target: S.vec3('Point a directional or spot light aims at.'),
        color: S.string('Any CSS colour string.'),
        intensity: S.number('Light intensity.'),
        distance: S.number('Point and spot falloff distance. 0 means no limit.'),
        decay: S.number('Point and spot decay exponent. 2 is physical.'),
        angle: S.number('Spot cone half-angle in radians.'),
        castShadow: S.boolean('Cast shadows from this light.'),
        remove: S.boolean('Delete the named light instead of updating it.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const name = (p.name as string) ?? `${p.type ?? 'light'}`
        const scene = ctx.viewer.scene
        let light = scene.modelRoot.children.find(
            c => c.name === name && (c as IObject3D).isLight) as any

        if (p.remove) {
            if (!light) throw new Error(`no light named "${name}"`)
            light.removeFromParent()
            light.dispose?.()
            return {data: {removed: name}}
        }

        if (!light) {
            const type = p.type as typeof LIGHT_TYPES[number]
            if (!type) throw new Error('creating a light needs a `type`')
            light = type === 'point' ? new PointLight2()
                : type === 'spot' ? new SpotLight2()
                    : type === 'ambient' ? new AmbientLight2()
                        : new DirectionalLight2()
            light.name = name
            scene.addObject(light as IObject3D, {autoScale: false, autoCenter: false})
        }

        if (p.position !== undefined) light.position.set(...readVec3(p.position, [0, 0, 0], 'position'))
        if (p.target !== undefined && light.target) {
            light.target.position.set(...readVec3(p.target, [0, 0, 0], 'target'))
            light.target.updateMatrixWorld?.()
        }
        if (p.color !== undefined) light.color = new Color(p.color as string)
        if (p.intensity !== undefined) light.intensity = p.intensity as number
        if (p.distance !== undefined) light.distance = p.distance as number
        if (p.decay !== undefined) light.decay = p.decay as number
        if (p.angle !== undefined) light.angle = p.angle as number
        if (p.castShadow !== undefined) light.castShadow = p.castShadow as boolean
        light.setDirty?.()
        ctx.viewer.setDirty()

        return {objects: [name], data: {name, type: p.type ?? light.type}}
    },
}

export const lightingCommand: CommandDefinition = {
    op: 'lighting',
    summary: 'Scene-wide lighting: environment map, its intensity, and shadow map resolution.',
    mutates: false,
    schema: schema({
        environment: S.string('URL of an HDR or EXR environment map to load.'),
        environmentIntensity: S.number('Environment light intensity.'),
        background: S.string('Background colour, or `environment` to show the environment map.'),
        shadowResolution: S.integer('Shadow map size for every shadow-casting light.'),
    }),

    async run(p: Record<string, unknown>, ctx) {
        const viewer = ctx.viewer
        if (p.environment !== undefined) await viewer.setEnvironmentMap(p.environment as string)
        if (p.environmentIntensity !== undefined) {
            viewer.scene.environmentIntensity = p.environmentIntensity as number
        }
        if (p.background !== undefined) {
            if (p.background === 'environment') viewer.scene.background = 'environment'
            else viewer.scene.setBackgroundColor(p.background as string)
        }
        if (p.shadowResolution !== undefined) {
            const size = p.shadowResolution as number
            let count = 0
            viewer.scene.modelRoot.traverse((o: any) => {
                if (!o.isLight || !o.shadow) return
                o.shadow.mapSize.set(size, size)
                o.shadow.map?.dispose()
                o.shadow.map = null
                count++
            })
            if (!count) ctx.warn('no shadow-casting lights to resize')
        }
        viewer.setDirty()
        return {data: {environmentIntensity: viewer.scene.environmentIntensity}}
    },
}

export const displayCommand: CommandDefinition = {
    op: 'display',
    summary: 'Viewport display: shading mode, helpers, background.',
    description: '`solid` renders everything in a flat neutral colour, which is the mode to use '
        + 'when judging a silhouette against a reference; `material` shows the real materials.',
    mutates: false,
    schema: schema({
        mode: S.enum('Shading mode.', ['material', 'solid', 'wireframe']),
        helpers: S.boolean('Show light and camera helpers.'),
        environmentIntensity: S.number('Shortcut for the same field on `lighting`.'),
        background: S.string('Background colour, or `environment`.'),
    }),

    run(p: Record<string, unknown>, ctx) {
        const viewer = ctx.viewer
        if (p.mode !== undefined) {
            const mode = p.mode as 'material' | 'solid' | 'wireframe'
            for (const entry of ctx.doc.entries) {
                const mat = entry.object.material as PhysicalMaterial | undefined
                if (!mat) continue
                mat.wireframe = mode === 'wireframe'
                mat.userData.__modellingSolidColor ??= '#' + mat.color.getHexString()
                mat.color = new Color(mode === 'solid'
                    ? '#c8c8c8' : mat.userData.__modellingSolidColor as string)
                mat.setDirty?.()
            }
            ctx.plugin.displayMode = mode
        }
        if (p.helpers !== undefined) {
            const widgets = viewer.getPlugin<any>('Object3DWidgetsPlugin')
            if (widgets) widgets.enabled = p.helpers as boolean
            else ctx.warn('Object3DWidgetsPlugin is not loaded, so there are no helpers to toggle')
        }
        if (p.environmentIntensity !== undefined) {
            viewer.scene.environmentIntensity = p.environmentIntensity as number
        }
        if (p.background !== undefined) {
            if (p.background === 'environment') viewer.scene.background = 'environment'
            else viewer.scene.setBackgroundColor(p.background as string)
        }
        viewer.setDirty()
        return {data: {mode: ctx.plugin.displayMode}}
    },
}

export const sceneCommands = [
    renameCommand, materialCommand, selectCommand, lightCommand, lightingCommand, displayCommand,
]
