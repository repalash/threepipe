import {createBufferGeometry, GeometryOptions} from './geometry'
import {createMaterial} from './material'
import {Ctx} from './ctx'

// IDProperty.type (DNA_ID_enums.h)
const IDP_FLOAT = 2, IDP_DOUBLE = 8, IDP_BOOLEAN = 10, IDP_INT = 1
// ModifierData.mode bits (DNA_modifier_types.h)
const MODIFIER_MODE_REALTIME = 1 << 0, MODIFIER_MODE_RENDER = 1 << 1

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

/**
 * Blender 4.1 replaced the mesh's Auto Smooth setting with a "Smooth by Angle" geometry-nodes modifier
 * (old files are converted to it on load). We can't run geometry nodes, but this one only marks edges
 * sharp above an angle, which the geometry builder does itself — so read its Angle (the group's float
 * input) and Ignore Sharpness (its boolean input) from the modifier's properties.
 */
function smoothByAngleOptions(object: any): GeometryOptions {
    let md = object.modifiers?.first, guard = 0
    while (md && guard++ < 256) {
        const groupName = md.node_group?.aname || ''
        const mode = md.modifier?.mode ?? MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER
        if (md.blender_name === 'NodesModifierData' && /smooth by angle|auto ?smooth/i.test(groupName) && mode & (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER)) {
            let angle: number | undefined, ignore = false
            let p = md.settings?.properties?.data?.group?.first, g2 = 0
            while (p && g2++ < 64) {
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
        md = md.modifier?.next ?? md.next
    }
    return {}
}

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: Ctx) {
    if (!object.data) {
        return undefined
    }

    // Geometry is shared by every object using the same mesh, but normals also depend on the object's
    // Smooth by Angle modifier, so cache per (mesh, modifier settings).
    const opts = smoothByAngleOptions(object)
    const cacheKey = `${opts.smoothByAngle ?? ''}|${opts.ignoreSharpness ? 1 : 0}`
    let byOpts: Map<string, any> | undefined = loaded.get(object.data)
    if (!byOpts) loaded.set(object.data, byOpts = new Map())
    let geometry = byOpts.get(cacheKey)
    if (!geometry) {
        geometry = createBufferGeometry(object.data, ctx, opts)
        // Other modifiers (subdivision surface, mirror, array, solidify, bevel) are not evaluated yet.
        byOpts.set(cacheKey, geometry)
    }

    // Material slots: `object.data.mat` is the slot array (length `totcol`); faces reference slots by
    // index. When a mesh uses more than one slot, the geometry builder tags triangles with their slot
    // via `geometry.groups`; we then hand three.js the full material array (indexed by group.materialIndex).
    // Otherwise a single material is used (the common case).
    const matData = object.data.mat
    const slots: any[] = Array.isArray(matData) ? matData : matData ? [matData] : []

    const buildMaterial = (m: any) => {
        if (!m) { const d = new ctx.MeshPhysicalMaterial(); d.side = ctx.DoubleSide; return d } // empty slot -> Blender default
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

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
