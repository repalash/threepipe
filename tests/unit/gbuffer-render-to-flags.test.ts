/**
 * `userData.renderToFlags`: a material that is not drawn into the GBuffer (like the helper widgets) can still write the
 * GBuffer flags of its pixels, without depth and normal. No WebGL: the pass decides which materials draw only their
 * flags, the GBufferMaterial switches the draw buffers to the flags texture for them, and the render puts them alone in
 * the transparent pass of the GBuffer render.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'

let tp: any

// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000

beforeAll(async() => {
    tp = await import('threepipe')
}, timeout)

/** GBufferPlugin with the parts of a viewer that `_createPass` uses. WebGL2: a target with the flags texture. */
function plugin(webgl2 = true) {
    const p = new tp.GBufferPlugin()
    p._viewer = {
        setDirty: () => undefined,
        renderManager: {
            isWebGL2: webgl2,
            zPrepass: false,
            createTarget: (o: any) => new tp.WebGLRenderTarget(1, 1, {count: o.textureCount}),
            disposeTarget: () => undefined,
            screenPass: {material: {registerMaterialExtensions: () => undefined}},
        },
    }
    const pass = p._createPass()
    return {p, pass}
}

const overlay = (userData: any = {renderToGBuffer: false, renderToDepth: false, renderToFlags: true}, params: any = {}) =>
    Object.assign(new tp.MeshBasicMaterial({transparent: true, toneMapped: false, depthWrite: false, ...params}), {userData: {...userData}})

/** Whether the GBuffer pass draws the material only for its flags */
function flagsOnly(pass: any, material: any) {
    pass.preprocessMaterial(material)
    const r = pass.flagsOnlyMaterials.has(material)
    // never in the opaque list, the one that writes depth and normal
    if (r) expect(material.transparent && !material.transmission).toBe(true)
    return r
}

describe('GBufferRenderPass: which materials draw only their flags', {timeout}, () => {
    test('renderToGBuffer false and renderToFlags true: flags only, left out of the depth and normal', () => {
        const {pass} = plugin()
        expect(pass.renderFlagsOnly).toBe(true)
        expect(flagsOnly(pass, overlay())).toBe(true)
        // an opaque one too: it is made transparent for the render
        expect(flagsOnly(pass, overlay(undefined, {transparent: false}))).toBe(true)
    })
    test('not set: same as renderToGBuffer, nothing changes', () => {
        const {pass} = plugin()
        expect(flagsOnly(pass, overlay({renderToGBuffer: false, renderToDepth: false}))).toBe(false)
        expect(flagsOnly(pass, overlay({renderToFlags: false, renderToGBuffer: false}))).toBe(false)
        // drawn into the GBuffer: writes the flags in the same draw
        const drawn = overlay({renderToFlags: true}, {transparent: false})
        expect(flagsOnly(pass, drawn)).toBe(false)
        expect(drawn.transparent).toBe(false)
    })
    test('not for materials that draw with their own shader, with plugins disabled, or without a flags texture', () => {
        const {pass} = plugin()
        // allowOverride false: the GBufferMaterial does not draw it, its own shader would write color into depth and normal
        expect(flagsOnly(pass, overlay(undefined, {allowOverride: false}))).toBe(false)
        expect(flagsOnly(pass, overlay({renderToGBuffer: false, renderToFlags: true, pluginsDisabled: true}))).toBe(false)
        // WebGL1: one target, no flags
        const gl1 = plugin(false).pass
        expect(gl1.renderFlagsOnly).toBe(false)
        expect(flagsOnly(gl1, overlay())).toBe(false)
    })
    test('fat lines (the helper widgets) draw with their GBuffer line material, with the flag updaters of the plugin', () => {
        const {p, pass} = plugin()
        const line = new tp.LineSegments2(new tp.LineSegmentsGeometry(), new tp.LineMaterial2({transparent: true, toneMapped: false, allowOverride: false}))
        tp.iObjectCommons.upgradeObject3D.call(line)
        line.material.userData.renderToGBuffer = false
        line.material.userData.renderToFlags = true
        const mat = pass.preprocessObject(line)
        expect(mat).toBe(line.customGBufferMaterial)
        expect(mat.userData.renderToFlags).toBe(true)
        expect(mat.flagUpdaters).toBe(p.material.flagUpdaters)
        expect(mat.flagsOnlyMaterials).toBe(pass.flagsOnlyMaterials)
        expect(flagsOnly(pass, mat)).toBe(true)
        pass.postprocessObject(line)
    })
})

