import {describe, expect, it} from 'vitest'
import {bakeGeometry, meshFaceNormalsCustom} from '@threepipe/mesh-kernel'
import {PARTS, ringLabels, scaleLabels, wordmark} from './index'

const defaults: Record<string, Record<string, unknown>> = {
    'product/knurled-ring': {radius: 38, length: 14, ribs: 72},
    'product/dial': {radius: 11, height: 8, lockRadius: 4.6},
    'product/button': {radius: 3.3, height: 1.6, dome: 0.3, collar: 0.8},
    'product/lens-barrel': {stations: [[30, 0], [32, 4], [32, 20], [36, 24]]},
    'product/rocker': {length: 8, width: 4, height: 2},
    'product/eyecup': {width: 50, height: 35, depth: 9},
    'product/strap-lug': {width: 12, height: 6},
}

/** Signed volume by the divergence theorem: positive when every face winds outwards. */
function volume(mesh: any): number {
    const g = bakeGeometry(mesh, {uvLayer: null}).data
    const P = g.position, I = g.index
    let v = 0
    for (let t = 0; t < I.length; t += 3) {
        const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2]
        v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6
    }
    return v
}

describe('product parts', () => {
    for (const [id, params] of Object.entries(defaults)) {
        it(`${id}: valid, closed, wound outwards, deterministic`, () => {
            const def = PARTS.get(id)!
            const a = def.build(params as never), b = def.build(params as never)
            expect(a.mesh.validate()).toEqual([])
            // every edge has two faces: a closed solid
            const ef = new Int32Array(a.mesh.edgesNum)
            for (const e of a.mesh.cornerEdges) ef[e]++
            expect([...ef].every(n => n === 2)).toBe(true)
            expect(volume(a.mesh)).toBeGreaterThan(0)
            expect(Array.from(a.mesh.positions)).toEqual(Array.from(b.mesh.positions))
            expect(meshFaceNormalsCustom(a.mesh).length).toBe(a.mesh.facesNum * 3)
        })
    }
    it('knurled ring: ribs are real geometry, 4 samples per rib, groove depth as asked', () => {
        const r = PARTS.get('product/knurled-ring')!.build({radius: 38, length: 14, ribs: 72, ribDepth: 0.6})
        const P = r.mesh.positions
        let rmin = 1e9, rmax = 0
        for (let i = 0; i < P.length; i += 3) if (P[i + 1] > 0.5 && P[i + 1] < 13.5) { const rr = Math.hypot(P[i], P[i + 2]); if (rr > 30) { rmin = Math.min(rmin, rr); rmax = Math.max(rmax, rr) } }
        expect(rmax).toBeCloseTo(38, 5)
        expect(rmin).toBeCloseTo(37.4, 5)
        expect(r.groups.knurl.faces!.length).toBe(72 * 4)
    })
    it('labels are SVG documents', () => {
        expect(ringLabels({size: 256, labels: ['M', 'B', 'C1']})).toMatch(/^<svg[^>]*>.*rotate\(120\.00.*<\/svg>$/)
        expect(scaleLabels({width: 400, height: 40, marks: [[0.1, '0.45'], [0.9, '∞']], minor: 2})).toContain('∞')
        expect(wordmark({width: 300, height: 80, text: 'EOS', sub: '5D Mark IV'})).toContain('5D Mark IV')
    })
})
