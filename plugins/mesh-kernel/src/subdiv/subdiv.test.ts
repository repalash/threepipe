import {describe, expect, it} from 'vitest'
import {MeshData} from '../MeshData'
import {AttrDomain, AttrName} from '../constants'
import {primitiveCube} from '../generate/primitives'
import {subdivisionSurface, subdivisionSurfaceEvaluate} from './subdivisionSurface'
import {subdivNewFromMesh, SubdivFVarLinearInterpolation, SubdivVtxBoundaryInterpolation} from './bke/subdiv'
import {adaptiveOptions, TopologyRefiner} from './osd/topologyRefiner'
import {LocalMask, Options, Rule, Scheme, SchemeType, VertexNeighborhood} from './osd/sdc'
import {VT_INCOMPLETE} from './osd/vtrTypes'

const cube = () => MeshData.fromFaces({
    positions: [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
    faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
})
const point = (m: MeshData, v: number) => [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]]
const near = (a: number[], b: number[], eps = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < eps)
const find = (m: MeshData, p: number[], eps = 1e-6) => { for (let v = 0; v < m.vertsNum; v++) if (near(point(m, v), p, eps)) return v; return -1 }

/** The OpenSubdiv refiner Blender builds for `mesh` (`subdiv_new_from_mesh`), before refinement. */
function refinerOf(mesh: MeshData, adaptive = false, level = 1): TopologyRefiner {
    const subdiv = subdivNewFromMesh({isSimple: false, isAdaptive: adaptive, level, useCreases: true,
        vtxBoundaryInterpolation: SubdivVtxBoundaryInterpolation.EDGE_ONLY, fvarLinearInterpolation: SubdivFVarLinearInterpolation.BOUNDARIES}, mesh)
    return subdiv!.topologyRefiner!.topologyRefiner
}

describe('OpenSubdiv port: Vtr level', () => {
    it('rebuilds edges and orders a cube vertex\'s faces and edges counter-clockwise', () => {
        const L = refinerOf(cube()).getVtrLevel(0)
        expect(L.getNumEdges()).toBe(12)
        for (let v = 0; v < 8; v++) {
            const faces = L.getVertexFaces(v).toArray(), edges = L.getVertexEdges(v).toArray()
            expect(faces.length).toBe(3)
            expect(edges.length).toBe(3)
            // interleaved: edge i lies between face i-1 and face i
            for (let i = 0; i < 3; i++) {
                const ef = L.getEdgeFaces(edges[i]).toArray()
                expect(ef).toContain(faces[i])
                expect(ef).toContain(faces[(i + 2) % 3])
            }
        }
    })

    it('tags a fin edge (three faces) and its vertices non-manifold', () => {
        const m = MeshData.fromFaces({positions: new Array(24).fill(0).map((_, i) => i * 0.1), faces: [[0, 2, 3, 1], [1, 5, 4, 0], [0, 6, 7, 1]]})
        const L = refinerOf(m).getVtrLevel(0)
        const e = L.findEdge(0, 1)
        expect(L.isEdgeNonManifold(e)).toBe(true)
        expect(L.getEdgeFaces(e).size).toBe(3)
        expect(L.isVertexNonManifold(0)).toBe(true)
        expect(L.isVertexNonManifold(1)).toBe(true)
    })
})

/** A vertex neighbourhood for the Sdc masks: `n` edges and faces with the given sharpness. */
function vertexNeighborhood(n: number, sharpnessPerEdge: number[], childSharpnessPerEdge = new Array(n).fill(0)): VertexNeighborhood {
    return {
        getNumEdges: () => n,
        getNumFaces: () => n,
        getSharpness: () => 0,
        getSharpnessPerEdge: out => { sharpnessPerEdge.forEach((s, i) => { out[i] = s }); return out },
        getChildSharpness: () => 0,
        getChildSharpnessPerEdge: (_c, out) => { childSharpnessPerEdge.forEach((s, i) => { out[i] = s }); return out },
    }
}

