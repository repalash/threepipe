import {describe, expect, it} from 'vitest'
import {MeshData} from '../MeshData'
import {axisDominantV3, uvCubeProject} from './cubeProject'

// a 2 x 2 x 2 cube: 8 verts, 6 quads facing out
function cube(): MeshData {
    const P = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]
    const F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
    return MeshData.fromFaces({positions: P, faces: F})
}

describe('uvCubeProject (Blender uvedit_unwrap_cube_project)', () => {
    it('axis_dominant_v3 drops the largest axis, ties to z then y', () => {
        expect(axisDominantV3([0, 0, 1])).toEqual([0, 1])
        expect(axisDominantV3([0, -1, 0])).toEqual([0, 2])
        expect(axisDominantV3([1, 0, 0])).toEqual([1, 2])
        expect(axisDominantV3([1, 1, 1])).toEqual([0, 1])
        expect(axisDominantV3([1, 1, 0])).toEqual([0, 2])
    })
    it('projects each face on its dominant axis', () => {
        const m = cube()
        uvCubeProject(m, {cubeSize: 2})
        const uv = m.attributes.get('uv')!.data
        // +z face (face 1): uv = 0.5 + (x, y) / 2
        const O = m.faceOffsets, CV = m.cornerVerts, P = m.positions
        for (let c = O[1]; c < O[2]; c++) {
            expect(uv[2 * c]).toBeCloseTo(0.5 + P[3 * CV[c]] / 2)
            expect(uv[2 * c + 1]).toBeCloseTo(0.5 + P[3 * CV[c] + 1] / 2)
        }
        // +x face (face 4): uv = 0.5 + (y, z) / 2
        for (let c = O[4]; c < O[5]; c++) {
            expect(uv[2 * c]).toBeCloseTo(0.5 + P[3 * CV[c] + 1] / 2)
            expect(uv[2 * c + 1]).toBeCloseTo(0.5 + P[3 * CV[c] + 2] / 2)
        }
    })
    it('cube size 0 means 1, and only the listed faces change', () => {
        const m = cube()
        uvCubeProject(m, {cubeSize: 0, faces: [1], center: [1, 1, 1]})
        const uv = m.attributes.get('uv')!.data
        const O = m.faceOffsets
        for (let c = O[0]; c < O[1]; c++) expect([uv[2 * c], uv[2 * c + 1]]).toEqual([0, 0])
        for (let c = O[1]; c < O[2]; c++) expect(uv[2 * c]).toBeLessThanOrEqual(0.5)
    })
})
