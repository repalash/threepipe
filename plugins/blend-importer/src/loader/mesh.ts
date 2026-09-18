import {DoubleSide} from 'threepipe'
import {createBufferGeometry} from './geometry'
import {createMaterial} from './material'
import {subdivideGeometry} from './subdivide'
import {cageFromMeshData, subdivideCage} from './catmull'
import {mirrorGeometry} from './mirror'
import {arrayGeometry} from './array'
import {solidifyGeometry} from './solidify'
import {Ctx} from './ctx'
import {MESH_DATA_KEY, MESH_TOPOLOGY_USERDATA} from './meshData'

function listToArray(lb: any): any[] {
    const out: any[] = []
    if (!lb) return out
    let n = lb.first, g = 0
    while (n && g++ < 4096) { out.push(n); n = n.next }
    return out
}
// DNA_modifier_types.h — ModifierType / eModifierMode.
const eModifierType_Subsurf = 1, eModifierType_Mirror = 5, eModifierType_Array = 12, eModifierType_Solidify = 33
const eModifierMode_Render = 1 << 1
// Names for the "unsupported modifier" warning (so missing geometry isn't silent). Values per
// DNA_modifier_types.h `eModifierType_*`.
const MODIFIER_NAMES: Record<number, string> = {
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

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: Ctx) {
    if (!object.data) {
        return undefined
    }

    // Base geometry is cached per mesh datablock; the modifier stack lives on the OBJECT, so it's applied
    // per-object below. (Caching the *modified* result per datablock was wrong for objects that share a
    // datablock but have different modifier stacks — Alt+D linked duplicates.)
    let geometry = loaded.get(object.data)
    const firstUse = !geometry
    if (!geometry) {
        geometry = createBufferGeometry(object.data, ctx)
        loaded.set(object.data, geometry)
    }
    const baseGeometry = geometry

    // Evaluate the modifier stack in order. Each step returns a NEW geometry (the cached base is never
    // mutated). Render-disabled modifiers (eModifierMode_Render unset) are skipped to match Blender's
    // rendered output; unsupported ones are flagged loudly. Subsurf smooths + tessellates (so a
    // displacement map has geometry to move); Mirror duplicates/reflects across the object's axes.
    const unsupported: string[] = []
    for (const m of listToArray(object.modifiers)) {
        const hdr = m.modifier
        if (!hdr) continue
        if (typeof hdr.mode === 'number' && !(hdr.mode & eModifierMode_Render)) continue
        if (hdr.type === eModifierType_Subsurf) {
            const levels = Math.max(0, Math.min(5, (m.renderLevels ?? m.levels ?? 0) as number))
            // subdivType: 0 = Catmull-Clark (smooth), 1 = Simple (linear, no smoothing).
            if (levels > 0 && (globalThis as any).__NO_SUBSURF !== true) {
                // The editable n-gon mesh the importer attached, when it could produce one. Catmull-Clark
                // needs that topology; the baked triangles no longer have it.
                const ngons = geometry.userData && geometry.userData[MESH_DATA_KEY]
                if (m.subdivType !== 1 && ngons) {
                    // Faithful Catmull-Clark on the n-gon cage (Blender's OSD_SCHEME_CATMARK) with face-varying
                    // UVs (seams stay sharp) + smooth normals + material groups. Falls back to the Loop
                    // approximation if the cage subdivider throws.
                    try {
                        const sub = subdivideCage(cageFromMeshData(ngons), ctx, levels)
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
    }
    if (unsupported.length)
        console.warn(`BlendLoader - "${object.aname}": unsupported modifier(s), geometry may be incomplete:`, unsupported.join(', '))

    // Material slots: `object.data.mat` is the slot array (length `totcol`); faces reference slots by
    // index. When a mesh uses more than one slot, the geometry builder tags triangles with their slot
    // via `geometry.groups`; we then hand three.js the full material array (indexed by group.materialIndex).
    // Otherwise a single material is used (the common case).
    const matData = object.data.mat
    const slots: any[] = Array.isArray(matData) ? matData : (matData ? [matData] : [])

    const buildMaterial = (m: any) => {
        if (!m) { const d = new ctx.MeshPhysicalMaterial(); d.side = DoubleSide; return d } // empty slot -> Blender default
        const cached = loaded.get(m)
        if (cached) return cached
        const created = createMaterial(m, ctx)
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

    // Hand the editable n-gon topology to the object, but only when the geometry it carries really is
    // the bake of that mesh. Every modifier above returns a NEW geometry, so `geometry === baseGeometry`
    // is exactly the "nothing evaluated on top" test. Attaching it after a Subsurf or an Array would be
    // a lie: whoever adopted it would re-bake the un-modified master and quietly drop the modifier
    // result, because Blender's Subsurf and Solidify have no equivalent in the modelling plugin's
    // modifier stack yet (it has array and mirror only).
    const ngons = baseGeometry.userData && baseGeometry.userData[MESH_DATA_KEY]
    if (ngons && geometry === baseGeometry) {
        // Linked duplicates (Alt+D) share one datablock and so one geometry. They must not share one
        // mutable `MeshData`, or editing either object would silently change the other, so every user
        // after the first gets its own copy.
        mesh.userData[MESH_TOPOLOGY_USERDATA] = firstUse ? ngons : ngons.clone()
    }

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