describe('GBufferRenderPass.render', {timeout}, () => {
    function renderOnce(pass: any, scene: any, materials: any[]) {
        const states: any[] = []
        const renderer = {
            getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: () => undefined,
            renderWithModes: (modes: any) => states.push({
                modes,
                materials: materials.map(m => ({visible: m.visible, transparent: m.transparent})),
                flagsOnly: [...pass.flagsOnlyMaterials],
            }),
        }
        pass.scene = scene
        pass.camera = new tp.PerspectiveCamera()
        pass.render(renderer)
        expect(states.length).toBe(1)
        return states[0]
    }
    const mesh = (m: any) => new tp.Mesh(new tp.BoxGeometry(), m)

    test('the flags-only materials are drawn alone in the transparent pass, after the GBuffer', () => {
        const {pass} = plugin()
        const ov = overlay()
        const glass = Object.assign(new tp.MeshBasicMaterial({transparent: true, opacity: 0.5, map: new tp.Texture()}), {userData: {}})
        const solid = Object.assign(new tp.MeshBasicMaterial(), {userData: {}})
        const scene = new tp.Scene()
        scene.add(mesh(ov), mesh(glass), mesh(solid))
        const s = renderOnce(pass, scene, [ov, glass, solid])
        expect(s.modes.opaqueRender).toBe(true)
        expect(s.modes.transparentRender).toBe(true)
        expect(s.flagsOnly).toEqual([ov])
        expect(s.materials).toEqual([
            {visible: true, transparent: true}, // the overlay: flags only
            {visible: false, transparent: true}, // the other materials left out: not drawn at all
            {visible: true, transparent: false}, // in the GBuffer
        ])
        // all put back
        expect([ov.visible, glass.visible, solid.visible]).toEqual([true, true, true])
        expect([ov.transparent, glass.transparent, solid.transparent]).toEqual([true, true, false])
        expect(pass.flagsOnlyMaterials.size).toBe(0)
    })
    test('without flags-only materials, the render is the same as before', () => {
        const {pass} = plugin()
        const glass = Object.assign(new tp.MeshBasicMaterial({transparent: true, opacity: 0.5, map: new tp.Texture()}), {userData: {}})
        const scene = new tp.Scene()
        scene.add(mesh(glass), mesh(overlay({renderToGBuffer: false})))
        const s = renderOnce(pass, scene, [glass])
        expect(s.modes.transparentRender).toBe(false)
        expect(s.materials).toEqual([{visible: true, transparent: true}])
    })
    test('a material shared by two objects is prepared the same for both, and put back as it was', () => {
        const {pass} = plugin()
        const shared = Object.assign(new tp.MeshBasicMaterial(), {userData: {renderToGBuffer: false}})
        const sharedOverlay = overlay(undefined, {transparent: false})
        const scene = new tp.Scene()
        scene.add(mesh(shared), mesh(shared), mesh(sharedOverlay), mesh(sharedOverlay))
        const s = renderOnce(pass, scene, [shared, sharedOverlay])
        expect(s.flagsOnly).toEqual([sharedOverlay])
        expect(s.materials).toEqual([
            {visible: false, transparent: true}, // left out of the GBuffer
            {visible: true, transparent: true}, // flags only
        ])
        expect([shared.transparent, sharedOverlay.transparent]).toEqual([false, false])
    })
})

describe('GBufferMaterial: a flags-only draw', {timeout}, () => {
    const gl = {NONE: 0, COLOR_ATTACHMENT0: 0x8CE0, COLOR_ATTACHMENT1: 0x8CE1, drawBuffers: vi.fn()}
    const renderer = {
        getContext: () => gl,
        getRenderTarget: () => ({textures: [{}, {}]}),
        materials: {refreshTransformUniform: () => undefined},
    }
    const camera = {updateShaderProperties: () => undefined}
    function draw(mat: any, object: any) {
        mat.onBeforeRender(renderer, null, camera, object.geometry, object, null)
        const state = {depthWrite: mat.depthWrite, depthTest: mat.depthTest, drawBuffers: gl.drawBuffers.mock.calls.at(-1)?.[0]}
        mat.onAfterRender(renderer, null, camera, object.geometry, object, null)
        return state
    }

    test('writes only the flags texture, without depth write, with the depth test of the material', () => {
        gl.drawBuffers.mockClear()
        const mat = new tp.GBufferMaterial(true)
        mat.flagsOnlyMaterials = new Set()
        const ov = overlay(undefined, {depthTest: false})
        mat.flagsOnlyMaterials.add(ov)
        const s = draw(mat, new tp.Mesh(new tp.BoxGeometry(), ov))
        expect(s).toEqual({depthWrite: false, depthTest: false, drawBuffers: [gl.NONE, gl.COLOR_ATTACHMENT1]})
        // put back for the next draw: all the attachments, as three.js set them
        expect(gl.drawBuffers.mock.calls.at(-1)[0]).toEqual([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
        expect([mat.depthWrite, mat.depthTest]).toEqual([true, true])
    })
    test('other materials, and a material without multiple targets (WebGL1), draw as before', () => {
        gl.drawBuffers.mockClear()
        const mat = new tp.GBufferMaterial(true)
        mat.flagsOnlyMaterials = new Set()
        expect(draw(mat, new tp.Mesh(new tp.BoxGeometry(), overlay(undefined, {depthTest: false}))))
            .toEqual({depthWrite: true, depthTest: true, drawBuffers: undefined})
        const gl1 = new tp.GBufferMaterial(false)
        const ov = overlay()
        gl1.flagsOnlyMaterials = new Set([ov])
        expect(draw(gl1, new tp.Mesh(new tp.BoxGeometry(), ov))).toEqual({depthWrite: true, depthTest: true, drawBuffers: undefined})
    })
})

describe('Helper widgets write their flags', {timeout}, () => {
    test('the line materials of the widgets have renderToFlags (and are left out of depth and normal)', () => {
        const widgets = [
            new tp.BoxSelectionWidget(),
            new tp.DirectionalLightHelper2(new tp.DirectionalLight2()),
            new tp.PointLightHelper2(new tp.PointLight2()),
            new tp.SpotLightHelper2(new tp.SpotLight2()),
            new tp.CameraHelper2(new tp.PerspectiveCamera()),
            new tp.SkeletonHelper2(new tp.Object3D()),
            new tp.BoneHelper(new tp.Bone()),
        ]
        for (const w of widgets) {
            const mats: any[] = []
            w.traverse((o: any) => o.material && mats.push(o.material))
            expect(mats.length, w.constructor.name).toBeGreaterThan(0)
            for (const m of mats) {
                expect(m.userData.renderToGBuffer, w.constructor.name).toBe(false)
                expect(m.userData.renderToFlags, w.constructor.name).toBe(true)
                expect(m.toneMapped, w.constructor.name).toBe(false)
            }
        }
    })
})
