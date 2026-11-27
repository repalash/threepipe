import {createCamera} from './camera'
import {createLight} from './light'
import {createMesh} from './mesh'
import type {EulerOrder, IObject3D, Matrix4, Object3D, Quaternion} from 'threepipe'
import {Ctx} from './ctx'

// https://github.com/blender/blender/blob/99a4c93081cc2310a09a14f20a1493e8974c10d2/source/blender/makesdna/DNA_object_types.h#L445
const blenderObjectTypes = {
    empty: 0,
    mesh: 1,
    lamp: 10,
    camera: 11,
}

/**
 * Width / height of the active scene's render (`RenderData` resolution x pixel aspect), which Blender fits its
 * cameras to. The active scene is the one open when the file was saved (`FileGlobal.curscene`).
 */
// The scene open when the file was saved (FileGlobal.curscene), else the first.
function activeScene(file: any): any {
    const scenes: any[] = file.objects.Scene ?? []
    const current = file.objects.FileGlobal?.[0]?.curscene
    return scenes.includes(current) ? current : scenes[0]
}

function sceneRenderAspect(file: any): number | undefined {
    const r = activeScene(file)?.r
    if (!r) return undefined
    const w = (r.xsch || 0) * (r.xasp || 1), h = (r.ysch || 0) * (r.yasp || 1)
    return w > 0 && h > 0 ? w / h : undefined
}

// Object.type names for the warning (DNA_object_types.h, ObjectType).
const OBJECT_TYPE_NAMES = new Map<number, string>([
    [2, 'curve'], [3, 'surface'], [4, 'text'], [5, 'metaball'], [12, 'speaker'], [13, 'light probe'], [22, 'lattice'],
    [25, 'armature'], [26, 'grease pencil (legacy)'], [27, 'curves'], [28, 'point cloud'], [29, 'volume'], [30, 'grease pencil'],
])

const listOf = (list: any, out: any[] = []): any[] => {
    for (let x = list?.first, n = 0; x && n < 1e6; x = x.next, n++) out.push(x)
    return out
}

// Visibility flags (DNA_object_types.h, DNA_collection_types.h, DNA_layer_types.h), checked against files saved
// by Blender 5.3: Object.restrictflag, Collection.flag, LayerCollection.flag, Base.flag (view layer).
const OB_HIDE_VIEWPORT = 1 << 0, OB_HIDE_RENDER = 1 << 2
const COLLECTION_HIDE_VIEWPORT = 1 << 0, COLLECTION_HIDE_RENDER = 1 << 3
const LAYER_COLLECTION_EXCLUDE = 1 << 4, LAYER_COLLECTION_HIDE = 1 << 7
const BASE_HIDDEN = 1 << 8

// Hidden by its own flags: "Disable in Viewports" / "Disable in Renders" (the monitor and camera icons).
function objectHidden(object: any, render: boolean) {
    return !!((object.restrictflag ?? 0) & (render ? OB_HIDE_RENDER : OB_HIDE_VIEWPORT))
}

// The view layer open in the scene's window, else the scene's first.
function activeViewLayer(file: any, scene: any): any {
    const layers = listOf(scene.view_layers)
    const window = (file.objects.wmWindow ?? []).find((w: any) => w.scene === scene)
    const name = typeof window?.view_layer_name === 'string' ? window.view_layer_name : undefined
    return layers.find(l => l.name === name) ?? layers[0]
}

/**
 * The objects Blender shows in the active scene, as its viewport does or, with `render`, as its renderer does
 * (`evaluationMode`). Since 2.80: the objects of the scene's collection tree, without collections excluded in the
 * view layer (they aren't evaluated at all) and without objects or collections disabled in the viewport (or in
 * renders), or hidden in the view layer (the eye icons, viewport only). Before 2.80: the scene's objects (bases)
 * on the scene's visible layers. The hidden parent of a shown object is still made, as an empty, for its
 * children's transforms (outsideParents).
 *
 * A file can hold objects that are in no scene, such as a collection kept for reuse (a fake user) or in an asset
 * library, and objects of other scenes; Blender doesn't show them either. Undefined when the scene has no
 * objects at all (an asset library, say): then every object is imported.
 */
