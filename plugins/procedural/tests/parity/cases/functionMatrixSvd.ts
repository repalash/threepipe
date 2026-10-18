/**
 * Parity cases for Matrix SVD (Eigen JacobiSVD on the 3x3 part): random matrices (the 4th row / column ignored),
 * matrices of {0, 1} and {-1, 1} entries (zero matrix, identity, rank-deficient, repeated singular values, sorting
 * ties), and magnitudes from 1e-30 to 1e30 (the scaling step).
 */

import {GroupBuilder, Socket} from '../../../src/dsl/builder'
import {outputsOf, pointsCase} from './functionCommon'
import {ParityCase} from './types'

function svd(g: GroupBuilder, entry: (c: number, r: number) => Socket | number, extra = false): Record<string, Socket> {
    const comps: Record<string, Socket | number> = {}
    for (let c = 1; c <= 4; c++) for (let r = 1; r <= 4; r++) {
        if (c <= 3 && r <= 3) comps[`column${c}Row${r}`] = entry(c, r)
        else if (extra) comps[`column${c}Row${r}`] = entry(c, r)
    }
    const m = g.node('FunctionNodeCombineMatrix', comps).outputs.matrix
    return {m, ...outputsOf(g.node('FunctionNodeMatrixSVD', {matrix: m}), 'svd_')}
}

export function functionMatrixSvdCases(): ParityCase[] {
    const cases: ParityCase[] = []
    cases.push(pointsCase('svd-random', 'Random 4x4 matrices in [-2, 2]: only the 3x3 part is decomposed', 512,
        (v, g) => svd(g, (c, r) => v.noise(c * 10 + r, -2, 2), true)))
    cases.push(pointsCase('svd-binary', 'All 3x3 matrices of {0, 1}: zero, identity, permutations, rank 1 and 2, ties', 512,
        (v, g) => svd(g, (c, r) => v.digit(2, (c - 1) * 3 + (r - 1), 0, 1))))
    cases.push(pointsCase('svd-signs', 'All 3x3 matrices of {-1, 1}: repeated singular values, negative diagonals', 512,
        (v, g) => svd(g, (c, r) => v.digit(2, (c - 1) * 3 + (r - 1), -1, 2))))
    cases.push(pointsCase('svd-magnitudes', 'Random matrices scaled by 1e-30 .. 1e30, and diagonal ones with mixed signs', 200, (v, g) => {
        const scale = v.math('POWER', 10, v.digit(5, 0, -30, 15))
        const keep = v.math('LESS_THAN', v.digit(2, 3, 0, 1), 0.5)
        return svd(g, (c, r) => {
            const x = v.math('MULTIPLY', v.noise(c * 7 + r, -3, 3), scale)
            return c === r ? x : v.math('MULTIPLY', x, keep)
        })
    }))
    return cases
}