describe('OpenSubdiv port: masks (float, as Blender evaluates them)', () => {
    const scheme = new Scheme(SchemeType.CATMARK, new Options())

    it('a smooth valence-3 vertex gets (n-2)/n, 1/n^2 on edges and face centres', () => {
        const m = new LocalMask(3)
        scheme.computeVertexVertexMask(vertexNeighborhood(3, [0, 0, 0]), m, Rule.SMOOTH, Rule.SMOOTH)
        expect(m.vertexWeight(0)).toBeCloseTo(1 / 3, 7)
        for (let i = 0; i < 3; i++) {
            expect(m.edgeWeight(i)).toBeCloseTo(1 / 9, 7)
            expect(m.faceWeight(i)).toBeCloseTo(1 / 9, 7)
        }
    })

    it('a semi-sharp crease of 0.5 blends the crease and smooth masks half and half', () => {
        const m = new LocalMask(4)
        scheme.computeVertexVertexMask(vertexNeighborhood(4, [0.5, 0, 0.5, 0]), m)
        // crease: v 3/4, e 1/8 on the two sharp edges; smooth: v 1/2, e 1/16, f 1/16
        expect(m.vertexWeight(0)).toBeCloseTo(0.5 * 0.75 + 0.5 * 0.5, 7)
        expect(m.edgeWeight(0)).toBeCloseTo(0.5 * 0.125 + 0.5 / 16, 7)
        expect(m.edgeWeight(1)).toBeCloseTo(0.5 / 16, 7)
        expect(m.faceWeight(0)).toBeCloseTo(0.5 / 16, 7)
    })
})