function sceneObjects(file: any, render: boolean): {shown: Set<any>, inScene: number} | undefined {
    const scene = activeScene(file)
    if (!scene) return undefined
    const shown = new Set<any>()
    const all = new Set<any>()
    if (scene.master_collection) {
        const viewLayer = activeViewLayer(file, scene)
        const layerFlags = new Map<any, number>()
        const walkLayers = (lc: any) => {
            if (lc.collection) layerFlags.set(lc.collection, lc.flag ?? 0)
            for (const child of listOf(lc.layer_collections)) walkLayers(child)
        }
        for (const lc of listOf(viewLayer?.layer_collections)) walkLayers(lc)
        const baseHidden = new Set<any>()
        if (!render) for (const base of listOf(viewLayer?.object_bases)) if (base.object && (base.flag ?? 0) & BASE_HIDDEN) baseHidden.add(base.object)
        const seen = new Set<any>()
        const walk = (collection: any, hiddenAbove: boolean) => {
            if (!collection || seen.has(collection)) return
            seen.add(collection)
            const objects = listOf(collection.gobject).map(co => co.ob).filter(Boolean)
            for (const ob of objects) all.add(ob)
            const layer = layerFlags.get(collection) ?? 0
            if (layer & LAYER_COLLECTION_EXCLUDE) { // excluded with everything in it
                for (const c of listOf(collection.children)) for (const ob of collectionObjects(c.collection)) all.add(ob)
                return
            }
            const flag = collection.flag ?? 0
            const hidden = hiddenAbove || !!(render ? flag & COLLECTION_HIDE_RENDER : flag & COLLECTION_HIDE_VIEWPORT || layer & LAYER_COLLECTION_HIDE)
            for (const ob of objects) if (!hidden && !objectHidden(ob, render) && !baseHidden.has(ob)) shown.add(ob)
            for (const child of listOf(collection.children)) walk(child.collection, hidden)
        }
        walk(scene.master_collection, false)
    }
    if (!scene.master_collection) {
        // before 2.80: an object shows when its base is on one of the scene's visible layers
        const sceneLayers = typeof scene.lay === 'number' ? scene.lay : -1
        for (const base of listOf(scene.base)) {
            if (!base.object) continue
            all.add(base.object)
            const lay = typeof base.lay === 'number' ? base.lay : typeof base.object.lay === 'number' ? base.object.lay : -1
            if (lay & sceneLayers && !objectHidden(base.object, render)) shown.add(base.object)
        }
    }
    return all.size ? {shown, inScene: all.size} : undefined
}

// Object.transflag OB_DUPLICOLLECTION (OB_DUPLIGROUP before 2.80): the object places a copy of a collection.
const OB_DUPLICOLLECTION = 1 << 8

// The objects of a collection and its child collections (a Group before 2.80, which has no children). With
// `render` given, without those disabled in the viewport (false) or in renders (true), as an instance draws them.
function collectionObjects(collection: any, render?: boolean): Set<any> {
    const found = new Set<any>()
    const seen = new Set<any>()
    const walk = (c: any) => {
        if (!c || seen.has(c)) return
        seen.add(c)
        if (render !== undefined && (c.flag ?? 0) & (render ? COLLECTION_HIDE_RENDER : COLLECTION_HIDE_VIEWPORT)) return
        for (const co of listOf(c.gobject)) if (co.ob && (render === undefined || !objectHidden(co.ob, render))) found.add(co.ob)
        for (const child of listOf(c.children)) walk(child.collection)
    }
    walk(collection)
    return found
}

// The parents of `objects` that aren't in it: made as empties, for the transforms of their children.
function outsideParents(objects: Set<any>): Set<any> {
    const parents = new Set<any>()
    for (const object of objects)
        for (let p = object.parent, n = 0; p && p !== object && !objects.has(p) && n < 1000; p = p.parent, n++) parents.add(p)
    return parents
}

interface BuildState {
    ctx: Ctx
    loaded: WeakMap<object, any> // geometry and materials, shared by every copy
    renderAspect: number | undefined
    unsupported: Map<number, number> // Blender object type -> count
    templates: Map<any, Object3D | null> // instanced collection -> its objects, built once
    depth: number
    render: boolean // evaluationMode 'render': renders' visibility instead of the viewport's
}

export async function createObjects(file: any, ctx: Ctx) {
    const allObjects: any[] = file.objects.Object ?? []
    // Only the active scene's objects, unless asked for all (ctx.allObjects).
    const render = ctx.evaluationMode === 'render'
    const scene = ctx.allObjects ? undefined : sceneObjects(file, render)
    const state: BuildState = {ctx, loaded: new WeakMap(), renderAspect: sceneRenderAspect(file), unsupported: new Map(), templates: new Map(), depth: 0, render}
    let objects: Object3D[]
    if (scene) {
        const shown = scene.shown
        const parentsOnly = outsideParents(shown)
        const hidden = scene.inScene - shown.size - [...parentsOnly].filter(p => !shown.has(p)).length
        const elsewhere = allObjects.filter(o => !shown.has(o) && !parentsOnly.has(o)).length - Math.max(0, hidden)
        const parts = [
            hidden > 0 ? `${hidden} hidden in the ${render ? 'renders' : 'viewport'} (hidden layers, excluded or disabled collections, disabled objects)` : '',
            elsewhere > 0 ? `${elsewhere} in no collection of the scene (collections kept for reuse, other scenes)` : '',
        ].filter(Boolean)
        if (parts.length) console.warn(`BlendLoader - objects Blender doesn't show in the scene "${activeScene(file)?.aname ?? ''}" left out: ${parts.join('; ')}. Set allObjects to import them.`)
        objects = buildObjects(allObjects.filter(o => shown.has(o) || parentsOnly.has(o)), parentsOnly, state)
    } else {
        objects = buildObjects(allObjects, new Set(), state)
    }
    if (state.unsupported.size) {
        const list = [...state.unsupported].map(([t, n]) => `${OBJECT_TYPE_NAMES.get(t) ?? 'type ' + t} (${n})`).join(', ')
        console.warn(`BlendLoader - kept as empty objects, their type isn't imported: ${list}`)
    }
    return objects
}

