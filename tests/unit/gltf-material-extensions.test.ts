/**
 * Unit tests for the glTF material extensions (Node) -
 * legacy bump scale detection on import (GLTFMaterialExtrasExtension) and the skip guards in the map extension exporters.
 */
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {Mesh, MeshStandardMaterial, Scene, Texture} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('legacy bump scale detection on import', () => {
    interface Params {
        subversion?: number
        /** WEBGI_viewer scene extension */
        viewer?: any
        /** WEBGI_materials_bumpmap material extension */
        bumpExt?: any
        /** userData.legacyBumpScale restored from material extras */
        extrasFlag?: boolean
        /** define already set on the material */
        define?: boolean
        bumpMap?: boolean
    }
    async function load({subversion, viewer, bumpExt, extrasFlag, define, bumpMap = true}: Params) {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const material = new MeshStandardMaterial()
        material.userData.gltfExtensions = {[tp.GLTFMaterialExtrasExtension.WebGiMaterialExtrasExtension]: {}}
        if (bumpMap) material.bumpMap = new Texture()
        if (extrasFlag) material.userData.legacyBumpScale = true
        if (define) material.defines!.BUMP_MAP_SCALE_LEGACY = '1'
        const scene = new Scene()
        scene.add(new Mesh(undefined, material))
        const parser = {
            json: {
                asset: {version: '2.0', ...subversion !== undefined ? {subversion} : {}},
                scenes: [viewer ? {extensions: {['WEBGI_viewer']: viewer}} : {}],
                materials: [bumpExt ? {extensions: {[tp.GLTFMaterialsBumpMapExtension.WebGiMaterialsBumpMapExtension]: bumpExt}} : {}],
            },
            associations: new Map([[material, {materials: 0}]]),
        }
        const version = material.version
        await tp.GLTFMaterialExtrasExtension.Import(() => ({}))(parser as any).afterRoot!({scenes: [scene]} as any)
        return {
            legacy: !!material.userData.legacyBumpScale,
            define: material.defines!.BUMP_MAP_SCALE_LEGACY,
            updated: material.version !== version,
        }
    }
    const webgi = (version?: string) => ({type: 'ViewerApp', version, metadata: {generator: 'WebGiViewerApp'}})

    it('uses asset.subversion when present', async() => {
        expect(await load({subversion: 0})).toEqual({legacy: true, define: '1', updated: true})
        expect(await load({subversion: 1})).toEqual({legacy: false, define: undefined, updated: false})
        // subversion wins over the viewer config version
        expect((await load({subversion: 1, viewer: webgi('0.9.0')})).legacy).toBe(false)
    })

    it('falls back to the viewer config version for webgi files without a subversion', async() => {
        expect((await load({viewer: webgi('0.11.9')})).legacy).toBe(true)
        expect((await load({viewer: webgi('0.9.20')})).legacy).toBe(true) // numeric compare, not lexicographic
        expect((await load({viewer: webgi('0.12.0-dev.1')})).legacy).toBe(true)
        expect((await load({viewer: webgi()})).legacy).toBe(true)
        expect((await load({viewer: webgi('0.12.0')})).legacy).toBe(false)
        expect((await load({viewer: webgi('0.21.5')})).legacy).toBe(false)
    })

    it('is not legacy for threepipe and unknown files without a subversion', async() => {
        expect((await load({viewer: {type: 'ThreeViewer', version: '0.0.1', metadata: {generator: 'ThreePipe'}}})).legacy).toBe(false)
        expect((await load({})).legacy).toBe(false)
    })

    it('keeps the flag restored from material extras', async() => {
        expect(await load({subversion: 1, extrasFlag: true})).toEqual({legacy: true, define: '1', updated: true})
    })

    it('normalizedScale in the bump extension has the highest priority', async() => {
        expect(await load({subversion: 1, bumpExt: {normalizedScale: false}})).toEqual({legacy: true, define: '1', updated: true})
        expect(await load({subversion: 0, bumpExt: {normalizedScale: true}})).toEqual({legacy: false, define: undefined, updated: false})
        // stale flag and define are cleared, and the material is recompiled
        expect(await load({bumpExt: {normalizedScale: true}, extrasFlag: true, define: true})).toEqual({legacy: false, define: undefined, updated: true})
    })

    it('ignores materials without a bump map', async() => {
        expect(await load({subversion: 0, bumpMap: false})).toEqual({legacy: false, define: undefined, updated: false})
    })
})

describe('map extension exporters', () => {
    function write(extension: {Export: (writer: any) => any}, props: Partial<MeshStandardMaterial>, validMap = true) {
        const writer = {
            extensionsUsed: {} as Record<string, boolean>,
            checkEmptyMap: () => validMap,
            processTexture: () => 0,
            applyTextureTransform: () => {},
        }
        const material = Object.assign(new MeshStandardMaterial(), props)
        const materialDef: any = {}
        extension.Export(writer).writeMaterial(material, materialDef)
        return {extensions: materialDef.extensions, used: Object.keys(writer.extensionsUsed)}
    }

    it('does not write empty extensions', () => {
        expect(write(tp.GLTFMaterialsLightMapExtension, {})).toEqual({extensions: undefined, used: []})
        expect(write(tp.GLTFMaterialsDisplacementMapExtension, {})).toEqual({extensions: undefined, used: []})
        expect(write(tp.GLTFMaterialsAlphaMapExtension, {})).toEqual({extensions: undefined, used: []})
        // map without an image, with ignoreEmptyTextures
        expect(write(tp.GLTFMaterialsAlphaMapExtension, {alphaMap: new Texture()}, false)).toEqual({extensions: undefined, used: []})
        expect(write(tp.GLTFMaterialsLightMapExtension, {lightMap: new Texture()}, false)).toEqual({extensions: undefined, used: []})
    })

    it('keeps the map when the scale is 0', () => {
        expect(write(tp.GLTFMaterialsLightMapExtension, {lightMap: new Texture(), lightMapIntensity: 0}).extensions).toEqual({
            ['WEBGI_materials_lightmap']: {lightMapIntensity: 0, lightMapTexture: {index: 0}},
        })
        expect(write(tp.GLTFMaterialsDisplacementMapExtension, {displacementMap: new Texture(), displacementScale: 0}).extensions).toEqual({
            ['WEBGI_materials_displacementmap']: {displacementScale: 0, displacementTexture: {index: 0}},
        })
        expect(write(tp.GLTFMaterialsLightMapExtension, {lightMapIntensity: 0})).toEqual({extensions: undefined, used: []})
        expect(write(tp.GLTFMaterialsDisplacementMapExtension, {displacementScale: 0})).toEqual({extensions: undefined, used: []})
    })

    it('writes normalizedScale in the bump map extension', () => {
        expect(write(tp.GLTFMaterialsBumpMapExtension, {bumpMap: new Texture(), bumpScale: 0}).extensions).toEqual({
            ['WEBGI_materials_bumpmap']: {bumpScale: 0, normalizedScale: true, bumpTexture: {index: 0}},
        })
        expect(write(tp.GLTFMaterialsBumpMapExtension, {bumpMap: new Texture(), bumpScale: 2, userData: {legacyBumpScale: true}}).extensions).toEqual({
            ['WEBGI_materials_bumpmap']: {bumpScale: 2, normalizedScale: false, bumpTexture: {index: 0}},
        })
        expect(write(tp.GLTFMaterialsBumpMapExtension, {bumpScale: 0})).toEqual({extensions: undefined, used: []})
    })
})
