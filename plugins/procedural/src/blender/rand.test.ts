import {expect, it} from 'vitest'
import {RandomNumberGenerator} from './rand'
import {KDTree3} from './kdtree'

it('RandomNumberGenerator is drand48 (BLI_rand.hh)', () => {
    // The first lrand48() values after srand48(0) (glibc, which seeds the same way: `(seed << 16) | 0x330E`).
    const rng = new RandomNumberGenerator(0)
    expect([rng.getInt32(), rng.getInt32(), rng.getInt32()]).toEqual([366850414, 1610402240, 206956554])
})

it('KDTree3 range search finds exactly the points within range', () => {
    const pts: number[][] = []
    const rng = new RandomNumberGenerator(7)
    for (let i = 0; i < 300; i++) pts.push([rng.getFloat(), rng.getFloat(), rng.getFloat()])
    const tree = new KDTree3(pts.length)
    pts.forEach((p, i) => tree.insert(i, p[0], p[1], p[2]))
    tree.balance()
    const found: number[] = []
    tree.rangeSearch(0.5, 0.5, 0.5, 0.2, i => { found.push(i); return true })
    const brute = pts.map((p, i) => [i, (p[0] - 0.5) ** 2 + (p[1] - 0.5) ** 2 + (p[2] - 0.5) ** 2] as const).filter(([, d]) => d <= 0.04).map(([i]) => i)
    expect(found.sort((a, b) => a - b)).toEqual(brute)
})
