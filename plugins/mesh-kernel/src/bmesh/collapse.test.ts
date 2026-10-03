import {describe, expect, it} from 'vitest'
import {BMesh} from './BMesh'
import {BMVert} from './types'
import {diskEdgeExists, edgeFaceCount} from './structure'
import {edgeCollapse, joinVertKillEdge} from './collapse'

function quad(bm: BMesh) {
    const v = [
        bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0),
        bm.vertCreate(1, 1, 0), bm.vertCreate(0, 1, 0),
    ]
    return {v, f: bm.faceCreate(v)}
}

function tri(bm: BMesh) {
    const v = [bm.vertCreate(0, 0, 0), bm.vertCreate(1, 0, 0), bm.vertCreate(0, 1, 0)]
    return {v, f: bm.faceCreate(v)}
}

/** A ring of `n` quads round a tube, plus an n-gon cap on the top rim - the cone's starting point. */
function cappedTube(bm: BMesh, n: number) {
    const bottom: BMVert[] = []
    const top: BMVert[] = []
    for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n
        bottom.push(bm.vertCreate(Math.cos(a), Math.sin(a), 0))
        top.push(bm.vertCreate(Math.cos(a), Math.sin(a), 1))
    }
    const sides = []
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        sides.push(bm.faceCreate([bottom[i], bottom[j], top[j], top[i]]))
    }
    const cap = bm.faceCreate([...top].reverse())
    return {bottom, top, sides, cap}
}

describe('joinVertKillEdge', () => {
    it('shortens a quad into a triangle', () => {
        const bm = new BMesh()
        const {v, f} = quad(bm)
        const e = diskEdgeExists(v[0], v[1])!

        const survivor = joinVertKillEdge(bm, e, v[1], true, true, true)

        expect(survivor).toBe(v[0])
        expect(bm.verts.has(v[1])).toBe(false)
        expect(bm.faces.has(f)).toBe(true)
        expect(f.len).toBe(3)
        expect([...f.eachLoop()].map(l => l.v)).toEqual([v[0], v[2], v[3]])
        expect(bm.totvert).toBe(3)
        expect(bm.totedge).toBe(3)
        expect(bm.validate()).toEqual([])
    })

    it('kills a face that falls below three corners, when asked', () => {
        const bm = new BMesh()
        const {v, f} = tri(bm)
        const e = diskEdgeExists(v[0], v[1])!

        joinVertKillEdge(bm, e, v[1], true, true, true)

        expect(bm.faces.has(f)).toBe(false)
        expect(bm.totvert).toBe(2)
        expect(bm.totedge).toBe(1) // the two edges that ended up spanning the same pair were spliced
        expect(bm.validate()).toEqual([])
    })

    it('leaves the degenerate face alone when not asked to kill it', () => {
        // Blender's `kill_degenerate_faces` is a caller's choice, not a repair: off, you get a
        // two-corner face, which is consistent topology even though nothing will draw it.
        const bm = new BMesh()
        const {v, f} = tri(bm)
        const e = diskEdgeExists(v[0], v[1])!

        joinVertKillEdge(bm, e, v[1], true, true, false)

        expect(bm.faces.has(f)).toBe(true)
        expect(f.len).toBe(2)
        expect(bm.validate()).toEqual([])
    })

    it('splices the double the merge creates only when checkEdgeExists is set', () => {
        for (const check of [true, false]) {
            const bm = new BMesh()
            const {v} = tri(bm)
            const e = diskEdgeExists(v[0], v[1])!

            joinVertKillEdge(bm, e, v[1], true, check, true)

            // Both ends of `v1 -> v2` land on `v0`, so `v1 -> v2` and `v0 -> v2` coincide.
            expect(bm.totedge).toBe(check ? 1 : 2)
            expect(bm.validate()).toEqual([])
        }
    })

    it('keeps the killed vertex when doDel is off', () => {
        const bm = new BMesh()
        const {v} = quad(bm)
        const e = diskEdgeExists(v[0], v[1])!

        joinVertKillEdge(bm, e, v[1], false, true, true)

        expect(bm.verts.has(v[1])).toBe(true)
        expect(v[1].e).toBeNull() // loose, with everything it used moved onto the survivor
        expect(bm.totvert).toBe(4)
        expect(bm.validate()).toEqual([])
    })
})

describe('edgeCollapse', () => {
    it('is joinVertKillEdge with the double check on', () => {
        const bm = new BMesh()
        const {v} = tri(bm)
        const e = diskEdgeExists(v[0], v[1])!
        edgeCollapse(bm, e, v[1], true, true)
        expect(bm.totedge).toBe(1)
        expect(bm.validate()).toEqual([])
    })

    it('brings a capped tube down to a cone, which is what the cone primitive uses it for', () => {
        // `bmo_create_cone_exec` builds a cylinder and collapses the top rim one edge at a time
        // (`bmo_primitive.cc:1485`). Each collapse turns one side quad into a triangle and takes one
        // corner off the cap; the cap is what is left when the rim is a single point.
        const n = 6
        const bm = new BMesh()
        const {bottom, top, sides, cap} = cappedTube(bm, n)

        let apex = top[0]
        for (let i = 1; i < n; i++) {
            apex = edgeCollapse(bm, diskEdgeExists(apex, top[i])!, top[i], true, true)
        }

        expect(bm.verts.has(apex)).toBe(true)
        expect(bm.totvert).toBe(n + 1) // the rim, plus the apex
        expect(bm.totedge).toBe(n + n) // the base ring, plus one edge per side triangle
        // Every side face is now a triangle meeting at the apex, and the cap has collapsed away.
        expect(bm.faces.has(cap)).toBe(false)
        for (const f of sides) {
            expect(bm.faces.has(f)).toBe(true)
            expect(f.len).toBe(3)
            expect([...f.eachLoop()].some(l => l.v === apex)).toBe(true)
        }
        for (let i = 0; i < n; i++) {
            expect(edgeFaceCount(diskEdgeExists(bottom[i], bottom[(i + 1) % n])!)).toBe(1)
            expect(edgeFaceCount(diskEdgeExists(bottom[i], apex)!)).toBe(2)
        }
        expect(bm.validate()).toEqual([])
    })
})
