import {beforeAll, describe, expect, it} from 'vitest'
import * as THREE from '../../src/index'
import {CityStandardMaterial, CityBasicMaterial, CitySpriteMaterial, TSL, compileSurface, prepareCityBuffers, updateCityUniforms} from '../../examples/slop-newyork/tsl-glsl.js'

const nyc = (window as any).NYC = {
    THREE: {...THREE, MeshStandardNodeMaterial: CityStandardMaterial, MeshBasicNodeMaterial: CityBasicMaterial, SpriteNodeMaterial: CitySpriteMaterial,
        PhysicalLightingModel: class {}, InterpolationSamplingType: {FLAT: 0}, InterpolationSamplingMode: {EITHER: 0}},
    TSL,
}

beforeAll(async () => {
    await import('../../examples/slop-newyork/js/nyc-geodata.js')
    await import('../../examples/slop-newyork/js/city-config.js')
    await import('../../examples/slop-newyork/js/tsl-materials.js')
})

describe('New York procedural surface port', () => {
    it.each(['createCurtainWallMaterial', 'createPreWarBuildingMaterial', 'createRoadSurfaceMaterial', 'createSidewalkMaterial', 'createCurbMaterial', 'createChryslerCrownMaterial', 'createParkPavingMaterial', 'createParkLawnMaterial', 'createTreeBarkMaterial'])('compiles %s with live uniforms and reusable GLSL functions', name => {
        const material = nyc[name]()
        const code = compileSurface(material)
        expect(code.pieces.color).toBeDefined()
        expect(code.fragmentPars).not.toMatch(/undefined|NaN/)
        expect(code.vertexPars).not.toMatch(/undefined|NaN/)
        expect(code.fragmentPars).toContain('nyFn')
    })

    it('keeps leaf coverage and vertex motion in the G-buffer graph', () => {
        const mat = nyc.createTreeMaterial(new THREE.Texture())
        const surface = compileSurface(mat)
        const depth = compileSurface(mat, 'depth')
        expect(depth.position).toBe(surface.position)
        expect(depth.pieces.color.expr).toBe(surface.pieces.color.expr)
        expect(depth.vertexPars).toContain('aTreeData')
        expect(depth.fragmentPars).toContain('sampler2D')
    })

    it('uploads crowd pose buffers as bounded 2D textures when poses change', () => {
        const pose = TSL.attributeArray(20000, 'vec4')
        const mat = new CityStandardMaterial()
        mat.positionNode = pose.element(TSL.int(TSL.instanceIndex)).xyz
        const code = compileSurface(mat)
        const texture = Object.values(code.uniforms).find((u: any) => u.value?.isDataTexture) as any
        expect(texture.value.image.width).toBeLessThanOrEqual(1024)
        expect(texture.value.image.height).toBeGreaterThan(1)
        expect(code.vertexBody).toContain('% 1024')
        updateCityUniforms(0, {getDrawingBufferSize: () => {}})
        const before = texture.value.version
        pose.value.array[0] = 42
        pose.value.needsUpdate = true
        updateCityUniforms(1, {getDrawingBufferSize: () => {}})
        expect(texture.value.image.data[0]).toBe(42)
        expect(texture.value.version).toBeGreaterThan(before)
    })

    it('shares facade programs across different uniform values', () => {
        const a = nyc.createPreWarBuildingMaterial({seed: 13})
        const b = nyc.createPreWarBuildingMaterial({seed: 27})
        expect(a).not.toBe(b)
        expect(a.materialExtensions[0].computeCacheKey()).toBe(b.materialExtensions[0].computeCacheKey())
    })

    it('retains the previous instance transforms until the frame has finished', () => {
        const root = new THREE.Group()
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new CityStandardMaterial(), 2)
        root.add(mesh)
        const velocityFactory = () => ({uniforms: {}, extraUniformsToUpload: {}, onBeforeRender() {}})
        const buffers = prepareCityBuffers(root, velocityFactory, {uniforms: {currentProjectionViewMatrix: {}, lastProjectionViewMatrix: {}}})
        const previous = mesh.geometry.getAttribute('nyPreviousMatrix')
        const matrix = new THREE.Matrix4().makeTranslation(12, 0, 0)
        mesh.setMatrixAt(0, matrix)
        mesh.instanceMatrix.needsUpdate = true
        expect(previous.array[12]).toBe(0)
        buffers.afterFrame()
        expect(previous.array[12]).toBe(12)
        const version = previous.version
        buffers.afterFrame()
        expect(previous.version).toBe(version)
    })
})
