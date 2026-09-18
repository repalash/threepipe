import {describe, expect, it} from 'vitest'
import {
    arrayLinear,
    bakeGeometry,
    bmFromMesh,
    bmToMesh,
    primitiveCone,
    primitiveLathe,
    primitiveSweep,
} from '@threepipe/mesh-kernel'
import {evaluateModifiers} from '../src/modifiers'
import {CommandRegistry} from '../src/commands/registry'
import {createCommands} from '../src/commands/create'
import {editCommands} from '../src/commands/edit'
import {validateParams} from '../src/commands/types'

/**
 * What actually runs without a browser, pinned.
 *
 * The geometry half of this package is `@threepipe/mesh-kernel`, which has no dependencies and no
 * browser API, so a build can be generated in Node with no viewport at all. The *command* half needs
 * a `ThreeViewer`, and a viewer needs a DOM and a WebGL context - stubbing `getComputedStyle` gets
 * you as far as `tabIndex` on a parent element that is not there, and a real WebGL context after
 * that. Running the commands headlessly means a headless browser, which is what
 * `scripts/modelling-session.mjs` uses.
 *
 * This test exists so that distinction stays true rather than drifting into a claim in a README.
 */
describe('what runs in node without a viewer', () => {
    it('generates geometry through the kernel, which is what a command does underneath', () => {
        // The same three generators the `primitive`, `lathe` and `sweep` commands call.
        const cylinder = primitiveCone({segments: 16, radiusTop: 0.5, radiusBottom: 0.5, depth: 1})
        expect(cylinder.facesNum).toBe(18)
        expect(cylinder.validate()).toEqual([])

        const wheel = primitiveLathe({
            profile: [[0, -0.08], [0.28, -0.08], [0.32, -0.04], [0.32, 0.04], [0.28, 0.08], [0, 0.08]],
            axis: [1, 0, 0], segments: 12,
        })
        expect(wheel.validate()).toEqual([])

        const rail = primitiveSweep({
            path: [[0, 0, 0], [0, 0.2, 1], [0, 0.2, 2], [0, 0, 3]], radius: 0.02, steps: 6,
        })
        expect(rail.validate()).toEqual([])
    })

    it('runs operators and bakes render buffers', () => {
        const bm = bmFromMesh(primitiveCone({segments: 8, radiusTop: 0.5, radiusBottom: 0.5, depth: 1}))
        arrayLinear(bm, {verts: [...bm.verts], edges: [...bm.edges], faces: [...bm.faces]},
            {count: 3, step: [2, 0, 0]})
        const mesh = bmToMesh(bm)
        expect(mesh.validate()).toEqual([])

        const {data, triangleToFace} = bakeGeometry(mesh, {includeNormals: true})
        expect(data.position.length).toBeGreaterThan(0)
        expect(data.index.length % 3).toBe(0)
        expect(triangleToFace.length).toBe(data.index.length / 3)
    })

    it('evaluates a modifier stack', () => {
        const master = primitiveCone({segments: 8, radiusTop: 0.5, radiusBottom: 0.5, depth: 1})
        const evaluated = evaluateModifiers(master, [
            {type: 'array', mode: 'linear', count: 4, step: [2, 0, 0], merge: false},
        ])
        expect(evaluated.facesNum).toBe(master.facesNum * 4)
        expect(evaluated.validate()).toEqual([])
    })

    it('describes and validates commands, which needs no viewer either', () => {
        const registry = new CommandRegistry()
        registry.registerAll([...createCommands, ...editCommands])

        const described = registry.describe()
        expect(described.length).toBeGreaterThan(5)
        for (const d of described) expect((d.inputSchema as {type: string}).type).toBe('object')

        const lathe = registry.get('lathe')!
        expect(validateParams(lathe, {profile: [[0, 0], [1, 0]]})).toEqual([])
        expect(validateParams(lathe, {})[0]).toContain('missing required parameter "profile"')
    })
})
