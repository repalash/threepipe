import {describe, expect, it} from 'vitest'
import {Object3D, PhysicalMaterial} from 'threepipe'
import {ModellingPlugin} from '../src/ModellingPlugin'

/**
 * Undo and redo must give back exactly the document they recorded - the edit-chain harness
 * (`demos/edit-chain`) checks that after every step, and these are the three ways it found them not to:
 *
 * - a mutating command that changed nothing left no undo step, so the next `undo` reverted the command
 *   before it (`issues/open/modelling-tools/chain-noop-command-no-undo-step.md`);
 * - undo of `material` restored the colour and nothing else (`chain-material-undo-colour-only.md`);
 * - redo rebuilt a rotated object from Euler angles, which is not bit-exact
 *   (`chain-redo-rotation-not-exact.md`).
 *
 * The plugin runs against the smallest viewer its commands touch: a scene to add objects to and the
 * hooks `onAdded` registers with. Everything here is document and history, no rendering.
 */
function makePlugin(): ModellingPlugin {
    const root = new Object3D()
    const viewer = {
        scene: {modelRoot: root, addObject: (o: Object3D) => root.add(o)},
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        forPlugin: () => undefined,
        assetManager: {registerGltfExtension: () => undefined, unregisterGltfExtension: () => undefined},
        setDirty: () => undefined,
        getPlugin: () => undefined,
    }
    const plugin = new ModellingPlugin()
    plugin.onAdded(viewer as never)
    return plugin
}

async function must(plugin: ModellingPlugin, command: Record<string, unknown>) {
    const result = await plugin.run(command as never)
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    return result
}

describe('a command that changes nothing', () => {
    it('reports changed: false and pushes no undo step', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        const depth = m.history.entries.length

        for (const command of [
            {op: 'weld', object: 'c', distance: 1e-6},
            {op: 'mergeByDistance', object: 'c', verts: [0, 1, 2, 3, 4, 5, 6, 7], threshold: 1e-6},
            {op: 'modifier', object: 'c'},
            // The colour it already has.
            {op: 'material', object: 'c', color: '#b7bcc4'},
            {op: 'transform', object: 'c', move: [0, 0, 0]},
            {op: 'transform', object: 'c', verts: [0], move: [0, 0, 0]},
        ]) {
            const r = await must(m, command)
            expect(r.changed, command.op).toBe(false)
            expect(m.history.entries.length, command.op).toBe(depth)
        }
    })

    it('reports changed: false for a bevel Blender declines (a boundary edge)', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'grid', name: 'g', xSegments: 2, ySegments: 2})
        const depth = m.history.entries.length
        const r = await must(m, {op: 'bevel', object: 'g', edges: [0], segments: 3})
        expect(r.changed).toBe(false)
        expect(m.history.entries.length).toBe(depth)
        // ...so undo still undoes the command that did change something: the grid itself.
        await must(m, {op: 'undo'})
        expect(m.document.find('g')).toBeUndefined()
    })

    it('reports a declined bevel\'s new faces as an empty list, the shape a bevel that works returns', async() => {
        // The editor reselects `data.newFaces`; a count of 0 here made it throw "indices is not iterable"
        // while a bevel width was being typed (0, 0.1, 0.15) in the house-walkthrough demo.
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'grid', name: 'g', xSegments: 2, ySegments: 2})
        const declined = await must(m, {op: 'bevel', object: 'g', edges: [0], segments: 3})
        expect(declined.data?.newFaces).toEqual([])
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        const beveled = await must(m, {op: 'bevel', object: 'c', edges: [0], offset: 0.1})
        expect(Array.isArray(beveled.data?.newFaces)).toBe(true)
        expect((beveled.data?.newFaces as number[]).length).toBeGreaterThan(0)
    })

    it('reports changed: true, and pushes a step, when it does change something', async() => {
        const m = makePlugin()
        const created = await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        expect(created.changed).toBe(true)
        const depth = m.history.entries.length
        const moved = await must(m, {op: 'transform', object: 'c', verts: [0], move: [0, 0.1, 0]})
        expect(moved.changed).toBe(true)
        expect(m.history.entries.length).toBe(depth + 1)
    })

    it('leaves `changed` off read-only commands', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        expect((await must(m, {op: 'inspect', object: 'c'})).changed).toBeUndefined()
    })
})

describe('undo of material', () => {
    it('restores every property the command set, and redo sets them again', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        const mat = m.document.find('c')!.object.material as PhysicalMaterial
        const before = {
            color: mat.color.getHex(), metalness: mat.metalness, roughness: mat.roughness, opacity: mat.opacity,
            transparent: mat.transparent, flatShading: mat.flatShading, wireframe: mat.wireframe,
        }
        await must(m, {op: 'material', object: 'c', color: '#3a3a40', metalness: 0.9, roughness: 0.1,
            opacity: 0.5, flatShading: true, wireframe: true})
        const after = {
            color: mat.color.getHex(), metalness: mat.metalness, roughness: mat.roughness, opacity: mat.opacity,
            transparent: mat.transparent, flatShading: mat.flatShading, wireframe: mat.wireframe,
        }
        expect(after).toEqual({color: 0x3a3a40, metalness: 0.9, roughness: 0.1, opacity: 0.5,
            transparent: true, flatShading: true, wireframe: true})

        const read = () => {
            const x = m.document.find('c')!.object.material as PhysicalMaterial
            return {color: x.color.getHex(), metalness: x.metalness, roughness: x.roughness, opacity: x.opacity,
                transparent: x.transparent, flatShading: x.flatShading, wireframe: x.wireframe}
        }
        await must(m, {op: 'undo'})
        expect(read()).toEqual(before)
        await must(m, {op: 'redo'})
        expect(read()).toEqual(after)
    })

    it('brings a deleted object back with its whole material', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        await must(m, {op: 'material', object: 'c', metalness: 0.8, roughness: 0.2, opacity: 0.4})
        await must(m, {op: 'delete', object: 'c'})
        await must(m, {op: 'undo'})
        const x = m.document.find('c')!.object.material as PhysicalMaterial
        expect([x.metalness, x.roughness, x.opacity, x.transparent]).toEqual([0.8, 0.2, 0.4, true])
    })
})

describe('redo of a rotated object', () => {
    it('restores the exact quaternion the command set (array into objects, radial)', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'link', position: [2, 0, -2]})
        await must(m, {op: 'array', object: 'link', count: 3, angle: Math.PI * 2, pivot: [2, 0, -1],
            into: 'objects', name: 'link-r'})
        const quats = () => ['link-r', 'link-r.001'].map(n => m.document.find(n)!.object.quaternion.toArray())
        const set = quats()
        // 120 and 240 degrees: the angles where an Euler round trip lands on -q.
        await must(m, {op: 'undo'})
        await must(m, {op: 'redo'})
        expect(quats()).toEqual(set)
    })

    it('restores the exact quaternion on undo of an object rotation', async() => {
        const m = makePlugin()
        await must(m, {op: 'primitive', type: 'cube', name: 'c'})
        await must(m, {op: 'transform', object: 'c', rotate: [0.3, 2.2, -1.1]})
        const first = m.document.find('c')!.object.quaternion.toArray()
        await must(m, {op: 'transform', object: 'c', angle: 2.1, axis: 'x'})
        const second = m.document.find('c')!.object.quaternion.toArray()
        await must(m, {op: 'undo'})
        expect(m.document.find('c')!.object.quaternion.toArray()).toEqual(first)
        await must(m, {op: 'redo'})
        expect(m.document.find('c')!.object.quaternion.toArray()).toEqual(second)
    })
})
