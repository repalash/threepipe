/**
 * Unit tests for AmbientCGZipLoader and PolyhavenMaterialGLTFLoader of @threepipe/plugins-extra-importers (Node): the file names in an ambientCG zip, the map slots, the material and the HDRI.
 * The file lists are from real 1K-JPG material zips and 1K HDRI zips (Nov 2026).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {DataTexture, EquirectangularReflectionMapping, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture} from 'three'

let tp: typeof import('threepipe')
let ei: typeof import('../../plugins/extra-importers/src/index')
beforeAll(async() => {
    tp = await import('threepipe')
    ei = await import('../../plugins/extra-importers/src/index')
})

const fabric087 = [ // has Opacity
    'Fabric087_1K-JPG.usdc', 'Fabric087_1K-JPG_Color.jpg', 'Fabric087_1K-JPG_Displacement.jpg', 'Fabric087_1K-JPG_NormalDX.jpg',
    'Fabric087_1K-JPG_NormalGL.jpg', 'Fabric087_1K-JPG_Opacity.jpg', 'Fabric087_1K-JPG_Roughness.jpg', 'Fabric087_1K-JPG.blend',
    'Fabric087_1K-JPG.mtlx', 'Fabric087_1K-JPG.tres', 'Fabric087.png',
]
const metal032 = [ // has Metalness
    'Metal032_1K-JPG.usdc', 'Metal032_1K-JPG_Color.jpg', 'Metal032_1K-JPG_Displacement.jpg', 'Metal032_1K-JPG_Metalness.jpg',
    'Metal032_1K-JPG_NormalDX.jpg', 'Metal032_1K-JPG_NormalGL.jpg', 'Metal032_1K-JPG_Roughness.jpg', 'Metal032_1K-JPG.blend',
    'Metal032_1K-JPG.mtlx', 'Metal032_1K-JPG.tres', 'Metal032.png',
]
const lava004 = [ // has Emission
    'Lava004_1K-JPG_Color.jpg', 'Lava004_1K-JPG_Displacement.jpg', 'Lava004_1K-JPG_Emission.jpg', 'Lava004_1K-JPG_NormalDX.jpg',
    'Lava004_1K-JPG_NormalGL.jpg', 'Lava004_1K-JPG_Roughness.jpg', 'Lava004.png',
]
const sponge001 = [ // has Scattering, AmbientOcclusion
    'Sponge001_1K-JPG_AmbientOcclusion.jpg', 'Sponge001_1K-JPG_Color.jpg', 'Sponge001_1K-JPG_Displacement.jpg',
    'Sponge001_1K-JPG_NormalDX.jpg', 'Sponge001_1K-JPG_NormalGL.jpg', 'Sponge001_1K-JPG_Roughness.jpg', 'Sponge001_1K-JPG_Scattering.jpg',
]

const night011 = [ // an HDRI
    'NightEnvironmentHDRI011_1K.usdc', 'NightEnvironmentHDRI011_1K_HDR.exr', 'NightEnvironmentHDRI011_1K_TONEMAPPED.jpg',
    'NightEnvironmentHDRI011_1K.blend', 'NightEnvironmentHDRI011_1K.tres', 'NightEnvironmentHDRI011.png',
]

describe('findAmbientCGHDRIFile', () => {
    it('finds the HDR image of an HDRI zip', () => {
        expect(ei.findAmbientCGHDRIFile(night011)).toBe('NightEnvironmentHDRI011_1K_HDR.exr')
        expect(ei.findAmbientCGHDRIFile(['a/DaySkyHDRI072B_4K_HDR.hdr'])).toBe('a/DaySkyHDRI072B_4K_HDR.hdr')
    })
    it('is undefined for a material zip', () => {
        for (const z of [fabric087, metal032, lava004, sponge001]) expect(ei.findAmbientCGHDRIFile(z)).toBeUndefined()
        expect(ei.findAmbientCGHDRIFile(['__MACOSX/._NightEnvironmentHDRI011_1K_HDR.exr'])).toBeUndefined()
    })
})

describe('parseAmbientCGFileName', () => {
    it('parses the map files', () => {
        expect(ei.parseAmbientCGFileName('Fabric087_1K-JPG_NormalGL.jpg')).toEqual({assetId: 'Fabric087', variant: '1K-JPG', map: 'NormalGL', ext: 'jpg'})
        expect(ei.parseAmbientCGFileName('Fabric087_1K-PNG_Color.PNG')).toEqual({assetId: 'Fabric087', variant: '1K-PNG', map: 'Color', ext: 'png'})
        expect(ei.parseAmbientCGFileName('folder/Planks023B_2K-JPG_Roughness.jpg')).toEqual({assetId: 'Planks023B', variant: '2K-JPG', map: 'Roughness', ext: 'jpg'})
    })
    it('ignores the other files', () => {
        for (const f of ['Fabric087_1K-JPG.usdc', 'Fabric087_1K-JPG.mtlx', 'Fabric087_1K-JPG.blend', 'Fabric087_1K-JPG.tres', 'Fabric087.png'])
            expect(ei.parseAmbientCGFileName(f)).toBeUndefined()
    })
})

describe('pickAmbientCGMapFiles', () => {
    it('picks NormalGL over NormalDX and skips the preview', () => {
        const {files, assetId, unknown} = ei.pickAmbientCGMapFiles(fabric087)
        expect(assetId).toBe('Fabric087')
        expect(unknown).toEqual([])
        expect(files).toEqual({
            Color: 'Fabric087_1K-JPG_Color.jpg',
            Displacement: 'Fabric087_1K-JPG_Displacement.jpg',
            NormalGL: 'Fabric087_1K-JPG_NormalGL.jpg',
            Opacity: 'Fabric087_1K-JPG_Opacity.jpg',
            Roughness: 'Fabric087_1K-JPG_Roughness.jpg',
        })
    })
    it('uses NormalDX when there is no NormalGL', () => {
        const {files} = ei.pickAmbientCGMapFiles(metal032.filter(f => !f.includes('NormalGL')))
        expect(files.NormalDX).toBe('Metal032_1K-JPG_NormalDX.jpg')
        expect(files.NormalGL).toBeUndefined()
    })
    it('lists the maps with no slot', () => {
        const {files, unknown} = ei.pickAmbientCGMapFiles(sponge001)
        expect(unknown).toEqual(['Scattering'])
        expect(Object.keys(files).sort()).toEqual(['AmbientOcclusion', 'Color', 'Displacement', 'NormalGL', 'Roughness'])
    })
    it('skips macOS metadata files', () => {
        const {files} = ei.pickAmbientCGMapFiles(['__MACOSX/._Metal032_1K-JPG_Color.jpg', 'x/._Metal032_1K-JPG_Color.jpg'])
        expect(files).toEqual({})
    })
})

function texturesFor(names: string[]) {
    const {files} = ei.pickAmbientCGMapFiles(names)
    return Object.fromEntries(Object.keys(files).map(m => [m, new Texture() as any]))
}

describe('ambientCGMaterialParameters', () => {
    it('sets the slots, colour spaces and wrapping', () => {
        const t = texturesFor([...metal032, 'Metal032_1K-JPG_AmbientOcclusion.jpg'])
        const p = ei.ambientCGMaterialParameters(t) as any
        expect(p.map).toBe(t.Color)
        expect(p.normalMap).toBe(t.NormalGL)
        expect(p.roughnessMap).toBe(t.Roughness)
        expect(p.metalnessMap).toBe(t.Metalness)
        expect(p.aoMap).toBe(t.AmbientOcclusion)
        expect(p.displacementMap).toBe(t.Displacement)
        expect(p.color).toBe(0xffffff)
        expect(p.roughness).toBe(1)
        expect(p.metalness).toBe(1)
        expect(p.normalScale).toBeUndefined()
        expect(p.displacementScale).toBe(0)
        expect(p.transparent).toBeUndefined()
        expect(t.Color.colorSpace).toBe(SRGBColorSpace)
        for (const m of ['NormalGL', 'Roughness', 'Metalness', 'AmbientOcclusion', 'Displacement']) expect(t[m].colorSpace).toBe(NoColorSpace)
        for (const m of Object.keys(t)) {
            expect(t[m].wrapS).toBe(RepeatWrapping)
            expect(t[m].wrapT).toBe(RepeatWrapping)
        }
    })
    it('is not metallic without a Metalness map', () => {
        const p = ei.ambientCGMaterialParameters(texturesFor(fabric087)) as any
        expect(p.metalness).toBe(0)
        expect(p.metalnessMap).toBeUndefined()
    })
    it('uses Opacity as alphaMap and makes the material transparent', () => {
        const t = texturesFor(fabric087)
        const p = ei.ambientCGMaterialParameters(t) as any
        expect(p.alphaMap).toBe(t.Opacity)
        expect(p.transparent).toBe(true)
        expect(t.Opacity.colorSpace).toBe(NoColorSpace)
    })
    it('uses Emission as emissiveMap in sRGB with a white emissive', () => {
        const t = texturesFor(lava004)
        const p = ei.ambientCGMaterialParameters(t) as any
        expect(p.emissiveMap).toBe(t.Emission)
        expect(p.emissive).toBe(0xffffff)
        expect(t.Emission.colorSpace).toBe(SRGBColorSpace)
    })
    it('flips the green channel of a NormalDX map', () => {
        const t = texturesFor(metal032.filter(f => !f.includes('NormalGL')))
        const p = ei.ambientCGMaterialParameters(t) as any
        expect(p.normalMap).toBe(t.NormalDX)
        expect(p.normalScale.x).toBe(1)
        expect(p.normalScale.y).toBe(-1)
    })
})

describe('AmbientCGZipLoader.transform', () => {
    function stubImporter() {
        const calls: {paths: string[], options: any}[] = []
        const importer = {
            importFiles: async(files: Map<string, any>, options: any) => {
                calls.push({paths: [...files.keys()], options})
                return new Map([...files.keys()].map(p => [p, [p.endsWith('.exr') ? new DataTexture() : new Texture()]]))
            },
        }
        return {importer, calls}
    }
    function zip(names: string[]) {
        return new Map(names.map(n => [n, new File([new Uint8Array(1)], n)]))
    }

    it('loads the maps in the zip and returns a PhysicalMaterial', async() => {
        const loader = new ei.AmbientCGZipLoader()
        const {importer, calls} = stubImporter()
        loader.importer = importer as any
        const mat = await loader.transform(zip(metal032) as any, {fileExtension: 'acgzip'})
        expect(mat).toBeInstanceOf(tp.PhysicalMaterial)
        expect(mat!.name).toBe('Metal032')
        // only the map images are loaded, and not with the options of the zip (that would load each image as a zip again)
        expect(calls).toHaveLength(1)
        expect(calls[0].paths.sort()).toEqual([
            'Metal032_1K-JPG_Color.jpg', 'Metal032_1K-JPG_Displacement.jpg', 'Metal032_1K-JPG_Metalness.jpg',
            'Metal032_1K-JPG_NormalGL.jpg', 'Metal032_1K-JPG_Roughness.jpg',
        ])
        expect(calls[0].options.fileExtension).toBeUndefined()
        expect(mat!.map?.isTexture).toBe(true)
        expect(mat!.map?.colorSpace).toBe(SRGBColorSpace)
        expect(mat!.normalMap?.isTexture).toBe(true)
        expect(mat!.roughnessMap?.isTexture).toBe(true)
        expect(mat!.metalnessMap?.isTexture).toBe(true)
        expect(mat!.displacementMap?.isTexture).toBe(true)
        expect(mat!.metalness).toBe(1)
        expect(mat!.roughness).toBe(1)
        expect(mat!.displacementScale).toBe(0)
        expect(mat!.color.getHex()).toBe(0xffffff)
        expect(mat!.normalScale.x).toBe(1)
        expect(mat!.normalScale.y).toBe(1)
        expect(mat!.transparent).toBe(false)
    })

    it('returns the HDR texture of an HDRI zip, equirectangular and not processed yet', async() => {
        const loader = new ei.AmbientCGZipLoader()
        const {importer, calls} = stubImporter()
        loader.importer = importer as any
        const tex = await loader.transform(zip(night011) as any, {fileExtension: 'acgzip'}) as any
        expect(tex?.isDataTexture).toBe(true)
        expect(tex.mapping).toBe(EquirectangularReflectionMapping)
        expect(calls).toHaveLength(1)
        expect(calls[0].paths).toEqual(['NightEnvironmentHDRI011_1K_HDR.exr'])
        // processed once as the result of the zip (with the zip url as rootPath), not as a file in it
        expect(calls[0].options).toEqual({processRaw: false})
    })

    it('returns undefined for a zip without ambientCG maps', async() => {
        const loader = new ei.AmbientCGZipLoader()
        const {importer, calls} = stubImporter()
        loader.importer = importer as any
        const err = console.error
        console.error = () => {}
        try {
            expect(await loader.transform(zip(['model.gltf', 'texture.png']) as any, {})).toBeUndefined()
        } finally {
            console.error = err
        }
        expect(calls).toHaveLength(0)
    })

    it('needs the importer', async() => {
        const loader = new ei.AmbientCGZipLoader()
        await expect(loader.transform(zip(metal032) as any, {})).rejects.toThrow('importer')
    })
})

describe('PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl', () => {
    const folder = 'https://dl.polyhaven.org/file/ph-assets/Textures/gltf/1k/worn_planks/'
    it('maps a texture of a glTF on the Poly Haven CDN to where the CDN keeps it', () => {
        expect(ei.PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl(folder, 'textures/worn_planks_diff_1k.jpg'))
            .toBe('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/worn_planks/worn_planks_diff_1k.jpg')
        expect(ei.PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl(folder.replace('/1k/', '/4k/'), 'textures/worn_planks_nor_gl_4k.png'))
            .toBe('https://dl.polyhaven.org/file/ph-assets/Textures/png/4k/worn_planks/worn_planks_nor_gl_4k.png')
    })
    it('leaves other hosts, other folders and the buffer alone', () => {
        expect(ei.PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl('https://example.com/worn_planks/', 'textures/worn_planks_diff_1k.jpg')).toBeUndefined()
        expect(ei.PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl('https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/chair/', 'textures/chair_diff_1k.jpg')).toBeUndefined()
        expect(ei.PolyhavenMaterialGLTFLoader.PolyhavenTextureUrl(folder, 'worn_planks.bin')).toBeUndefined()
    })
})
