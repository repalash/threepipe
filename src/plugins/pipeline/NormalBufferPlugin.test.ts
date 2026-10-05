/**
 * NormalBufferPlugin unit tests: which materials the normal pass renders, with and without
 * `renderTransparent`. No WebGL: the pass's `preprocessMaterial` marks a material it renders as
 * opaque (transparent = false, transmission = 0) and one it leaves out as transparent, and
 * GBufferRenderPass renders the opaque list only.
 */
import {beforeAll, describe, expect, test} from 'vitest'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    // through the package entry: importing the plugin module alone runs into an import cycle
    tp = await import('../../index')
}, timeout)

/** The plugin with the parts of a viewer that `_createPass` uses. */
function plugin(renderTransparent?: boolean) {
    const p = new tp.NormalBufferPlugin()
    if (renderTransparent !== undefined) p.renderTransparent = renderTransparent
    const viewer = {dirty: 0, setDirty() { this.dirty++ }, renderManager: {createTarget: () => new tp.WebGLRenderTarget(1, 1), disposeTarget: () => undefined}}
    p._viewer = viewer
    return {p, viewer, pass: p._createPass()}
}

/** Whether the normal pass renders the material (it ends up in the opaque list). */
function rendered(pass: any, material: any) {
    pass.preprocessMaterial(material)
    return !material.transparent && !material.transmission
}

const transparent = (userData: any = {}) => Object.assign(new tp.PhysicalMaterial({transparent: true, opacity: 0.75, map: new tp.Texture()}), {userData: {...userData}})
const transmissive = (userData: any = {}) => Object.assign(new tp.PhysicalMaterial({transmission: 1}), {userData: {...userData}})
const opaque = (userData: any = {}) => Object.assign(new tp.PhysicalMaterial(), {userData: {...userData}})

describe('NormalBufferPlugin.renderTransparent', {timeout}, () => {
    test('defaults to true, is serialized and has a UI toggle', () => {
        const {p} = plugin()
        expect(p.renderTransparent).toBe(true)
        expect(p.toJSON().renderTransparent).toBe(true)
        p.renderTransparent = false
        expect(p.toJSON().renderTransparent).toBe(false)
        const other = new tp.NormalBufferPlugin()
        other.fromJSON({type: 'NormalBufferPlugin', renderTransparent: false})
        expect(other.renderTransparent).toBe(false)
        const labels = JSON.stringify(p.uiConfig?.children?.map((c: any) => typeof c === 'function' ? c() : c)?.flat(3).map((c: any) => c?.label))
        expect(labels).toContain('Render Transparent')
    })

    test('true (default): transparent and transmissive materials are rendered, as before', () => {
        const {pass} = plugin()
        expect(rendered(pass, transparent())).toBe(true)
        expect(rendered(pass, transmissive())).toBe(true)
        expect(rendered(pass, opaque())).toBe(true)
        expect(rendered(pass, opaque({renderToDepth: false}))).toBe(true)
    })

    test('false: the rule of GBufferPlugin, with the userData overrides', () => {
        const {pass} = plugin(false)
        expect(rendered(pass, transparent())).toBe(false)
        expect(rendered(pass, transmissive())).toBe(false)
        expect(rendered(pass, opaque())).toBe(true)
        // per-material overrides: renderToDepth first, then renderToGBuffer
        expect(rendered(pass, transparent({renderToDepth: true}))).toBe(true)
        expect(rendered(pass, transparent({renderToGBuffer: true}))).toBe(true)
        expect(rendered(pass, transparent({renderToDepth: false, renderToGBuffer: true}))).toBe(false)
        expect(rendered(pass, transmissive({renderToDepth: true}))).toBe(true)
        expect(rendered(pass, opaque({renderToDepth: false}))).toBe(false)
        // a transparent material that draws as opaque (no maps, opacity 1) stays in, as in the GBuffer
        expect(rendered(pass, Object.assign(new tp.PhysicalMaterial({transparent: true, opacity: 1}), {userData: {}}))).toBe(true)
    })

    test('takes effect on the next render, without recreating the pass, and asks for one', () => {
        const {p, viewer, pass} = plugin()
        expect(rendered(pass, transparent())).toBe(true)
        const dirty = viewer.dirty
        p.renderTransparent = false
        expect(viewer.dirty).toBe(dirty + 1)
        expect(rendered(pass, transparent())).toBe(false)
    })
})
