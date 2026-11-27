import {cageOf, createBufferGeometry, GeometryOptions} from './geometry'
import {createMaterial} from './material'
import {subdivideGeometry} from './subdivide'
import {subdivideCage} from './catmull'
import {mirrorGeometry} from './mirror'
import {arrayGeometry} from './array'
import {solidifyGeometry} from './solidify'
import {Ctx} from './ctx'

function listToArray(lb: any): any[] {
    const out: any[] = []
    if (!lb) return out
    let n = lb.first, g = 0
    while (n && g++ < 4096) { out.push(n); n = n.next }
    return out
}
// DNA_modifier_types.h — ModifierType / eModifierMode.
const eModifierType_Subsurf = 1, eModifierType_Mirror = 5, eModifierType_Array = 12, eModifierType_Solidify = 33, eModifierType_Nodes = 57
const eModifierMode_Realtime = 1 << 0, eModifierMode_Render = 1 << 1
// Names for the "unsupported modifier" warning (so missing geometry isn't silent). Values per
// DNA_modifier_types.h `eModifierType_*`.
const MODIFIER_NAMES: Record<number, string> = {
    1: 'Subsurf', 5: 'Mirror',
    2: 'Lattice', 3: 'Curve', 4: 'Build', 6: 'Decimate', 7: 'Wave', 8: 'Armature', 9: 'Hook',
    10: 'Softbody', 11: 'Boolean', 12: 'Array', 13: 'EdgeSplit', 14: 'Displace', 15: 'UVProject',
    16: 'Smooth', 17: 'Cast', 18: 'MeshDeform', 19: 'ParticleSystem', 20: 'ParticleInstance', 21: 'Explode',
    22: 'Cloth', 23: 'Collision', 24: 'Bevel', 25: 'Shrinkwrap', 26: 'Fluidsim', 27: 'Mask',
    28: 'SimpleDeform', 29: 'Multires', 30: 'Surface', 31: 'Smoke', 32: 'ShapeKey', 33: 'Solidify',
    34: 'Screw', 35: 'Warp', 36: 'WeightVGEdit', 37: 'WeightVGMix', 38: 'WeightVGProximity', 39: 'Ocean',
    40: 'DynamicPaint', 41: 'Remesh', 42: 'Skin', 43: 'LaplacianSmooth', 44: 'Triangulate', 45: 'UVWarp',
    46: 'MeshCache', 47: 'LaplacianDeform', 48: 'Wireframe', 49: 'DataTransfer', 50: 'NormalEdit',
    51: 'CorrectiveSmooth', 52: 'MeshSequenceCache', 53: 'SurfaceDeform', 54: 'WeightedNormal', 55: 'Weld',
    56: 'Fluid', 57: 'GeometryNodes', 58: 'MeshToVolume', 59: 'VolumeDisplace', 60: 'VolumeToMesh', 64: 'Remesh',
}

// IDProperty.type (DNA_ID_enums.h)
const IDP_INT = 1, IDP_FLOAT = 2, IDP_DOUBLE = 8, IDP_BOOLEAN = 10
const SMOOTH_BY_ANGLE = /smooth by angle|auto ?smooth/i

function idPropNumber(p: any): number | undefined {
    const d = p?.data
    if (!d) return undefined
    const dv = new DataView(new ArrayBuffer(8))
    dv.setInt32(0, d.val | 0, true)
    dv.setInt32(4, d.val2 | 0, true)
    if (p.type === IDP_FLOAT) return dv.getFloat32(0, true)
    if (p.type === IDP_DOUBLE) return dv.getFloat64(0, true)
    if (p.type === IDP_INT || p.type === IDP_BOOLEAN) return d.val | 0
    return undefined
}

/** True for the "Smooth by Angle" geometry-nodes modifier, which the geometry builder evaluates itself. */
function isSmoothByAngle(m: any): boolean {
    return m?.modifier?.type === eModifierType_Nodes && SMOOTH_BY_ANGLE.test(m.node_group?.aname || '')
}

