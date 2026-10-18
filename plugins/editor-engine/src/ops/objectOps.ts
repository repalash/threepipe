/**
 * Object-mode operators: the Add menu, selection, delete, duplicate, join / separate, visibility,
 * parenting, transform clear / apply, and entering edit mode.
 *
 * Objects in the modelling document go through `ModellingPlugin` commands (one implementation, also
 * the agent API, one labelled undo step each). Objects that are not in it yet - an imported glTF
 * before its first edit - go through `PickingPlugin` or an engine-side step; either way one Ctrl+Z
 * reverses one action.
 */

import {GeometryGeneratorPlugin, IObject3D, Matrix4, Object3DGeneratorPlugin, Quaternion, Vector3} from 'threepipe'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {EditorContext, OperatorDescriptor, PropSchema} from '../registry'
import {visibleSchema} from './modellingOps'

const PRIMITIVES: {type: string, label: string, icon: string, generator: string, defaults: Record<string, unknown>}[] = [
    {type: 'cube', label: 'Cube', icon: 'cube', generator: 'geometry-box', defaults: {size: 1}},
    {type: 'plane', label: 'Plane', icon: 'square', generator: 'geometry-plane', defaults: {size: 2}},
    {type: 'circle', label: 'Circle', icon: 'circle', generator: 'geometry-circle', defaults: {radius: 0.5, segments: 32}},
    {type: 'sphere', label: 'UV Sphere', icon: 'globe', generator: 'geometry-sphere', defaults: {radius: 0.5, segments: 32, rings: 16}},
    {type: 'icosphere', label: 'Ico Sphere', icon: 'polygon-filter', generator: 'geometry-sphere', defaults: {radius: 0.5, subdivisions: 2}},
    {type: 'cylinder', label: 'Cylinder', icon: 'database', generator: 'geometry-cylinder', defaults: {radius: 0.5, height: 1, segments: 32}},
    {type: 'cone', label: 'Cone', icon: 'symbol-triangle-up', generator: 'geometry-cylinder', defaults: {radius: 0.5, height: 1, segments: 32}},
    {type: 'torus', label: 'Torus', icon: 'ring', generator: 'geometry-torus', defaults: {radius: 0.5, tubeRadius: 0.15, segments: 32, tubeSegments: 12}},
    {type: 'grid', label: 'Grid', icon: 'grid', generator: 'geometry-plane', defaults: {size: 2, xSegments: 10, ySegments: 10}},
]

const PRIMITIVE_PROPS: Record<string, string[]> = {
    cube: ['size', 'width', 'height', 'depth'],
    plane: ['size', 'width', 'height'],
    circle: ['radius', 'segments', 'capEnds'],
    sphere: ['radius', 'segments', 'rings'],
    icosphere: ['radius', 'subdivisions'],
    cylinder: ['radius', 'height', 'segments', 'capEnds'],
    cone: ['radius', 'height', 'segments', 'capEnds'],
    torus: ['radius', 'tubeRadius', 'segments', 'tubeSegments'],
    grid: ['size', 'xSegments', 'ySegments'],
}

