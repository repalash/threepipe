/**
 * GBufferPlugin material variants: which objects the G-buffer pass draws with a per-material GBufferMaterial variant,
 * that the variants are reused and kept stable (no program rebuild per draw), and that the objects get their own
 * material back after the pass. No WebGL: the pass's per-object hooks and the material's onBeforeRender are called
 * directly, with the parts of a renderer they use.
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    // through the package entry: importing the plugin module alone runs into an import cycle
    tp = await import('../../index')
}, timeout)

/** The plugin with the parts of a viewer that `_createPass` and `createMaterial` use. */
function plugin() {
    const p = new tp.GBufferPlugin()
    const viewer = {dirty: 0, setDirty() { this.dirty++ }, console, addEventListener: () => undefined, removeEventListener: () => undefined, getPlugin: () => undefined, renderManager: {isWebGL2: true, createTarget: () => new tp.WebGLRenderTarget(1, 1), disposeTarget: () => undefined, screenPass: {material: {registerMaterialExtensions: () => undefined, unregisterMaterialExtensions: () => undefined}}}}
    p._viewer = viewer
    return {p, pass: p._createPass()}
}

/** A mesh upgraded as threepipe does for the objects of a scene (its `material` follows `forcedOverrideMaterial`). */
const mesh = (material: any) => {
    const o = new tp.Mesh(new tp.BoxGeometry(1, 1, 1), material)
    tp.iObjectCommons.upgradeObject3D.call(o)
    return o
}
const opaque = (params: any = {}, userData: any = {}) => Object.assign(new tp.PhysicalMaterial(params), {userData: {...userData}})

/** Draws the object with the material the pass gave it, as three.js does (onBeforeRender, then onAfterRender). */
function draw(object: any) {
    const m = object.material
    const renderer = {materials: {refreshTransformUniform: () => undefined}, resetCurrentMaterial: () => undefined, getRenderTarget: () => null}
    const camera = new tp.PerspectiveCamera2()
    m.onBeforeRender(renderer, new tp.Scene(), camera, object.geometry, object, null)
    m.onAfterRender(renderer, new tp.Scene(), camera, object.geometry, object, null)
    return m
}

describe('GBufferPlugin.materialVariants', {timeout}, () => {
    test('an opaque mesh is drawn with a variant, reused for the same kind of material', () => {
        const {p, pass} = plugin()
        const a = mesh(opaque()), b = mesh(opaque({color: 0xff0000})), c = mesh(opaque({normalMap: new tp.Texture()}))
        const va = pass.preprocessObject(a), vb = pass.preprocessObject(b), vc = pass.preprocessObject(c)
        expect(va.isGBufferMaterial).toBe(true)
        expect(va.stableSource).toBe(true)
        expect(va.allowOverride).toBe(false)
        expect(va.transparent).toBe(false)
        expect(a.forcedOverrideMaterial).toBe(va)
        // the colour is no input of the G-buffer program: the same variant
        expect(vb).toBe(va)
        // a normal map is: another one
        expect(vc).not.toBe(va)
        expect(vc.flagUpdaters).toBe(p.material.flagUpdaters)
    })

    test('the object gets its own material back after the pass', () => {
        const {pass} = plugin()
        const m = opaque(), o = mesh(m)
        pass.preprocessObject(o)
        expect(o.material).not.toBe(m)
        pass.postprocessObject(o)
        expect(o.forcedOverrideMaterial).toBeUndefined()
        expect(o.material).toBe(m)
    })

    test('the shared material for what a variant cannot draw', () => {
        const {pass} = plugin()
        const cases = [
            mesh(opaque({transparent: true, opacity: 0.5})),
            mesh(opaque({transmission: 1})),
            mesh(opaque({}, {pluginsDisabled: true})),
            mesh(opaque({}, {renderToGBuffer: false})),
            mesh(opaque({}, {renderToDepth: false})),
            mesh([opaque(), opaque()]),
            // not upgraded: a plain three.js mesh does not draw a forced material
            new tp.Mesh(new tp.BoxGeometry(1, 1, 1), opaque()),
        ]
        for (const o of cases) {
            const m = o.material
            expect(pass.preprocessObject(o)).toBe(m)
            expect(o.forcedOverrideMaterial).toBeUndefined()
        }
        // an object whose material is forced by something else keeps it
        const forced = mesh(opaque()), other = opaque()
        forced.forcedOverrideMaterial = other
        expect(pass.preprocessObject(forced)).toBe(other)
        expect(forced.forcedOverrideMaterial).toBe(other)
    })

    test('off: every object uses the shared material, as before', () => {
        const {p, pass} = plugin()
        p.materialVariants = false
        const o = mesh(opaque())
        expect(pass.preprocessObject(o)).toBe(o.material)
        expect(o.forcedOverrideMaterial).toBeUndefined()
    })

    test('a variant keeps its version over many draws; the shared material bumps it on every draw', () => {
        const {p, pass} = plugin()
        const objects = [mesh(opaque()), mesh(opaque({color: 0x00ff00})), mesh(opaque({roughness: 0.2}))]
        const v = pass.preprocessObject(objects[0])
        for (const o of objects.slice(1)) pass.preprocessObject(o)
        draw(objects[0])
        const version = v.version
        for (let i = 0; i < 10; i++) for (const o of objects) draw(o)
        expect(v.version).toBe(version)
        for (const o of objects) pass.postprocessObject(o)

        // the shared material, set on the object as the pass's override would draw it
        p.materialVariants = false
        const shared = p.material, o = mesh(opaque())
        const before = shared.version
        for (let i = 0; i < 5; i++) {
            shared.onBeforeRender({materials: {refreshTransformUniform: () => undefined}, resetCurrentMaterial: () => undefined}, new tp.Scene(), new tp.PerspectiveCamera2(), o.geometry, o, null)
            shared.onAfterRender({}, new tp.Scene(), new tp.PerspectiveCamera2(), o.geometry, o, null)
        }
        expect(shared.version - before).toBeGreaterThanOrEqual(5)
    })

    test('a variant draws the source material in full (normal map, side, alpha test)', () => {
        const {pass} = plugin()
        const normalMap = new tp.Texture()
        const o = mesh(opaque({normalMap, side: tp.FrontSide, alphaTest: 0.5}))
        const v = pass.preprocessObject(o)
        const renderer = {materials: {refreshTransformUniform: () => undefined}, resetCurrentMaterial: () => undefined, getRenderTarget: () => null}
        v.onBeforeRender(renderer, new tp.Scene(), new tp.PerspectiveCamera2(), o.geometry, o, null)
        expect(v.uniforms.normalMap.value).toBe(normalMap)
        expect(v.side).toBe(tp.FrontSide)
        expect(v.uniforms.alphaTest.value).toBe(0.5)
    })

    test('a new extension on the shared material drops the variants; removing the plugin disposes them', () => {
        const {p, pass} = plugin()
        const o = mesh(opaque())
        const v1 = pass.preprocessObject(o)
        pass.postprocessObject(o)
        let disposed = 0
        v1.addEventListener('dispose', () => disposed++)
        p.material.registerMaterialExtensions([{uuid: 'test-ext', isCompatible: () => true}])
        const v2 = pass.preprocessObject(o)
        expect(v2).not.toBe(v1)
        expect(disposed).toBe(1)
        expect(v2.materialExtensions.some((e: any) => e.uuid === 'test-ext')).toBe(true)
        pass.postprocessObject(o)
        let disposed2 = 0
        v2.addEventListener('dispose', () => disposed2++)
        p.onRemove(p._viewer)
        expect(disposed2).toBe(1)
    })
})