// three.js objects for `blendObjects`, nested as their parents are; returns the roots. `parentsOnly` are made as
// empties. An object that instances a collection gets a copy of that collection's objects as a child.
function buildObjects(blendObjects: any[], parentsOnly: Set<any>, state: BuildState): Object3D[] {
    const {ctx} = state
    const objects: Object3D[] = []
    const childMap = new Map<any, Object3D[]>()
    const objMap = new Map<any, Object3D>()
    for (const object of blendObjects) {
        if (objMap.has(object)) {
            console.warn('BlendLoader - duplicate object')
            continue
        }
        let obj: Object3D | undefined = undefined
        switch (parentsOnly.has(object) ? blenderObjectTypes.empty : object.type) {
        case blenderObjectTypes.empty:
            obj = new ctx.Object3D()
            break
        case blenderObjectTypes.mesh:
            obj = createMesh(object, state.loaded, ctx)
            break
        case blenderObjectTypes.lamp:
            obj = createLight(object, ctx)
            break
        case blenderObjectTypes.camera:
            obj = createCamera(object, ctx, state.renderAspect)
            break
        default:
            // Kept as an empty so the hierarchy and transforms survive; reported once below.
            obj = new ctx.Object3D()
            state.unsupported.set(object.type, (state.unsupported.get(object.type) ?? 0) + 1)
        }
        if (!obj) continue
        setTransform(object, obj as any, ctx)
        if (!parentsOnly.has(object)) addInstancedCollection(object, obj, state)
        const exChildren = childMap.get(object)
        if (exChildren) {
            for (const exChild of exChildren) obj.add(exChild)
            childMap.delete(object)
        }
        objMap.set(object, obj)
        if (object.parent === object) {
            console.error('BlendLoader - invalid, parent same as object, adding to root', object)
            objects.push(obj)
        } else if (!object.parent) {
            objects.push(obj)
        } else {
            const parent = objMap.get(object.parent)
            if (!parent) {
                // Parent not made yet: stash under the parent, picked up when it is (childMap.get(object) above).
                const chi = childMap.get(object.parent) ?? []
                chi.push(obj)
                childMap.set(object.parent, chi)
            } else {
                parent.add(obj)
            }
        }
    }
    if (childMap.size) {
        const vals = [...childMap.values()].flat()
        console.warn('BlendLoader - unknown objects with parents, adding to root', vals, childMap)
        objects.push(...vals)
    }
    return objects
}

// An empty with Instancing > Collection (Blender's "collection instance", e.g. a linked or reused asset):
// Blender draws the collection's objects at the empty, moved by the collection's instance offset. They were
// left out (they are often in no scene of their own), or imported once at their source position.
function addInstancedCollection(object: any, obj: Object3D, state: BuildState) {
    const collection = (object.transflag ?? 0) & OB_DUPLICOLLECTION ? object.instance_collection ?? object.dup_group : undefined
    if (!collection || state.depth > 8) return
    let template = state.templates.get(collection)
    if (template === undefined) {
        state.templates.set(collection, null) // a collection that instances itself stops here
        const members = collectionObjects(collection, state.render)
        const parentsOnly = outsideParents(members)
        state.depth++
        const roots = buildObjects([...members, ...parentsOnly], parentsOnly, state)
        state.depth--
        template = roots.length ? new state.ctx.Object3D() : null
        if (template) {
            template.name = collection.aname || 'collection'
            template.add(...roots)
            // the collection's origin (instance_offset; dupli_ofs before 2.80) goes to the empty: (x, y, z) Z-up -> (x, z, -y)
            const o = collection.instance_offset ?? collection.dupli_ofs
            if (o && o.length >= 3) template.position.set(-o[0], -o[2], o[1])
            template.updateMatrix()
        }
        state.templates.set(collection, template)
    }
    // each empty gets its own copy; meshes share their geometry and materials
    if (template) obj.add(template.clone())
}