describe('subdivisionSurface', () => {
    it('level 1 of a cube without the limit: 26 vertices, 24 quads, the textbook Catmull-Clark points', () => {
        const r = subdivisionSurface(cube(), {levels: 1, useLimitSurface: false})
        expect(r.vertsNum).toBe(26)
        expect(r.facesNum).toBe(24)
        expect(find(r, [5 / 9, 5 / 9, 5 / 9])).toBeGreaterThanOrEqual(0) // corner (Q + 2R)/3
        expect(find(r, [0.75, 0.75, 0])).toBeGreaterThanOrEqual(0) // edge point
        expect(find(r, [1, 0, 0])).toBeGreaterThanOrEqual(0) // face point
        expect(r.validate()).toEqual([])
    })

    it('level 2 counts, and every face a quad with consistent winding (closed and manifold)', () => {
        const r = subdivisionSurface(cube(), {levels: 2, useLimitSurface: false})
        expect(r.vertsNum).toBe(98)
        expect(r.facesNum).toBe(96)
        expect(r.edgesNum).toBe(192)
        expect(r.validate()).toEqual([])
    })

    it('the limit of a cube corner is the limit mask of the refined corner', () => {
        const lim = subdivisionSurface(cube(), {levels: 1})
        const ref = subdivisionSurface(cube(), {levels: 1, useLimitSurface: false})
        // smooth valence 3 limit mask: v 1 - n(e+f), e = 4/(n(n+5)), f = 1/(n(n+5)) on the opposite quad corner
        const n = 3, fw = 1 / (n * (n + 5)), ew = 4 * fw, vw = 1 - n * (ew + fw)
        const c = 5 / 9, e = 0.75
        // at level 1 a corner's edge neighbours are edge points (0.75, 0.75, 0)-like, opposite quad corners are face points
        const x = vw * c + ew * (e + e + 0) + fw * (1 + 0 + 0)
        expect(find(lim, [x, x, x], 1e-6)).toBeGreaterThanOrEqual(0)
        expect(ref.vertsNum).toBe(lim.vertsNum)
    })

    it('a fully creased cube stays a cube; Simple subdivision never moves a vertex off the cage', () => {
        const m = cube()
        const crease = m.attributes.ensure(AttrName.creaseEdge, AttrDomain.Edge, 'float').data as Float32Array
        crease.fill(1)
        const r = subdivisionSurface(m, {levels: 2})
        for (let v = 0; v < r.vertsNum; v++) expect(Math.max(...point(r, v).map(Math.abs))).toBeCloseTo(1, 6)
        expect(find(r, [1, 1, 1])).toBeGreaterThanOrEqual(0)
        const s = subdivisionSurface(cube(), {levels: 2, scheme: 'SIMPLE'})
        for (let v = 0; v < s.vertsNum; v++) expect(Math.max(...point(s, v).map(Math.abs))).toBeCloseTo(1, 6)
    })

    it('boundary: ALL rounds a grid corner, PRESERVE_CORNERS keeps it', () => {
        const pos: number[] = [], faces: number[][] = []
        for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) pos.push(-1 + 2 * x / 3, -1 + 2 * y / 3, 0)
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) faces.push([y * 4 + x, y * 4 + x + 1, (y + 1) * 4 + x + 1, (y + 1) * 4 + x])
        const g = MeshData.fromFaces({positions: pos, faces})
        const corner = [1, 1, 0]
        const keep = subdivisionSurface(g, {levels: 1, boundarySmooth: 'PRESERVE_CORNERS'})
        const all = subdivisionSurface(g, {levels: 1, boundarySmooth: 'ALL'})
        expect(find(keep, corner)).toBeGreaterThanOrEqual(0)
        expect(find(all, corner)).toBe(-1)
        // ALL treats the corner as a crease vertex along the boundary: limit 2/3 v + 1/6 each neighbour
        expect(keep.facesNum).toBe(all.facesNum)
    })

    it('the limit surface isolates features adaptively up to quality; the output grid is the resolution of levels', () => {
        const m = primitiveCube()
        const crease = m.attributes.ensure(AttrName.creaseEdge, AttrDomain.Edge, 'float').data as Float32Array
        crease[0] = 0.5 // sharpness 2.5
        // `subdiv_to_mesh` at resolution (1 << levels) + 1, whatever the quality the limit surface is refined to
        for (const quality of [1, 3]) expect(subdivisionSurfaceEvaluate(m, {levels: 1, quality})!.mesh.facesNum).toBe(24)
        const adaptive = (quality: number) => {
            const r = refinerOf(m, true, quality)
            r.refineAdaptive({...adaptiveOptions(quality), useInfSharpPatch: true})
            return r
        }
        // the cube's valence-3 corners are extraordinary: isolated at every level up to quality, sparsely
        const r3 = adaptive(3), r2 = adaptive(2)
        expect(r3.getMaxLevel()).toBe(3)
        expect(r2.getMaxLevel()).toBe(2)
        expect(r3.getVtrLevel(3).getNumFaces()).toBeGreaterThan(0)
        expect(r3.getVtrLevel(3).getNumFaces()).toBeLessThan(6 * 4 ** 3)
        // every level-1 face touches a cube corner; from level 2 only those around the corners are refined further,
        // with their neighbouring (incomplete) vertices
        let incomplete = 0
        for (let v = 0; v < r3.getVtrLevel(3).getNumVertices(); v++) if (r3.getVtrLevel(3).getVertexTag(v) & VT_INCOMPLETE) incomplete++
        expect(incomplete).toBeGreaterThan(0)
    })

    it('n-gons split into quads around a centre vertex; loose vertices are kept (subdiv_foreach_loose_vertices)', () => {
        const m = MeshData.fromFaces({positions: [0, 0, 0, 1, 0, 0, 1.5, 1, 0, 0.5, 1.6, 0, -0.5, 1, 0, 9, 9, 9], faces: [[0, 1, 2, 3, 4]]})
        const r = subdivisionSurface(m, {levels: 1, useLimitSurface: false})
        expect(r.facesNum).toBe(5)
        expect(r.vertsNum).toBe(5 + 5 + 1 + 1)
        expect(find(r, [9, 9, 9])).toBeGreaterThanOrEqual(0)
    })

    it('level 0 is a copy', () => {
        const m = cube()
        const r = subdivisionSurface(m, {levels: 0})
        expect(r).not.toBe(m)
        expect(Array.from(r.positions)).toEqual(Array.from(m.positions))
    })
})

