/**
 * Parity cases for the mesh-editing nodes: Extrude Mesh (every mode, implicit normal / single / field offsets, Top
 * and Side outputs), Split Edges, Duplicate Elements and Subdivide Mesh. Inputs carry attributes on every domain
 * (`attributed`) so the transfer to new elements (gathers and mixes) is compared, on meshes with n-gons,
 * non-manifold edges, loose edges and loose vertices.
 */

import {n, Socket} from '../../../src/dsl/builder'
import {attributed, Extra, meshCase, mod, SHAPE_SCENE, store, testMeshes} from './meshCommon'
import {ParityCase} from './types'

const index = () => n.Index().index
const idx = (k: number) => index().mul(k)

/** Stores Top and Side on every domain they can be read on. */
function storeTopSide(g: Socket<'GEOMETRY'>, top: Socket<'BOOLEAN'>, side: Socket<'BOOLEAN'>): Socket<'GEOMETRY'> {
    for (const d of ['POINT', 'EDGE', 'FACE'] as const) {
        g = store(g, d, `top_${d.toLowerCase()}`, top)
        g = store(g, d, `side_${d.toLowerCase()}`, side)
    }
    return g
}

export function meshEditCases(): ParityCase[] {
    const cases: ParityCase[] = []
    const add = (id: string, description: string, extra: Extra, build: () => Socket<'GEOMETRY'>) => cases.push(meshCase(id, description, extra, build))

    // region Extrude Mesh
    const MODES = [['VERTICES', false], ['EDGES', false], ['FACES', false], ['FACES', true]] as const
    for (const [mode, individual] of MODES) {
        const m = `${mode.toLowerCase()}${mode === 'FACES' ? (individual ? '-individual' : '-regions') : ''}`
        // Individual is only available in FACES mode.
        const ind = mode === 'FACES' ? {individual} : {}
        add(`extrude-${m}-normal`, `Extrude Mesh ${m}: implicit normal offset scaled, a selection, Top/Side`, SHAPE_SCENE, () => {
            const ex = n.ExtrudeMesh({mesh: attributed(testMeshes()), mode, ...ind, offsetScale: 0.35, selection: mod(index(), 3).eq(1).not()})
            return storeTopSide(ex.mesh, ex.top, ex.side)
        })
        add(`extrude-${m}-single`, `Extrude Mesh ${m}: single offset on everything`, SHAPE_SCENE, () => {
            const ex = n.ExtrudeMesh({mesh: attributed(testMeshes()), mode, ...ind, offset: [0.1, -0.2, 0.7], offsetScale: 1.5})
            return storeTopSide(ex.mesh, ex.top, ex.side)
        })
        add(`extrude-${m}-field`, `Extrude Mesh ${m}: offset and scale fields`, SHAPE_SCENE, () => {
            const ex = n.ExtrudeMesh({mesh: attributed(testMeshes()), mode, ...ind,
                offset: n.CombineXYZ({x: idx(0.01), y: 0.2, z: mod(index(), 4).mul(0.3)}).vector, offsetScale: mod(index(), 3).add(0.5),
                selection: mod(index(), 4).lt(3)})
            return storeTopSide(ex.mesh, ex.top, ex.side)
        })
    }
    add('extrude-grid-region', 'Extrude Mesh face region of a grid (inner edges, boundary, deselected neighbours)', {}, () => {
        const grid = attributed(n.MeshGrid({sizeX: 3, sizeY: 2, verticesX: 5, verticesY: 4}).mesh)
        const sel = n.Position().position.x.lt(0.6)
        const ex = n.ExtrudeMesh({mesh: grid, selection: sel, individual: false, offsetScale: 0.5})
        return storeTopSide(ex.mesh, ex.top, ex.side)
    })
    add('extrude-cube-all-faces', 'Extrude Mesh all faces of a cube (closed region: no side faces)', {}, () => {
        const ex = n.ExtrudeMesh({mesh: attributed(n.MeshCube({verticesX: 3}).mesh), individual: false})
        return storeTopSide(ex.mesh, ex.top, ex.side)
    })
    add('extrude-nothing', 'Extrude Mesh with an empty selection leaves the mesh (no Top/Side attributes)', {}, () => {
        const ex = n.ExtrudeMesh({mesh: n.MeshGrid({verticesX: 3, verticesY: 3}).mesh, selection: false})
        return storeTopSide(ex.mesh, ex.top, ex.side)
    })
    add('extrude-twice', 'Extrude Mesh twice (edges of the result of a face extrusion)', SHAPE_SCENE, () => {
        const a = n.ExtrudeMesh({mesh: attributed(testMeshes()), offsetScale: 0.2})
        return n.ExtrudeMesh({mesh: a.mesh, mode: 'EDGES', selection: a.top, offset: [0, 0, 0.3]}).mesh
    })
    // endregion

    // region Split Edges
    add('split-edges-all', 'Split Edges: every edge (n-gons, non-manifold edge, loose edges and vertices)', SHAPE_SCENE, () =>
        n.SplitEdges({mesh: attributed(testMeshes())}).mesh)
    add('split-edges-field', 'Split Edges: every third edge', SHAPE_SCENE, () =>
        n.SplitEdges({mesh: attributed(testMeshes()), selection: mod(index(), 3).eq(0)}).mesh)
    add('split-edges-loose', 'Split Edges: a selection that includes loose edges next to unselected loose edges', SHAPE_SCENE, () => {
        const lines = n.JoinGeometry({geometry: [testMeshes(), n.MeshLine({count: 5, offset: [0.3, 0.3, 0]}).mesh]}).geometry
        return n.SplitEdges({mesh: attributed(lines), selection: mod(index(), 2).eq(1)}).mesh
    })
    add('split-edges-cube-ring', 'Split Edges: one edge of a subdivided cube (isolated split edge: no new edges, deduplication)', {}, () =>
        n.SplitEdges({mesh: attributed(n.MeshCube({verticesX: 3, verticesY: 3, verticesZ: 3}).mesh), selection: index().eq(5)}).mesh)
    add('split-edges-grid-sharp', 'Split Edges: grid edges whose angle is not zero after Set Position', {}, () => {
        const grid = n.SetPosition({geometry: n.MeshGrid({sizeX: 2, sizeY: 2, verticesX: 5, verticesY: 5}).mesh,
            offset: n.CombineXYZ({z: n.Math({operation: 'ABSOLUTE', value: n.Position().position.x}).value}).vector}).geometry
        return n.SplitEdges({mesh: attributed(grid), selection: n.EdgeAngle().unsignedAngle.gt(0.1)}).mesh
    })
    // endregion

    // region Duplicate Elements
    const withId = (g: Socket<'GEOMETRY'>) => n.SetID({geometry: g, iD: mod(idx(7), 11).add(3)}).geometry
    const amount = () => mod(index(), 4).sub(1)
    for (const [domain, label] of [['POINT', 'points'], ['EDGE', 'edges'], ['FACE', 'faces']] as const) {
        add(`duplicate-${label}`, `Duplicate Elements ${domain}: amount field (with 0 and negative), selection, ids, Duplicate Index`, SHAPE_SCENE, () => {
            const d = n.DuplicateElements({geometry: withId(attributed(testMeshes())), domain, amount: amount(), selection: mod(index(), 5).eq(2).not()})
            return store(d.geometry, domain, 'dup', d.duplicateIndex)
        })
        add(`duplicate-${label}-single`, `Duplicate Elements ${domain}: single amount 3, everything`, SHAPE_SCENE, () => {
            const d = n.DuplicateElements({geometry: withId(attributed(testMeshes())), domain, amount: 3})
            return store(d.geometry, domain, 'dup', d.duplicateIndex)
        })
    }
    add('duplicate-faces-grid-ids', 'Duplicate Elements FACE of an all-quad grid with ids and a partial selection', {}, () => {
        const d = n.DuplicateElements({geometry: withId(attributed(n.MeshGrid({verticesX: 4, verticesY: 3}).mesh)), domain: 'FACE', amount: 2, selection: index().gt(1)})
        return store(d.geometry, 'FACE', 'dup', d.duplicateIndex)
    })
    add('duplicate-points-cloud', 'Duplicate Elements POINT of a point cloud with ids and a mesh (both duplicated), field amount', {}, () => {
        const pts = withId(n.Points({count: 6, position: n.CombineXYZ({x: index(), y: 1}).vector}).geometry)
        const joined = n.JoinGeometry({geometry: [pts, n.MeshLine({count: 3}).mesh]}).geometry
        const d = n.DuplicateElements({geometry: joined, amount: mod(index(), 3)})
        return store(d.geometry, 'POINT', 'dup', d.duplicateIndex)
    })
    add('duplicate-instances', 'Duplicate Elements INSTANCE with instance attributes (ids are not kept)', {}, () => {
        const inst = n.SetID({geometry: n.InstanceOnPoints({points: n.MeshLine({count: 4}).mesh, instance: n.MeshCube({size: 0.2}).mesh, scale: index().add(1)}).instances, iD: idx(5)}).geometry
        const d = n.DuplicateElements({geometry: store(inst, 'INSTANCE', 'w', idx(0.5)), domain: 'INSTANCE', amount: amount(), selection: index().eq(2).not()})
        return store(d.geometry, 'INSTANCE', 'dup', d.duplicateIndex)
    })
    add('duplicate-nothing', 'Duplicate Elements with amount 0 gives an empty geometry', {}, () =>
        n.DuplicateElements({geometry: n.MeshCube().mesh, amount: 0}).geometry)
    // endregion
    return cases
}