/**
 * Blender 4.1 replaced the mesh's Auto Smooth setting with a "Smooth by Angle" geometry-nodes modifier
 * (old files are converted to it on load). We can't run geometry nodes, but this one only marks edges
 * sharp above an angle, which the geometry builder does itself — so read its Angle (the group's float
 * input) and Ignore Sharpness (its boolean input) from the modifier's properties.
 */
function smoothByAngleOptions(object: any, requiredMode: number): GeometryOptions {
    for (const m of listToArray(object.modifiers)) {
        if (!isSmoothByAngle(m)) continue
        if (typeof m.modifier.mode === 'number' && !(m.modifier.mode & requiredMode)) continue
        let angle: number | undefined, ignore = false
        let p = m.settings?.properties?.data?.group?.first, guard = 0
        while (p && guard++ < 64) {
            const name = typeof p.name === 'string' ? p.name : ''
            if (!/_use_attribute$|_attribute_name$/.test(name)) {
                const v = idPropNumber(p)
                if (angle === undefined && (p.type === IDP_FLOAT || p.type === IDP_DOUBLE) && v !== undefined && Number.isFinite(v)) angle = v
                else if (p.type === IDP_BOOLEAN && v) ignore = true
            }
            p = p.next
        }
        return {smoothByAngle: angle ?? Math.PI / 6, ignoreSharpness: ignore}
    }
    return {}
}

