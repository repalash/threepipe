/**
 * `bmMeshIsValid`, the port of Blender's `BM_mesh_is_valid` (`bmesh_mesh_validate.cc:63`).
 *
 * Valid inputs are Blender-authored meshes from `fixtures/` - including the Buildify part with 21
 * three-face edges, so a non-manifold mesh is shown not to be "invalid" - and each check of the C++ is
 * then provoked once with the smallest mesh that breaks it, expecting Blender's own wording.
 */

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {MeshData} from '../src/MeshData'
import {ElemFlag} from '../src/constants'
import {BMesh} from '../src/bmesh/BMesh'
import {bmFromMesh} from '../src/bmesh/convert'
import {bmMeshIsValid} from '../src/bmesh/validate'

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function blenderMesh(name: string): MeshData {
    const gt = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8'))
    const mesh = new MeshData()
    mesh.resize({verts: gt.vertsNum, edges: gt.edgesNum, faces: gt.facesNum, corners: gt.cornersNum})
    mesh.positions.set(gt.positions)
    mesh.edgeVerts.set(gt.edgeVerts)
    mesh.cornerVerts.set(gt.cornerVerts)
    mesh.cornerEdges.set(gt.cornerEdges)
    mesh.faceOffsets.set(gt.faceOffsets)
    return mesh
}

function quad() {
    const bm = new BMesh()
    const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0)]
    const f = bm.faceCreate(v)
    return {bm, v, f}
}

describe('bmMeshIsValid (BM_mesh_is_valid)', () => {
    it.each([
        'blend-load-test-prim-cube', 'blend-load-test-prim-cube-tri', 'blend-load-poly-test',
        'blend-load-test-prim', 'blend-load-test-label', 'blend-buildify-nonmanifold',
    ])('passes the Blender-authored mesh %s', name => {
        expect(bmMeshIsValid(bmFromMesh(blenderMesh(name)))).toEqual([])
    })

    it('reports elements that are hidden and selected (lines 85, 114, 151)', () => {
        const {bm, v, f} = quad()
        v[2].hflag |= ElemFlag.Select | ElemFlag.Hidden
        const e = [...bm.edges][1]
        e.hflag |= ElemFlag.Select | ElemFlag.Hidden
        f.hflag |= ElemFlag.Select | ElemFlag.Hidden
        expect(bmMeshIsValid(bm)).toEqual([
            'vert 2: is hidden and selected',
            'edge 1: is hidden and selected',
            'face 0: is hidden and selected',
        ])
    })

    it('does not report hidden-only or selected-only elements', () => {
        const {bm, v} = quad()
        v[0].hflag |= ElemFlag.Hidden
        v[1].hflag |= ElemFlag.Select
        expect(bmMeshIsValid(bm)).toEqual([])
    })

    it('reports two edges over one vertex pair (line 108)', () => {
        const {bm, v} = quad()
        bm.edgeCreate(v[2], v[1]) // no `noDouble`: a second edge (1, 2), in the other direction
        expect(bmMeshIsValid(bm)).toEqual(['edge 4, 1: are duplicates'])
    })

    it('reports a face repeated over the same verts, in either winding (line 237)', () => {
        const {bm, v} = quad()
        bm.faceCreate([v[0], v[1], v[2], v[3]])
        bm.faceCreate([v[3], v[2], v[1], v[0]])
        expect(bmMeshIsValid(bm)).toEqual(['face 1: duplicate of 0', 'face 2: duplicate of 0'])
    })

    it('reports a face whose stored length disagrees with its cycle (line 167)', () => {
        const {bm, f} = quad()
        f.len = 5
        expect(bmMeshIsValid(bm)).toEqual(['face 0: has length of 5 but should be 4'])
    })

    it('reports a loop whose prev does not point back (lines 195, 198)', () => {
        const {bm, f} = quad()
        const l = f.lFirst!
        // l.next.prev now skips l: l.next's 'next/prev' check at corner 1 fails, and l's own 'next/prev' too.
        l.next.prev = l.prev
        const errors = bmMeshIsValid(bm)
        expect(errors).toContain('face 0: has invalid \'next/prev\' at corner: 0')
        expect(errors).toContain('face 0: has invalid \'prev/next\' at corner: 1')
    })

    it('reports a loop that points to another face (line 189)', () => {
        const bm = new BMesh()
        const v = [0, 1, 2, 3, 4].map(i => bm.vertCreate(i, i % 2, 0))
        const a = bm.faceCreate([v[0], v[1], v[2]])
        bm.faceCreate([v[2], v[3], v[4]])
        a.lFirst!.next.f = [...bm.faces][1]
        expect(bmMeshIsValid(bm)).toEqual(['face 0: has loop that points to face: 1 at corner: 1'])
    })

    it('reports an edge whose radial loop belongs to another edge (line 129)', () => {
        const {bm, f} = quad()
        const e0 = f.lFirst!.e!
        const e1 = f.lFirst!.next.e!
        e0.l = f.lFirst!.next // a loop of e1
        expect(bmMeshIsValid(bm)[0]).toBe('edge 0: has invalid loop, loop is of face 0')
        expect(e1).not.toBe(e0)
    })

    it('reports a vertex whose edge does not use it (line 92)', () => {
        const {bm, v} = quad()
        v[0].e = [...bm.edges][1] // edge (1, 2)
        expect(bmMeshIsValid(bm)[0]).toBe('vert 0: is not in its referenced edge: 1')
    })

    it('leaves the mesh flags untouched', () => {
        const {bm} = quad()
        const flags = [...bm.verts, ...bm.edges, ...bm.faces, ...bm.loops].map(e => e.hflag)
        bmMeshIsValid(bm)
        expect([...bm.verts, ...bm.edges, ...bm.faces, ...bm.loops].map(e => e.hflag)).toEqual(flags)
    })
})