export function registerObjectOperators(engine: EditorEnginePlugin): void {
    const viewer = engine.viewer
    const picking = engine.picking
    const modelling = engine.modelling
    const needsSelection = (ctx: EditorContext) => ctx.selectedObjects.length > 0 || 'Click an object to select it first (drag a box around several)'
    const docEntries = (objects: IObject3D[]) => objects.map(o => modelling?.document.find(o.uuid)).filter(e => !!e)
    const allInDocument = (objects: IObject3D[]) => !!modelling && objects.length > 0 && objects.every(o => !!modelling.document.find(o.uuid))
    const commandSchema = (op: string): PropSchema | undefined => {
        const def = modelling?.describeCommands().find(c => c.name === op)
        return def ? visibleSchema(def.inputSchema as PropSchema) : undefined
    }

    const ops: OperatorDescriptor[] = [
        // --- Add ----------------------------------------------------------------------------
        ...PRIMITIVES.map((p): OperatorDescriptor => ({
            id: `add.${p.type}`,
            label: p.label,
            icon: p.icon,
            category: 'Add',
            modes: ['object'],
            description: `Add a ${p.label.toLowerCase()} at the origin.`,
            flags: {undo: true, register: true},
            props: modelling ? primitiveSchema(engine, p.type) : undefined,
            async exec(_ctx, props) {
                const params = {...p.defaults, ...props}
                if (modelling) {
                    const result = await modelling.run({op: 'primitive', type: p.type, ...params})
                    if (!result.ok) return {ok: false, error: result.error}
                    const name = result.objects?.[0]
                    const entry = name ? modelling.document.find(name) : undefined
                    // Selecting the new object is part of this operator, not an undo step of its own.
                    if (entry) picking.setSelectedObject(entry.object, false, false)
                    return {ok: true, warnings: result.warnings, data: result.data, props: params}
                }
                const gen = viewer.getPlugin(Object3DGeneratorPlugin)
                if (!gen) return {ok: false, error: 'Neither ModellingPlugin nor Object3DGeneratorPlugin is loaded.'}
                viewer.getOrAddPluginSync(GeometryGeneratorPlugin)
                const obj = gen.generate(p.generator, {})
                if (!obj) return {ok: false, error: `No generator for ${p.generator}`}
                obj.name = p.label
                picking.setSelectedObject(obj, false, false)
                return {ok: true}
            },
        })),
        {
            id: 'add.menu', label: 'Add…', icon: 'plus', category: 'Add', modes: ['object'], hidden: true,
            description: 'Open the Add menu at the cursor (Blender\'s Shift+A).',
            exec: () => {
                engine.requestMenu('Add', engine.operators.list(o => o.id.startsWith('add.') && o.id !== 'add.menu').map(o => ({id: o.id})))
                return {ok: true}
            },
        },
        // --- Object -------------------------------------------------------------------------
        {
            id: 'object.enter_edit', label: 'Edit Mode', icon: 'edit', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Edit the selected mesh\'s vertices, edges and faces.',
            poll: ctx => ctx.selectedObjects.some(o => !!o.geometry) || 'Click a mesh to select it first, or double-click it',
            exec: () => ({ok: engine.setMode('edit')}),
        },
        {
            id: 'object.select_all', label: 'Select All', icon: 'select', category: 'Select', modes: ['object'],
            description: 'Select every object in the scene.',
            exec: () => { picking.selectAll(); return {ok: true} },
        },
        {
            id: 'object.select_none', label: 'Select None', icon: 'disable', category: 'Select', modes: ['object'],
            description: 'Deselect everything.',
            poll: needsSelection,
            exec: () => { picking.clearSelection(); return {ok: true} },
        },
        {
            id: 'object.select_invert', label: 'Invert Selection', icon: 'exchange', category: 'Select', modes: ['object'],
            description: 'Select the objects that are not selected, and deselect the ones that are.',
            exec: ctx => {
                const selected = new Set(ctx.selectedObjects)
                const next = engine.modelObjects().filter(o => !selected.has(o) && (o as any).isMesh !== false)
                const picker = picking.picker
                if (!picker) return {ok: false, error: 'Picking is not available'}
                picker.setSelected((next.length ? next.length === 1 ? next[0] : next : null) as never, true)
                return {ok: true}
            },
        },
        {
            id: 'object.delete', label: 'Delete', icon: 'trash', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Delete the selected objects.',
            flags: {undo: true},
            poll: needsSelection,
            async exec(ctx) {
                const objects = ctx.selectedObjects
                if (allInDocument(objects)) {
                    const result = await modelling!.run({op: 'delete', objects: docEntries(objects).map(e => e.name)})
                    return result.ok ? {ok: true} : {ok: false, error: result.error}
                }
                await picking.deleteSelected()
                return {ok: true}
            },
        },
        {
            id: 'object.duplicate', label: 'Duplicate', icon: 'duplicate', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Copy the selected objects in place, and select the copies.',
            flags: {undo: true, register: true},
            props: commandSchema('duplicate'),
            poll: needsSelection,
            async exec(ctx, props) {
                const objects = ctx.selectedObjects
                if (allInDocument(objects)) {
                    const result = await modelling!.run({op: 'duplicate', objects: docEntries(objects).map(e => e.name), ...props})
                    if (!result.ok) return {ok: false, error: result.error}
                    const made = (result.objects ?? []).map(n => modelling!.document.find(n)?.object).filter(o => !!o)
                    if (made.length) picking.picker?.setSelected((made.length === 1 ? made[0] : made) as never, false)
                    return {ok: true, data: result.data, warnings: result.warnings}
                }
                picking.duplicateSelected('simple')
                return {ok: true}
            },
        },
        {
            id: 'object.join', label: 'Join', icon: 'merge-links', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Merge the selected objects into one mesh; the active (last selected) object survives.',
            flags: {undo: true, register: true},
            poll: ctx => {
                if (ctx.selectedObjects.length < 2) return 'Select two or more objects to join: Shift+click adds to the selection'
                if (!allInDocument(ctx.selectedObjects)) return `Enter Edit mode on each object once${engine.keyHint('object.enter_edit', 'object')} to make it joinable, then come back`
                return true
            },
            async exec(ctx) {
                // Blender keeps the active object; here the active one is the last selected.
                const names = docEntries(ctx.selectedObjects).map(e => e.name).reverse()
                const result = await modelling!.run({op: 'join', objects: names})
                if (!result.ok) return {ok: false, error: result.error}
                const survivor = modelling!.document.find(result.objects?.[0] ?? '')
                if (survivor) picking.setSelectedObject(survivor.object, false, false)
                return {ok: true, data: result.data, warnings: result.warnings}
            },
        },
        {
            id: 'object.separate', label: 'Separate by Loose Parts', icon: 'split-columns', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Split the selected object into one object per disconnected piece.',
            flags: {undo: true, register: true},
            poll: ctx => {
                if (ctx.selectedObjects.length !== 1) return 'Select exactly one object to separate'
                if (!allInDocument(ctx.selectedObjects)) return `Enter Edit mode on this object once${engine.keyHint('object.enter_edit', 'object')} to make it separable, then come back`
                return true
            },
            async exec(ctx) {
                const entry = docEntries(ctx.selectedObjects)[0]
                const result = await modelling!.run({op: 'separate', object: entry.name, mode: 'loose'})
                if (!result.ok) return {ok: false, error: result.error}
                return {ok: true, data: result.data, warnings: result.warnings}
            },
        },
        {
            id: 'object.hide', label: 'Hide', icon: 'eye-off', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Hide the selected objects.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.toggleVisibilitySelected(); return {ok: true} },
        },
        {
            id: 'object.unhide_all', label: 'Unhide All', icon: 'eye-open', category: 'Object', modes: ['object'],
            description: 'Show every hidden object.',
            flags: {undo: true},
            exec: () => { picking.unhideAll(); return {ok: true} },
        },
        {
            id: 'object.parent', label: 'Parent to Active', icon: 'diagram-tree', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Make the last-selected object the parent of the other selected objects, keeping their placement.',
            flags: {undo: true},
            poll: ctx => ctx.selectedObjects.length >= 2 || 'Select the children, then the parent last',
            exec: ctx => {
                const objects = ctx.selectedObjects
                const parent = objects[objects.length - 1]
                const children = objects.slice(0, -1).filter(c => c !== parent && !isAncestor(c, parent))
                if (!children.length) return {ok: false, error: 'An object cannot be parented to its own child'}
                return {ok: reparent(engine, children, parent, `Parent to ${parent.name || 'object'}`)}
            },
        },
        {
            id: 'object.clear_parent', label: 'Clear Parent', icon: 'graph-remove', category: 'Object', modes: ['object'],
            description: 'Move the selected objects to the top level, keeping their placement.',
            flags: {undo: true},
            poll: ctx => ctx.selectedObjects.some(o => o.parent && o.parent !== viewer.scene.modelRoot) || 'The selection has no parent to clear',
            exec: ctx => {
                const children = ctx.selectedObjects.filter(o => o.parent && o.parent !== viewer.scene.modelRoot)
                return {ok: reparent(engine, children, viewer.scene.modelRoot as unknown as IObject3D, 'Clear Parent')}
            },
        },
        {
            id: 'object.reset_position', label: 'Clear Location', icon: 'move', category: 'Object', modes: ['object'],
            description: 'Move the selection back to the origin.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('position'); return {ok: true} },
        },
        {
            id: 'object.reset_rotation', label: 'Clear Rotation', icon: 'refresh', category: 'Object', modes: ['object'],
            description: 'Reset the selection\'s rotation.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('rotation'); return {ok: true} },
        },
        {
            id: 'object.reset_scale', label: 'Clear Scale', icon: 'maximize', category: 'Object', modes: ['object'],
            description: 'Reset the selection\'s scale to 1.',
            flags: {undo: true},
            poll: needsSelection,
            exec: () => { picking.resetTransform('scale'); return {ok: true} },
        },
        {
            id: 'object.apply_transform', label: 'Apply Transform', icon: 'tick-circle', category: 'Object', modes: ['object'],
            contextMenu: ['object'],
            description: 'Bake the object\'s location, rotation and/or scale into its mesh and reset them (Blender\'s Ctrl+A).',
            flags: {undo: true, register: true},
            props: {
                type: 'object',
                properties: {
                    location: {type: 'boolean', description: 'Bake the location.', default: true},
                    rotation: {type: 'boolean', description: 'Bake the rotation.', default: true},
                    scale: {type: 'boolean', description: 'Bake the scale.', default: true},
                },
            },
            poll: ctx => ctx.selectedObjects.some(o => !!o.geometry) || 'Click a mesh to select it first',
            async exec(ctx, props) {
                if (!props) {
                    engine.requestMenu('Apply', [
                        {id: 'object.apply_transform', label: 'Location', props: {location: true, rotation: false, scale: false}},
                        {id: 'object.apply_transform', label: 'Rotation', props: {location: false, rotation: true, scale: false}},
                        {id: 'object.apply_transform', label: 'Scale', props: {location: false, rotation: false, scale: true}},
                        {id: 'object.apply_transform', label: 'All Transforms', props: {location: true, rotation: true, scale: true}},
                        {id: 'object.apply_transform', label: 'Rotation & Scale', props: {location: false, rotation: true, scale: true}},
                    ])
                    return {ok: true}
                }
                const which = {location: props.location !== false, rotation: props.rotation !== false, scale: props.scale !== false}
                const meshes = ctx.selectedObjects.filter(o => !!o.geometry)
                if (allInDocument(meshes)) {
                    const result = await modelling!.run({op: 'applyTransform', objects: docEntries(meshes).map(e => e.name), ...which})
                    return result.ok ? {ok: true, data: result.data, props: which} : {ok: false, error: result.error}
                }
                applyTransformPlain(engine, meshes, which)
                return {ok: true, props: which}
            },
        },
    ]
    for (const op of ops) engine.operators.register(op)
}