describe('subdivisionSurface attributes (subdiv_mesh.cc semantics)', () => {
    it('face attributes follow the coarse face, edge attributes only the edges along coarse edges, points mix bilinearly', () => {
        const m = cube()
        const sf = m.attributes.ensure(AttrName.sharpFace, AttrDomain.Face, 'bool').data as Uint8Array
        sf[1] = 1
        const mi = m.attributes.ensure(AttrName.materialIndex, AttrDomain.Face, 'int32').data as Int32Array
        mi[2] = 3
        const se = m.attributes.ensure(AttrName.sharpEdge, AttrDomain.Edge, 'bool').data as Uint8Array
        se[0] = 1
        const w = m.attributes.ensure('weight', AttrDomain.Point, 'float').data as Float32Array
        w[0] = 1
        const r = subdivisionSurfaceEvaluate(m, {levels: 2, useLimitSurface: false})!
        const out = r.mesh
        const osf = out.attributes.get(AttrName.sharpFace)!.data, omi = out.attributes.get(AttrName.materialIndex)!.data
        expect(Array.from(osf).reduce((a, b) => a + b, 0)).toBe(16) // one coarse face -> 16 faces at level 2
        expect(Array.from(omi).filter(v => v === 3).length).toBe(16)
        expect(Array.from(out.attributes.get(AttrName.sharpEdge)!.data).reduce((a, b) => a + b, 0)).toBe(4) // one coarse edge -> 4 edges
        // the weight is 1 at the coarse corner, 1/2 at the first edge midpoint, 1/4 at the face centre
        const ow = out.attributes.get('weight')!.data
        const values = new Set(Array.from(ow).map(v => +v.toFixed(4)))
        for (const v of [1, 0.75, 0.5, 0.25, 0.5625, 0.375, 0.125, 0]) expect(values.has(v)).toBe(true)
        expect(r.warnings).toEqual([])
    })

    it('UVs: linear when uvSmooth is NONE; per-face islands stay inside their faces', () => {
        const m = cube()
        const uv = m.attributes.ensure('UVMap', AttrDomain.Corner, 'float2').data as Float32Array
        // every face its own unit square, offset along u: all edges are UV seams
        for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
            const c = 4 * f + k
            uv[2 * c] = 2 * f + (k === 1 || k === 2 ? 1 : 0)
            uv[2 * c + 1] = k >= 2 ? 1 : 0
        }
        for (const uvSmooth of ['NONE', 'PRESERVE_BOUNDARIES'] as const) {
            const r = subdivisionSurfaceEvaluate(m, {levels: 2, useLimitSurface: false, uvSmooth})!
            expect(r.warnings).toEqual([])
            const ouv = r.mesh.attributes.get('UVMap')!.data
            // linear boundaries: every corner stays inside its coarse face's square
            for (let c = 0; c < r.mesh.cornersNum; c++) {
                const f = Math.floor(c / 64) // level 2: 16 child quads per coarse face, 64 corners, contiguous
                expect(ouv[2 * c]).toBeGreaterThanOrEqual(2 * f - 1e-6)
                expect(ouv[2 * c]).toBeLessThanOrEqual(2 * f + 1 + 1e-6)
            }
        }
    })

    it('UVs that are an affine map of a flat grid subdivide like the positions (SMOOTH_ALL)', () => {
        const pos: number[] = [], faces: number[][] = []
        const n = 4
        for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(x + 0.13 * Math.sin(3 * y), y + 0.1 * Math.cos(2 * x), 0)
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) faces.push([y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x])
        const g = MeshData.fromFaces({positions: pos, faces})
        const uv = g.attributes.ensure('UVMap', AttrDomain.Corner, 'float2').data as Float32Array
        const map = (x: number, y: number) => [0.5 * x - 0.2 * y + 0.1, 0.3 * x + 0.4 * y]
        for (let c = 0; c < g.cornersNum; c++) {
            const v = g.cornerVerts[c]
            const [u, w] = map(g.positions[3 * v], g.positions[3 * v + 1])
            uv[2 * c] = u; uv[2 * c + 1] = w
        }
        for (const useLimitSurface of [false, true]) {
            const r = subdivisionSurfaceEvaluate(g, {levels: 2, useLimitSurface, uvSmooth: 'SMOOTH_ALL'})!
            const out = r.mesh, ouv = out.attributes.get('UVMap')!.data
            for (let c = 0; c < out.cornersNum; c++) {
                const v = out.cornerVerts[c]
                const [u, w] = map(out.positions[3 * v], out.positions[3 * v + 1])
                expect(ouv[2 * c]).toBeCloseTo(u, 5)
                expect(ouv[2 * c + 1]).toBeCloseTo(w, 5)
            }
        }
    })
})