// https://github.com/blender/blender/blob/458e224587e8c45da20841a283cc1b41adc98950/source/blender/makesdna/DNA_action_types.h#L526
const eulerModes: Record<number, EulerOrder> = {
    [1]: 'XYZ',
    [2]: 'XZY',
    [3]: 'YXZ',
    [4]: 'YZX',
    [5]: 'ZXY',
    [6]: 'ZYX',
}

// Z-up (Blender) → Y-up (three) basis change: (x,y,z) → (x, z, -y), i.e. a -90° rotation about X. The
// geometry verts get the same C, so a Blender transform M maps to C·M·C⁻¹ in three space.
// (Built per call from ctx: the loader core imports no three.js classes, see ctx.ts.)
const zupToYup = (ctx: Ctx) => new ctx.Matrix4().makeRotationX(-Math.PI / 2)
const yupToZup = (ctx: Ctx) => new ctx.Matrix4().makeRotationX(Math.PI / 2)
// Blender cameras/lamps point down local -Z; three cameras render along -Z and our Sun/Spot lights aim via
// a target child at local -Z, so both need this extra -90° X (matches the glTF exporter's node correction).
const forwardFix = (ctx: Ctx) => new ctx.Quaternion().setFromAxisAngle(new ctx.Vector3(1, 0, 0), -Math.PI / 2)

// A Blender rotation (basis or delta) → Quaternion in Blender space, per rotmode. (BKE_object_rot_to_mat3:
// euler 1..6 / axis-angle -1 / quat 0; Blender quat is [w,x,y,z].)
function blenderRot(ctx: Ctx, rotmode: number, quat: any, rot: any, axis: any, angle: number): Quaternion {
    const q = new ctx.Quaternion()
    if (!rotmode) {
        if (quat) q.set(quat[1], quat[2], quat[3], quat[0]).normalize()
    } else if (rotmode < 0) {
        if (axis && (axis[0] || axis[1] || axis[2])) q.setFromAxisAngle(new ctx.Vector3(axis[0], axis[1], axis[2]).normalize(), angle || 0)
    } else {
        const order = (eulerModes[rotmode] ?? 'XYZ').split('').reverse().join('') as EulerOrder
        if (rot) q.setFromEuler(new ctx.Euler(rot[0], rot[1], rot[2], order))
    }
    return q
}

// Blender object → its LOCAL (parent-relative basis) matrix, ported from BKE_object_to_mat4 +
// BKE_object_rot_to_mat3: T(loc+dloc) · (Rdelta · Rbasis) · S(size·dscale).
function blenderLocalMatrix(ctx: Ctx, object: any): Matrix4 {
    const dloc = object.dloc, dscale = object.dscale, size = object.size ?? object.scale ?? [1, 1, 1]
    const pos = new ctx.Vector3(object.loc[0] + (dloc?.[0] || 0), object.loc[1] + (dloc?.[1] || 0), object.loc[2] + (dloc?.[2] || 0))
    const scl = new ctx.Vector3(size[0] * (dscale?.[0] ?? 1), size[1] * (dscale?.[1] ?? 1), size[2] * (dscale?.[2] ?? 1))
    const rBasis = blenderRot(ctx, object.rotmode || 0, object.quat, object.rot, object.rotAxis, object.rotAngle)
    const rDelta = blenderRot(ctx, object.rotmode || 0, object.dquat, object.drot, object.drotAxis, object.drotAngle)
    return new ctx.Matrix4().compose(pos, rDelta.multiply(rBasis), scl) // delta pre-multiplies (dmat·rmat)
}

// Blender column-major float[4][4] (as [col][row]) → three Matrix4 (three .elements is also column-major).
function mat4FromBlender(ctx: Ctx, m: any): Matrix4 | null {
    if (!m || !m[0]) return null
    const e: number[] = []
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) e.push(m[c][r])
    return new ctx.Matrix4().fromArray(e)
}

function setTransform(object: any, obj: IObject3D, ctx: Ctx) {
    obj.name = object.aname
    // Faithful port of Blender's solve_parenting: world = parent · parentinv · localTRS. The three parent
    // already carries C·parent·C⁻¹, so the three LOCAL matrix is C · (parentinv · localTRS) · C⁻¹. This
    // folds in parentinv + delta transforms that the old basis-only path dropped (parented/delta objects).
    const m = blenderLocalMatrix(ctx, object)
    if (object.parent) {
        const pinv = mat4FromBlender(ctx, object.parentinv)
        if (pinv) m.premultiply(pinv) // parentinv · localTRS
    }
    m.premultiply(zupToYup(ctx)).multiply(yupToZup(ctx)) // C · m · C⁻¹
    m.decompose(obj.position, obj.quaternion, obj.scale)
    if (object.type === blenderObjectTypes.camera || object.type === blenderObjectTypes.lamp)
        obj.quaternion.multiply(forwardFix(ctx))

    obj.updateMatrix()
    if (obj.setDirty) obj.setDirty()
}