// Geometry for objects whose Smooth by Angle settings differ from the mesh's own, per mesh datablock.
const smoothVariants = new WeakMap<any, Map<string, any>>()

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: Ctx) {
    if (!object.data) {
        return undefined
    }

    // Base geometry is cached per mesh datablock; the modifier stack lives on the OBJECT, so it's applied
    // per-object below. (Caching the *modified* result per datablock was wrong for objects that share a
    // datablock but have different modifier stacks — Alt+D linked duplicates.)
    // Normals also depend on the object's Smooth by Angle modifier: objects without one share `loaded`'s
    // entry; the others get a variant per angle.
    const render = ctx.evaluationMode === 'render'
    const requiredMode = render ? eModifierMode_Render : eModifierMode_Realtime
    const opts = smoothByAngleOptions(object, requiredMode)
    let geometry: any
    if (opts.smoothByAngle === undefined) {
        geometry = loaded.get(object.data)
        if (!geometry) {
            geometry = createBufferGeometry(object.data, ctx)
            loaded.set(object.data, geometry)
        }
    } else {
        const key = `${opts.smoothByAngle}|${opts.ignoreSharpness ? 1 : 0}`
        let variants = smoothVariants.get(object.data)
        if (!variants) smoothVariants.set(object.data, variants = new Map())
        geometry = variants.get(key)
        if (!geometry) variants.set(key, geometry = createBufferGeometry(object.data, ctx, opts))
    }

    // Evaluate the modifier stack in order. Each step returns a NEW geometry (the cached base is never
    // mutated). Which modifiers run depends on the evaluation mode, as in Blender's
    // `BKE_modifier_is_enabled`: the viewport runs those with eModifierMode_Realtime, the renderer
    // those with eModifierMode_Render - see `BlendEvaluationMode`. Unsupported ones are flagged loudly. Subsurf smooths + tessellates (so a
    // displacement map has geometry to move); Mirror duplicates/reflects across the object's axes.
    const unsupported: string[] = []
    const failed: string[] = []
    for (const m of listToArray(object.modifiers)) {
        const hdr = m.modifier
        if (!hdr) continue
        if (typeof hdr.mode === 'number' && !(hdr.mode & requiredMode)) continue
        if (isSmoothByAngle(m)) continue // already applied by createBufferGeometry
        // One modifier failing must not fail the whole file. Blender evaluates the rest of the stack on
        // the input to a modifier that errors, and shows the error in that modifier's panel; here the
        // geometry from before the failing step is kept and the failure is reported. Without this, a
        // single bad mesh made `AssetImporter` reject the entire `.blend`, and because the importer
        // reports that as a resolved-but-empty load, it looked like a hang rather than an error.
        const before = geometry
        try {
            if (hdr.type === eModifierType_Subsurf) {
                // `MOD_subsurf.cc:86`: `levels = use_render_params ? renderLevels : levels`.
                const requested = render ? (m.renderLevels ?? m.levels) : (m.levels ?? m.renderLevels)
                const levels = Math.max(0, Math.min(5, (requested ?? 0) as number))
                // subdivType: 0 = Catmull-Clark (smooth), 1 = Simple (linear, no smoothing).
                if (levels > 0 && (globalThis as any).__NO_SUBSURF !== true) {
                    const cage = cageOf(geometry, ctx)
                    if (m.subdivType !== 1 && cage) {
                        // Faithful Catmull-Clark on the n-gon cage (Blender's OSD_SCHEME_CATMARK) with face-varying
                        // UVs (seams stay sharp) + smooth normals + material groups. Falls back to the Loop
                        // approximation if the cage subdivider throws.
                        try {
                            const sub = subdivideCage(cage, ctx, levels)
                            sub.name = geometry.name
                            geometry = sub
                        } catch (e) {
                            console.warn(`BlendLoader - "${object.aname}": Catmull-Clark failed, falling back to Loop subdivision:`, e)
                            geometry = subdivideGeometry(geometry, ctx, levels, undefined, false)
                        }
                    } else {
                        geometry = subdivideGeometry(geometry, ctx, levels, undefined, m.subdivType === 1)
                    }
                }
            } else if (hdr.type === eModifierType_Mirror) {
                geometry = mirrorGeometry(geometry, m, ctx)
            } else if (hdr.type === eModifierType_Array) {
                geometry = arrayGeometry(geometry, m, ctx)
            } else if (hdr.type === eModifierType_Solidify) {
                geometry = solidifyGeometry(geometry, m, ctx)
            } else {
                unsupported.push(MODIFIER_NAMES[hdr.type] ?? `type ${hdr.type}`)
            }
        } catch (e) {
            geometry = before
            failed.push(`${MODIFIER_NAMES[hdr.type] ?? `type ${hdr.type}`}: ${(e as Error)?.message ?? e}`)
        }
    }
    if (failed.length)
        console.error(`BlendLoader - "${object.aname}": modifier(s) failed and were skipped:`, failed.join('; '))
    if (unsupported.length)
        console.warn(`BlendLoader - "${object.aname}": unsupported modifier(s), geometry may be incomplete:`, unsupported.join(', '))

    // Material slots: `object.data.mat` is the slot array (length `totcol`); faces reference slots by
    // index. When a mesh uses more than one slot, the geometry builder tags triangles with their slot
    // via `geometry.groups`; we then hand three.js the full material array (indexed by group.materialIndex).
    // Otherwise a single material is used (the common case).
    const matData = object.data.mat
    const slots: any[] = Array.isArray(matData) ? matData : (matData ? [matData] : [])

    const buildMaterial = (m: any) => {
        if (!m) { const d = new ctx.MeshPhysicalMaterial(); d.side = ctx.DoubleSide; return d } // empty slot -> Blender default
        const cached = loaded.get(m)
        if (cached) return cached
        const created = createMaterial(m, ctx)
        // Blender's material name, as the glTF exporter keeps it
        if (typeof m.aname === 'string' && m.aname) created.name = m.aname
        loaded.set(m, created)
        return created
    }

    const hasGroups = !!(geometry.groups && geometry.groups.length)
    let material: any
    if (hasGroups) {
        material = slots.map(buildMaterial) // multi-material: array indexed by geometry.groups' materialIndex
        // Defensive: a stale/over-range material_index (corrupt data) would map to an undefined entry and
        // three.js would silently skip those faces (invisible). Pad with a default so they stay visible.
        let maxIdx = 0
        for (const g of geometry.groups) if (g.materialIndex > maxIdx) maxIdx = g.materialIndex
        while (material.length <= maxIdx) material.push(buildMaterial(null))
    } else {
        material = buildMaterial(slots[0])
    }

    const mesh = new ctx.Mesh(geometry, material)

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
