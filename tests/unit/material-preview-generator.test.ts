import {beforeAll, describe, expect, it, vi} from 'vitest'
import {MeshLambertMaterial, MeshStandardMaterial} from 'three'

let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
}, 60_000)

// a renderer that records whether the preview scene's light is visible when the scene is rendered
function fakeRenderer() {
    const lightVisible: boolean[] = []
    const renderer = {
        extensions: {has: () => false},
        capabilities: {isWebGL2: true},
        autoClear: true,
        getRenderTarget: () => null,
        getActiveCubeFace: () => 0,
        getActiveMipmapLevel: () => 0,
        getClearColor: (target: any) => target.set(0),
        getClearAlpha: () => 1,
        setClearColor: vi.fn(),
        setRenderTarget: vi.fn(),
        clear: vi.fn(),
        readRenderTargetPixels: vi.fn(),
        render: vi.fn((scene: any) => {
            if (!scene.isScene) return // the tone mapping quad
            const lights: boolean[] = []
            scene.traverse((o: any) => { if (o.isLight) lights.push(o.visible) })
            expect(lights).toHaveLength(1)
            lightVisible.push(lights[0])
        }),
    }
    return {renderer, lightVisible}
}

describe('MaterialPreviewGenerator light', () => {
    it('turns the light off with an environment map only for materials that are lit by the scene environment', () => {
        const generator = new tp.MaterialPreviewGenerator()
        const {renderer, lightVisible} = fakeRenderer()
        const environment = new tp.Texture()
        const materials = [
            new tp.PhysicalMaterial(), // MeshPhysicalMaterial: lit by scene.environment
            new MeshStandardMaterial(),
            new tp.LegacyPhongMaterial(), // MeshPhongMaterial: not lit by scene.environment
            new MeshLambertMaterial(),
            new tp.UnlitMaterial(),
        ]
        for (const m of materials) generator.renderPixels(m as any, renderer as any, {environment, size: 4})
        expect(lightVisible).toEqual([false, false, true, true, true])

        lightVisible.length = 0
        for (const m of materials) generator.renderPixels(m as any, renderer as any, {size: 4})
        expect(lightVisible).toEqual([true, true, true, true, true]) // no environment map

        lightVisible.length = 0
        generator.renderPixels(materials[0] as any, renderer as any, {environment, size: 4, light: true})
        generator.renderPixels(materials[2] as any, renderer as any, {environment, size: 4, light: false})
        expect(lightVisible).toEqual([true, false]) // the light option overrides the default

        generator.dispose()
        materials.forEach(m => m.dispose())
        environment.dispose()
    })
})

describe('MaterialPreviewGenerator view', () => {
    it('turns the camera to cameraDirection and moves it by cameraDistance', () => {
        const generator = new tp.MaterialPreviewGenerator()
        const {renderer} = fakeRenderer()
        const material = new tp.PhysicalMaterial()
        const dir = () => generator.camera.position.clone().sub(generator.camera.target ?? new tp.Vector3()).normalize()
        const length = () => generator.camera.position.length()
        generator.renderPixels(material as any, renderer as any, {size: 4})
        expect(dir().toArray().map(v => +v.toFixed(3))).toEqual([0, 0, 1]) // the default
        const base = length()
        generator.renderPixels(material as any, renderer as any, {size: 4, cameraDirection: new tp.Vector3(2, 0, 0)})
        expect(dir().toArray().map(v => +v.toFixed(3))).toEqual([1, 0, 0])
        expect(length()).toBeCloseTo(base, 5) // the direction is normalized: the same framing
        generator.renderPixels(material as any, renderer as any, {size: 4, cameraDirection: new tp.Vector3(2, 0, 0), cameraDistance: 0.5})
        expect(length()).toBeCloseTo(base * 0.5, 5)
        generator.dispose()
        material.dispose()
    })
})

describe('MaterialPreviewGenerator shapes', () => {
    it('the preset shapes have a white vertex colour, so a material with vertexColors is not black', () => {
        const generator = new tp.MaterialPreviewGenerator()
        for (const name of ['sphere', 'cube', 'cylinder']) {
            const color = generator.shapes[name].geometry.getAttribute('color')
            expect(color?.itemSize).toBe(3)
            expect(color.count).toBe(generator.shapes[name].geometry.getAttribute('position').count)
            expect(Array.from(color.array as Float32Array).every(v => v === 1)).toBe(true)
        }
        generator.dispose()
    })
})