function isAncestor(candidate: IObject3D, of: IObject3D): boolean {
    let o = of.parent
    while (o) {
        if (o === candidate) return true
        o = o.parent
    }
    return false
}

/** Re-parent keeping world transforms (three's `attach`), as one labelled undo step. */
function reparent(engine: EditorEnginePlugin, children: IObject3D[], parent: IObject3D, label: string): boolean {
    const previous = children.map(c => ({child: c, parent: c.parent as IObject3D | null, index: c.parent ? c.parent.children.indexOf(c) : -1}))
    const attach = (child: IObject3D, to: IObject3D, index?: number) => {
        child.updateWorldMatrix(true, false)
        to.updateWorldMatrix(true, false)
        ;(to as any).attach(child)
        if (index !== undefined && index >= 0 && index < to.children.length - 1) {
            to.children.splice(to.children.indexOf(child), 1)
            to.children.splice(index, 0, child)
        }
        child.setDirty?.({change: 'addedToParent'} as never)
        to.setDirty?.({change: 'hierarchyChanged'} as never)
    }
    const redo = () => {
        for (const c of children) attach(c, parent)
        engine.viewer.setDirty()
    }
    const undo = () => {
        for (const p of previous) if (p.parent) attach(p.child, p.parent, p.index)
        engine.viewer.setDirty()
    }
    redo()
    engine.record({label, undo, redo})
    return true
}

