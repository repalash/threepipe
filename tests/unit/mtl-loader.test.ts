import {afterEach, describe, expect, it, vi} from 'vitest'
import {ClampToEdgeWrapping, Color, DoubleSide, Loader, LoadingManager, MeshPhongMaterial, NoColorSpace, SRGBColorSpace, Texture} from 'three'
import {MTLLoader2} from '../../src/assetmanager/import/MTLLoader2'
import {OBJLoader2} from '../../src/assetmanager/import/OBJLoader2'

function controlledLoader(text: string) {
    const requests = new Map<string, {texture: Texture, resolve: () => void, reject: () => void}>()
    const load = vi.fn((url: string, onLoad: (texture: Texture) => void, _progress: unknown, onError: (error: Error) => void) => {
        const texture = new Texture()
        requests.set(url, {texture, resolve: () => onLoad(texture), reject: () => onError(new Error(url))})
        return texture
    })
    const manager = new LoadingManager().addHandler(/\.png$/, {load} as unknown as Loader)
    const creator = new MTLLoader2(manager).setMaterialOptions({side: DoubleSide, wrap: ClampToEdgeWrapping}).parse(text, '/textures/')
    const request = (name: string) => {
        const result = requests.get(`/textures/${name}.png`)
        expect(result, `request for ${name}`).toBeDefined()
        return result!
    }
    return {creator, requests, request, load}
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('MTLLoader2 texture completion', () => {
    it('does not finish a material before a single slow image arrives', async() => {
        vi.useFakeTimers()
        const {creator, request} = controlledLoader('newmtl slow\nmap_Kd slow.png')
        let completed = false
        const done = creator.create('slow').then(material => { completed = true; return material })
        await vi.advanceTimersByTimeAsync(100)
        expect(completed).toBe(false)
        request('slow').resolve()
        expect((await done).map).toBe(request('slow').texture)
    })

    it('starts independent maps and materials together and waits past 50ms for every image', async() => {
        vi.useFakeTimers()
        const {creator, request, requests} = controlledLoader(`
newmtl first
Kd 0.5 0.25 0.75
Ks 0.1 0.2 0.3
Ns 42
d 0.6
Tr 0.9
map_Kd -s 2 3 1 -o 0.25 0.5 0 diffuse.png
map_Ks specular.png
newmtl second
map_Ke emissive.png
map_d alpha.png
`)
        let completed = false
        const done = creator.preload().then(() => { completed = true })
        expect(requests.size).toBe(4)
        await vi.advanceTimersByTimeAsync(100)
        expect(completed).toBe(false)
        request('alpha').resolve()
        request('emissive').resolve()
        request('specular').resolve()
        await vi.advanceTimersByTimeAsync(100)
        expect(completed).toBe(false)
        request('diffuse').resolve()
        await done

        const first = await creator.create('first')
        const second = await creator.create('second')
        expect(first.map).toBe(request('diffuse').texture)
        expect(first.specularMap).toBe(request('specular').texture)
        expect(first.map.repeat.toArray()).toEqual([2, 3])
        expect(first.map.offset.toArray()).toEqual([0.25, 0.5])
        expect(first.map.wrapS).toBe(ClampToEdgeWrapping)
        expect(first.map.wrapT).toBe(ClampToEdgeWrapping)
        expect(first.map.colorSpace).toBe(SRGBColorSpace)
        expect(first.specularMap.colorSpace).toBe(NoColorSpace)
        expect(first.color).toEqual(new Color(0.5, 0.25, 0.75).convertSRGBToLinear())
        expect(first.specular).toEqual(new Color(0.1, 0.2, 0.3).convertSRGBToLinear())
        expect(first.shininess).toBe(42)
        expect(first.opacity).toBe(0.6)
        expect(first.transparent).toBe(true)
        expect(first.side).toBe(DoubleSide)
        expect(second.emissiveMap).toBe(request('emissive').texture)
        expect(second.emissiveMap.colorSpace).toBe(SRGBColorSpace)
        expect(second.alphaMap).toBe(request('alpha').texture)
        expect(second.transparent).toBe(true)
    })

    it('loads getAsArray concurrently while retaining declaration order and indices', async() => {
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_Kd a.png\nnewmtl second\nmap_Kd b.png')
        const done = creator.getAsArray()
        expect(requests.size).toBe(2)
        request('b').resolve()
        request('a').resolve()
        const materials = await done
        expect(materials.map(material => material.name)).toEqual(['first', 'second'])
        expect(creator.getIndex('first')).toBe(0)
        expect(creator.getIndex('second')).toBe(1)
        expect(materials).toBe(creator.materialsArray)
    })

    it('shares in-flight creation and reuses completed materials across all entry points', async() => {
        const {creator, request, load} = controlledLoader('newmtl first\nmap_Kd a.png\nnewmtl second\nmap_Kd b.png')
        const first = creator.create('first')
        const repeated = creator.create('first')
        const preloaded = creator.preload()
        const array = creator.getAsArray()
        expect(load).toHaveBeenCalledTimes(2)
        request('b').resolve()
        request('a').resolve()
        await preloaded
        expect(await repeated).toBe(await first)
        expect((await array)[0]).toBe(await first)
        expect(await creator.create('first')).toBe(await first)
        await creator.preload()
        expect(await creator.getAsArray()).toBe(await array)
        expect(load).toHaveBeenCalledTimes(2)

        creator.setMaterials({first: {map_kd: 'replacement.png'}})
        const replaced = creator.create('first')
        request('replacement').resolve()
        expect(await replaced).not.toBe(await first)
        expect((await replaced).map).toBe(request('replacement').texture)
    })

    it('keeps a pending getAsArray result separate after setMaterials replaces its destinations', async() => {
        const {creator, request} = controlledLoader('newmtl first\nmap_Kd old.png')
        const oldArray = creator.materialsArray
        const oldLookup = creator.nameLookup
        const pending = creator.getAsArray()
        creator.setMaterials({replacement: {map_kd: 'new.png'}})
        const replacement = creator.getAsArray()
        request('new').resolve()
        const current = await replacement
        request('old').resolve()

        expect(await pending).toBe(oldArray)
        expect(oldArray.map(material => material.name)).toEqual(['first'])
        expect(oldLookup).toEqual({first: 0})
        expect(current).toBe(creator.materialsArray)
        expect(current).not.toBe(oldArray)
        expect(current.map(material => material.name)).toEqual(['replacement'])
        expect(creator.nameLookup).toEqual({replacement: 0})
    })

    it('accepts a synchronous cached texture callback', async() => {
        const {creator, load} = controlledLoader('newmtl cached\nmap_Kd a.png\nmap_Ke b.png')
        const textures: Texture[] = []
        load.mockImplementation((_url, onLoad) => {
            const texture = new Texture()
            textures.push(texture)
            onLoad(texture)
            return texture
        })
        const material = await creator.create('cached')
        expect(material.map).toBe(textures[0])
        expect(material.emissiveMap).toBe(textures[1])
        expect(await creator.create('cached')).toBe(material)
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('loads used OBJ materials together and keeps object order, reuse and unused maps intact', async() => {
        const {creator, request, requests, load} = controlledLoader('newmtl first\nmap_Kd a.png\nnewmtl second\nmap_Kd b.png\nnewmtl unused\nmap_Kd unused.png')
        const loader = new OBJLoader2(undefined).setMaterials(creator)
        const done = loader.parse(`
v 0 0 0
v 1 0 0
v 0 1 0
o firstObject
usemtl first
f 1 2 3
o secondObject
usemtl second
f 1 2 3
o repeatedObject
usemtl first
f 1 2 3
`)
        expect(requests.size).toBe(2)
        request('b').resolve()
        request('a').resolve()
        const object = await done
        expect(object.children.map(child => child.name)).toEqual(['firstObject', 'secondObject', 'repeatedObject'])
        expect(object.children[0].material).toBe(await creator.create('first'))
        expect(object.children[1].material).toBe(await creator.create('second'))
        expect(object.children[2].material).toBe(object.children[0].material)
        expect(load).toHaveBeenCalledTimes(2)
        expect(requests.has('/textures/unused.png')).toBe(false)
    })

    it('calls a custom OBJ factory for each material occurrence and preserves its distinct results', async() => {
        const materials = [new MeshPhongMaterial(), new MeshPhongMaterial(), new MeshPhongMaterial()]
        const finish: Array<() => void> = []
        const create = vi.fn((_name: string) => new Promise<MeshPhongMaterial>(resolve => {
            const material = materials[finish.length]
            finish.push(() => resolve(material))
        }))
        const pending = new OBJLoader2(undefined).setMaterials({create}).parse(`
v 0 0 0
v 1 0 0
v 0 1 0
o firstObject
usemtl same
f 1 2 3
usemtl same
f 1 2 3
o secondObject
usemtl same
f 1 2 3
`)
        expect(create.mock.calls).toEqual([['same'], ['same'], ['same']])
        finish[2]()
        finish[1]()
        finish[0]()
        const object = await pending
        expect(object.children.map(child => child.name)).toEqual(['firstObject', 'secondObject'])
        expect(object.children[0].material).toEqual([materials[0], materials[1]])
        expect(object.children[1].material).toBe(materials[2])
    })

    it('completes after failed images while retaining the other maps', async() => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_Kd missing.png\nnorm normal.png\nnewmtl second\nmap_d alpha.png')
        const done = creator.preload()
        expect(requests.size).toBe(3)
        request('missing').reject()
        request('normal').resolve()
        request('alpha').reject()
        await done
        const first = await creator.create('first')
        expect(first.map).toBeNull()
        expect(first.normalMap).toBe(request('normal').texture)
        const second = await creator.create('second')
        expect(second.alphaMap).toBeNull()
        expect(second.transparent).toBe(true)
        expect(warn).toHaveBeenCalledTimes(2)
    })

    it.each(['map_bump', 'bump'])('keeps the first %s alias and skips the later texture and its parameters', async(firstAlias) => {
        const secondAlias = firstAlias === 'bump' ? 'map_bump' : 'bump'
        const {creator, request, requests, load} = controlledLoader(`newmtl first\n${firstAlias} -bm 2 first.png\n${secondAlias} -bm 9 skipped.png\nmap_Kd diffuse.png`)
        const done = creator.create('first')
        expect(requests.size).toBe(2)
        request('diffuse').resolve()
        request('first').resolve()
        const material = await done
        expect(material.bumpMap).toBe(request('first').texture)
        expect(material.bumpScale).toBe(2)
        expect(load).toHaveBeenCalledTimes(2)
        expect(requests.has('/textures/skipped.png')).toBe(false)
    })

    it('tries the next alias after failure and applies -bm in source order despite completion order', async() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_bump -bm 2 missing.png\nbump -bm 3 fallback.png\nmap_Ks -bm 4 specular.png')
        const done = creator.create('first')
        expect(requests.size).toBe(2)
        request('specular').resolve()
        request('missing').reject()
        await Promise.resolve()
        request('fallback').resolve()
        const material = await done
        expect(material.bumpMap).toBe(request('fallback').texture)
        expect(material.specularMap).toBe(request('specular').texture)
        expect(material.bumpScale).toBe(4)
    })

    it('allows retry after a loader throws instead of caching the rejected creation', async() => {
        const {creator, load, request} = controlledLoader('newmtl first\nmap_Kd a.png')
        load.mockImplementationOnce(() => { throw new Error('handler failed') })
        await expect(creator.create('first')).rejects.toThrow('handler failed')
        const retry = creator.create('first')
        request('a').resolve()
        expect((await retry).map).toBe(request('a').texture)
        expect(load).toHaveBeenCalledTimes(2)
    })
})
