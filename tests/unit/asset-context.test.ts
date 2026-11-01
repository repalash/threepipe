/**
 * Unit tests for loading and exporting files without a viewer: AssetContext, the one-shot functions and assetFormats (Node).
 */
import {beforeAll, describe, expect, it} from 'vitest'
import {BoxGeometry, DirectionalLight, Group, Loader, Mesh, MeshStandardMaterial, PerspectiveCamera} from 'three'

// Deferred import — threepipe core has circular static-init dependencies that only resolve once the graph is fully loaded.
let tp: typeof import('threepipe')
beforeAll(async() => {
    tp = await import('threepipe')
})

function plainMesh() {
    const material = new MeshStandardMaterial({color: 0xff0000, roughness: 0.25, metalness: 0.5})
    material.name = 'red'
    const mesh = new Mesh(new BoxGeometry(1, 2, 3), material)
    mesh.name = 'box'
    return mesh
}

async function exportedGlb() {
    const blob = await tp.exportAsset(plainMesh())
    expect(blob).toBeDefined()
    return new File([await blob!.arrayBuffer()], 'box.glb')
}

describe('loading and exporting without a viewer', () => {
    it('exports a plain three.js mesh to glb and loads it back', async() => {
        const blob = await tp.exportAsset(plainMesh())
        expect(blob?.ext).toBe('glb')
        const bytes = new Uint8Array(await blob!.arrayBuffer())
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('glTF')

        const model = await tp.loadModel(new File([bytes], 'box.glb'))
        expect(model?.isObject3D).toBe(true)
        let mesh: any
        model!.traverse((o: any) => {
            if (o.isMesh && o.name === 'box') mesh = o
        })
        expect(mesh).toBeDefined()
        expect(mesh.geometry.attributes.position.count).toBe(24)
        expect(mesh.material.name).toBe('red')
        expect(mesh.material.roughness).toBeCloseTo(0.25)
        expect(mesh.material.metalness).toBeCloseTo(0.5)
    })

    it('loads glTF models as threepipe objects', async() => {
        const group = new Group()
        group.add(plainMesh(), new PerspectiveCamera(), new DirectionalLight())
        const blob = await tp.exportAsset(group)
        const assets = tp.createAssetContext()
        const model = await assets.loadModel(new File([await blob!.arrayBuffer()], 'group.glb'))
        expect(model!.assetType).toBe('model')
        const found: Record<string, any> = {}
        model!.traverse((o: any) => {
            if (o.isMesh) found.material = o.material
            if (o.isCamera) found.camera = o
            if (o.isLight) found.light = o
        })
        expect(found.material).toBeInstanceOf(tp.PhysicalMaterial)
        expect(found.camera.assetType).toBe('camera')
        expect(found.light).toBeInstanceOf(tp.DirectionalLight2)
        assets.dispose()
    })

    // OBJLoader creates plain three.js materials, which the upgrade converts
    const triangleObj = () => new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'triangle.obj')
    const firstMaterial = (model: any) => {
        let material: any
        model.traverse((o: any) => {
            if (o.isMesh) material = o.material
        })
        return material
    }

    it('converts plain three.js materials to threepipe materials by default', async() => {
        const assets = tp.createAssetContext({formats: [tp.assetFormats.obj]})
        const model = await assets.loadModel(triangleObj())
        expect(model!.assetType).toBe('model')
        expect(firstMaterial(model).assetType).toBe('material')
        assets.dispose()
    })

    it('keeps plain three.js materials with upgrade: false', async() => {
        const assets = tp.createAssetContext({formats: [tp.assetFormats.obj], upgrade: false})
        const model = await assets.loadModel(triangleObj())
        expect(model!.isObject3D).toBe(true)
        expect(model!.assetType).toBeUndefined()
        const material = firstMaterial(model)
        expect(material.isMaterial).toBe(true)
        expect(material.assetType).toBeUndefined()
        assets.dispose()
    })

    it('loads only the formats it was given', async() => {
        const assets = tp.createAssetContext({formats: [tp.assetFormats.images]})
        const has = (ext: string) => assets.importer.importers.some(i => (typeof i.ext === 'function' ? (i.ext as any)() : i.ext).includes(ext))
        expect(has('png')).toBe(true)
        expect(has('glb')).toBe(false)
        expect(has('fbx')).toBe(false)
        expect(await assets.loadModel(await exportedGlb())).toBeUndefined()

        assets.addFormat(tp.assetFormats.gltf)
        expect((await assets.loadModel(await exportedGlb()))?.isObject3D).toBe(true)
        assets.dispose()
    })

    it('registers every default format', () => {
        const assets = tp.createAssetContext()
        const builtIn = new tp.AssetImporter().importers.length // the importer's own (txt)
        expect(assets.importer.importers.length).toBe(builtIn + tp.defaultAssetFormats.length)
        for (const ext of ['glb', 'gltf', 'fbx', 'obj', 'mtl', 'drc', 'hdr', 'exr', 'png', 'jpg', 'svg', 'zip', 'json', 'mat', 'mp4']) {
            expect(assets.importer.importers.some(i => (typeof i.ext === 'function' ? (i.ext as any)() : i.ext).includes(ext)), ext).toBe(true)
        }
        assets.dispose()
    })

    it('accepts Importer objects as formats', () => {
        class LoaderA extends Loader {}
        const assets = tp.createAssetContext({formats: [new tp.Importer(LoaderA, ['abc'], ['model/abc'], true)]})
        expect(assets.importer.registerFile('a.abc')).toBeInstanceOf(LoaderA)
        assets.dispose()
    })

    it('loads the format of an importer plugin without a viewer', async() => {
        const assets = tp.createAssetContext({formats: []})
        assets.addFormat(new tp.STLLoadPlugin().importer)
        const stl = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n'
        const model = await assets.loadModel(new File([stl], 'triangle.stl'))
        let mesh: any
        model!.traverse((o: any) => {
            if (o.isMesh) mesh = o
        })
        expect(mesh.geometry.attributes.position.count).toBe(3)
        expect(mesh.material).toBeInstanceOf(tp.PhysicalMaterial)
        assets.dispose()
    })

    it('gives the loaders a host without a viewer', () => {
        const assets = tp.createAssetContext()
        expect(assets.assetManager.importer).toBe(assets.importer)
        expect(assets.assetManager.materials).toBe(assets.materials)
        expect(assets.toJSON).toBeUndefined()
        assets.dispose()
    })
})
