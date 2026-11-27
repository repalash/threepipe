/**
 * ShadowMapBaker of @threepipe/webgi-plugins: the state restore of files saved with shadowMapType (no longer saved or
 * used), the caster materials of its own depth pass (depth materials on the shadow casters, hidden on the rest, the
 * scene materials put back without a version change), the light positions of each frame, and the disposal of its
 * targets and materials. No WebGL: the renderer is a stand-in that records what each render would draw.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'
import {
    BackSide,
    BoxGeometry,
    DoubleSide,
    FrontSide,
    Material,
    Mesh,
    MeshBasicMaterial,
    MeshDepthMaterial,
    PCFShadowMap,
    PCFSoftShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    Sprite,
    Texture,
    VSMShadowMap,
    WebGLRenderTarget,
} from 'three'

let tp: typeof import('threepipe')
let ShadowMapBaker: typeof import('../../plugins/webgi-plugins/src/utils/ShadowMapBaker').ShadowMapBaker
// a cold import of the package entry can take longer than the default 10 s hook timeout
beforeAll(async() => {
    tp = await import('threepipe')
    ShadowMapBaker = (await import('../../plugins/webgi-plugins/src/utils/ShadowMapBaker')).ShadowMapBaker
}, 60_000)

interface DrawRecord {scene: unknown, materials: Map<unknown, Material | Material[]>, renderTarget: unknown}

function setup() {
    const scene = new Scene() as Scene & Record<string, any>
    scene.mainCamera = new PerspectiveCamera()
    scene.addObject = (o: any) => scene.add(o)

    const draws: DrawRecord[] = []
    let renderTarget: unknown = null
    const renderer = {
        render: vi.fn((s: Scene) => {
            const materials = new Map<unknown, Material | Material[]>()
            s.traverseVisible((o: any) => {
                if (o.material) materials.set(o, o.material)
            })
            draws.push({scene: s, materials, renderTarget})
        }),
        renderWithModes: (_: unknown, render: () => void) => render(),
        setRenderTarget: vi.fn((t: unknown) => renderTarget = t),
        getRenderTarget: () => null,
        getActiveCubeFace: () => 0,
        getActiveMipmapLevel: () => 0,
        clear: vi.fn(),
        setScissorTest: vi.fn(),
        state: {buffers: {depth: {setMask: vi.fn()}}},
    }
    const targets: WebGLRenderTarget[] = []
    const renderManager = {
        renderer,
        createTarget: vi.fn((op: any) => {
            const t = new WebGLRenderTarget(op.size.x, op.size.y, {
                depthTexture: op.depthTexture ? new tp.DepthTexture(op.size.x, op.size.y) : null,
            })
            targets.push(t)
            return t
        }),
        disposeTarget: vi.fn((t: WebGLRenderTarget) => t.dispose()),
        getTempTarget: vi.fn((op: any) => new WebGLRenderTarget(op.size.x, op.size.y)),
        releaseTempTarget: vi.fn(),
        blit: vi.fn(),
    }
    const viewer = {scene, renderManager, setDirty: vi.fn()} as any

    // a threepipe mesh (forcedOverrideMaterial), a three.js mesh (material swapped), one that does not cast, a sprite,
    // and the ground the shadow is baked on
    const caster = new tp.Mesh2(new BoxGeometry(), new tp.PhysicalMaterial({side: FrontSide})) as any
    caster.castShadow = true
    const alphaTested = new tp.PhysicalMaterial({side: DoubleSide, alphaTest: 0.5})
    alphaTested.map = new Texture()
    const threeCaster = new Mesh(new BoxGeometry(), [new MeshBasicMaterial({side: BackSide}), alphaTested as any])
    threeCaster.geometry.groups.forEach((g, i) => g.materialIndex = i % 2)
    threeCaster.castShadow = true
    const notCaster = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    notCaster.castShadow = false
    const sprite = new Sprite()
    sprite.castShadow = true
    const ground = new tp.Mesh2(new PlaneGeometry(), new tp.PhysicalMaterial()) as any
    ground.castShadow = true
    scene.add(caster, threeCaster, notCaster, sprite, ground)

    const baker = new ShadowMapBaker(viewer)
    baker.attachedMesh = ground
    return {baker, scene, renderer, renderManager, draws, targets, caster, threeCaster, notCaster, sprite, ground, alphaTested}
}

describe('ShadowMapBaker state restore', () => {
    test.each([PCFShadowMap, PCFSoftShadowMap, VSMShadowMap])('a file with shadowMapType %i loads, without it', (type) => {
        const {baker} = setup()
        baker.fromJSON({maxFrameNumber: 64, smoothShadow: true, groundMapMode: 'map', shadowMapType: type})
        expect(baker.maxFrameNumber).toBe(64)
        expect(baker.smoothShadow).toBe(true)
        expect(baker.groundMapMode).toBe('map')
        expect(baker.lightsPerFrame).toBe(4) // not in the old file: the default
        expect(baker.shadowMapType).toBe(tp.BasicShadowMap) // ignored
        const json = tp.ThreeSerialization.Serialize(baker)
        expect(json).not.toHaveProperty('shadowMapType')
        expect(json).toMatchObject({maxFrameNumber: 64, lightsPerFrame: 4, smoothShadow: true, groundMapMode: 'map'})
    })

    test('lightsPerFrame is saved and loaded, as a whole number from 1 to 16', () => {
        const {baker} = setup()
        baker.fromJSON({lightsPerFrame: 2})
        expect(baker.lightsPerFrame).toBe(2)
        expect(tp.ThreeSerialization.Serialize(baker)).toMatchObject({lightsPerFrame: 2})
        baker.lightsPerFrame = 0
        expect(baker.lightsPerFrame).toBe(1)
        baker.lightsPerFrame = 2.5
        expect(baker.lightsPerFrame).toBe(2)
        baker.lightsPerFrame = 100
        expect(baker.lightsPerFrame).toBe(16)
    })
})

describe('ShadowMapBaker bake frame', () => {
    test('the depth renders draw only the casters, with depth materials, and the scene materials are put back', () => {
        const {baker, scene, renderer, draws, caster, threeCaster, notCaster, sprite, ground, alphaTested} = setup()
        const sceneMaterials = [caster.material, ...threeCaster.material as Material[], notCaster.material, sprite.material, ground.material] as Material[]
        const versions = sceneMaterials.map(m => m.version)
        baker.lightsPerFrame = 3

        expect(baker.updateShadow()).toBe(true)
        expect(baker.frameNumber).toBe(3)

        const depthDraws = draws.filter(d => d.scene === scene)
        expect(depthDraws).toHaveLength(3) // one for each light position
        for (const d of depthDraws) {
            expect(d.renderTarget).toBe(baker.depthTarget)
            const casterMat = d.materials.get(caster) as MeshDepthMaterial
            expect(casterMat.isMeshDepthMaterial).toBe(true)
            expect(casterMat.side).toBe(BackSide) // the side for shadows, as three.js
            expect(casterMat.colorWrite).toBe(false)
            const [back, alpha] = d.materials.get(threeCaster) as MeshDepthMaterial[]
            expect(back.side).toBe(FrontSide)
            expect(alpha.side).toBe(DoubleSide)
            expect(alpha.alphaTest).toBe(0.5)
            expect(alpha.map).toBe(alphaTested.map)
            for (const o of [notCaster, sprite, ground]) expect((d.materials.get(o) as Material).visible).toBe(false)
        }
        // the bake pass draws the ground in its own scene, into the baked shadow
        const bakeDraws = draws.filter(d => d.scene !== scene)
        expect(bakeDraws).toHaveLength(1)
        expect(bakeDraws[0].renderTarget).toBe(baker.target)

        // put back, without a material update
        expect(caster.forcedOverrideMaterial).toBeUndefined()
        expect(threeCaster.material).toEqual(sceneMaterials.slice(1, 3))
        expect(notCaster.material).toBe(sceneMaterials[3])
        expect(sprite.material).toBe(sceneMaterials[4])
        expect(ground.material).toBe(sceneMaterials[5])
        expect(sceneMaterials.map(m => m.version)).toEqual(versions.map((v, i) => i === 5 ? v + 1 : v)) // the ground once: its aoMap is the baked shadow
        expect(ground.material.aoMap).toBe(baker.target!.texture)

        // the next frames: the same depth materials, and no material update
        const depthMats = [depthDraws[0].materials.get(caster), ...depthDraws[0].materials.get(threeCaster) as Material[]] as Material[]
        const depthVersions = depthMats.map(m => m.version)
        const groundVersion = ground.material.version
        baker.updateShadow()
        const last = draws.filter(d => d.scene === scene).at(-1)!
        expect([last.materials.get(caster), ...last.materials.get(threeCaster) as Material[]]).toEqual(depthMats)
        expect(depthMats.map(m => m.version)).toEqual(depthVersions)
        expect(ground.material.version).toBe(groundVersion)
        expect(renderer.render).toHaveBeenCalledTimes(8)

        // a property that changes the program of a depth material updates it
        alphaTested.alphaTest = 0
        baker.updateShadow()
        expect(depthMats.map(m => m.version)).toEqual([depthVersions[0], depthVersions[1], depthVersions[2] + 1])
    })

    test('the last frame renders only the light positions left, and the bake stops at maxFrameNumber', () => {
        const {baker, scene, draws} = setup()
        baker.maxFrameNumber = 10
        baker.lightsPerFrame = 4
        expect(baker.updateShadow()).toBe(true)
        expect(baker.updateShadow()).toBe(true)
        expect(baker.updateShadow()).toBe(true)
        expect(baker.frameNumber).toBe(10)
        expect(draws.filter(d => d.scene === scene)).toHaveLength(10)
        expect(baker.updateShadow()).toBe(false)
        baker.reset()
        expect(baker.updateShadow()).toBe(true)
        expect(baker.frameNumber).toBe(4)
    })

    test('the light positions are the ones of the earlier baker, one for each frame number', () => {
        const {baker} = setup()
        const light = baker.light
        const spy = vi.spyOn(light, 'randomizePosition')
        baker.lightsPerFrame = 4
        baker.updateShadow()
        baker.updateShadow()
        expect(spy.mock.calls).toEqual([[0, 1, 0], [0, 1, 0], [3], [4], [5], [6], [7], [8]])
    })

    test('no depth render when the light does not cast shadows: the ground is lit', () => {
        const {baker, scene, draws} = setup()
        baker.light.shadowParams = {enabled: false}
        baker.updateShadow()
        expect(draws.filter(d => d.scene === scene)).toHaveLength(0)
        expect(draws).toHaveLength(1) // the bake pass
    })
})

describe('ShadowMapBaker dispose', () => {
    test('disposes its targets, depth materials and the light, and frees the ground material', () => {
        const {baker, scene, renderManager, ground} = setup()
        baker.updateShadow()
        const target = baker.target!
        const depthTarget = baker.depthTarget!
        expect(depthTarget.depthTexture).toBeTruthy()
        const disposed: unknown[] = []
        target.addEventListener('dispose', () => disposed.push(target))
        depthTarget.addEventListener('dispose', () => disposed.push(depthTarget))
        // the depth materials of the three caster materials
        const depthMaterials = [...(baker as any)._depthMaterials.values()] as Material[]
        expect(depthMaterials.length).toBe(3)
        const spyDisposeDepth = vi.fn()
        depthMaterials.forEach(m => m.addEventListener('dispose', spyDisposeDepth))

        baker.dispose()
        expect(renderManager.disposeTarget).toHaveBeenCalledWith(target)
        expect(renderManager.disposeTarget).toHaveBeenCalledWith(depthTarget)
        expect(disposed).toEqual([target, depthTarget])
        expect(spyDisposeDepth).toHaveBeenCalledTimes(3)
        expect(baker.target).toBeUndefined()
        expect(baker.depthTarget).toBeUndefined()
        expect(ground.material.aoMap).toBeNull()
        expect(scene.children).not.toContain(baker.light)
    })

    test('a disposed scene material disposes its depth material', () => {
        const {baker, caster} = setup()
        baker.updateShadow()
        const depthMaterial = (baker as any)._depthMaterials.get(caster.material) as Material
        const spy = vi.fn()
        depthMaterial.addEventListener('dispose', spy)
        caster.material.dispose()
        expect(spy).toHaveBeenCalledTimes(1)
        expect((baker as any)._depthMaterials.has(caster.material)).toBe(false)
    })
})