/** Apply transform for objects outside the modelling document: bake the matrix into the geometry. */
function applyTransformPlain(engine: EditorEnginePlugin, objects: IObject3D[], which: {location: boolean, rotation: boolean, scale: boolean}): void {
    const states = objects.map(o => ({
        object: o,
        position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone(),
        positions: (o.geometry!.getAttribute('position').array as Float32Array).slice(),
    }))
    const apply = () => {
        for (const s of states) {
            const o = s.object
            const m = new Matrix4().compose(
                which.location ? s.position : new Vector3(),
                which.rotation ? s.quaternion : new Quaternion(),
                which.scale ? s.scale : new Vector3(1, 1, 1),
            )
            o.geometry!.applyMatrix4(m as never)
            if (which.location) o.position.set(0, 0, 0)
            if (which.rotation) o.quaternion.identity()
            if (which.scale) o.scale.set(1, 1, 1)
            o.geometry!.computeBoundingBox?.()
            o.geometry!.computeBoundingSphere?.()
            o.setDirty?.({change: 'transform'} as never)
        }
        engine.viewer.setDirty()
    }
    const revert = () => {
        for (const s of states) {
            const o = s.object
            const attr = o.geometry!.getAttribute('position')
            ;(attr.array as Float32Array).set(s.positions)
            attr.needsUpdate = true
            o.geometry!.computeVertexNormals?.()
            o.geometry!.computeBoundingBox?.()
            o.geometry!.computeBoundingSphere?.()
            o.position.copy(s.position)
            o.quaternion.copy(s.quaternion)
            o.scale.copy(s.scale)
            o.setDirty?.({change: 'transform'} as never)
        }
        engine.viewer.setDirty()
    }
    apply()
    engine.record({label: 'Apply Transform', undo: revert, redo: apply})
}

/** The `primitive` command's schema, narrowed to the parameters that apply to one primitive type. */
function primitiveSchema(engine: EditorEnginePlugin, type: string): PropSchema | undefined {
    const def = engine.modelling?.describeCommands().find(c => c.name === 'primitive')
    const schema = def?.inputSchema as PropSchema | undefined
    if (!schema) return undefined
    const keys = PRIMITIVE_PROPS[type] ?? []
    const properties: PropSchema['properties'] = {}
    for (const k of keys) if (schema.properties[k]) properties[k] = schema.properties[k]
    return {type: 'object', properties}
}
