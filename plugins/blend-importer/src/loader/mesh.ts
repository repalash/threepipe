import {DoubleSide} from 'threepipe'
import {createBufferGeometry} from './geometry'
import {createMaterial} from './material'
import {Ctx} from './ctx'

export function createMesh(object: any, loaded: WeakMap<any, any>, ctx: Ctx) {
    if (!object.data) {
        return undefined
    }

    let geometry = loaded.get(object.data)
    if (!geometry) {
        geometry = createBufferGeometry(object.data, ctx)
        // Modifiers (subdivision surface, mirror, array, solidify) are evaluated on the `blend-importer-modifiers` branch, not here yet.
        loaded.set(object.data, geometry)
    }

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

    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
}
