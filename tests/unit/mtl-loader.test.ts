import {afterEach, describe, expect, it, vi} from 'vitest'
import {ClampToEdgeWrapping, DoubleSide, Loader, LoadingManager, MeshPhongMaterial, SRGBColorSpace, Texture} from 'three'
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

    it('starts independent maps and materials together and waits for every image', async() => {
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_Kd -s 2 3 1 diffuse.png\nmap_Ks specular.png\nnewmtl second\nmap_Ke emissive.png\nmap_d alpha.png')
        let completed = false
        const done = creator.preload().then(() => { completed = true })
        expect(requests.size).toBe(4)
        request('alpha').resolve()
        request('emissive').resolve()
        request('specular').resolve()
        await Promise.resolve()
        expect(completed).toBe(false)
        request('diffuse').resolve()
        await done
        const first = await creator.create('first')
        const second = await creator.create('second')
        expect(first.map).toBe(request('diffuse').texture)
        expect(first.map.repeat.toArray()).toEqual([2, 3])
        expect(first.map.colorSpace).toBe(SRGBColorSpace)
        expect(first.specularMap).toBe(request('specular').texture)
        expect(second.emissiveMap).toBe(request('emissive').texture)
        expect(second.alphaMap).toBe(request('alpha').texture)
    })

    it('shares an in-flight material between callers', async() => {
        const {creator, request, load} = controlledLoader('newmtl first\nmap_Kd a.png')
        const first = creator.create('first')
        const repeated = creator.create('first')
        const preloaded = creator.preload()
        expect(load).toHaveBeenCalledTimes(1)
        request('a').resolve()
        await preloaded
        expect(await repeated).toBe(await first)
        expect(await creator.create('first')).toBe(await first)
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

    it.each([true, false])('isolates same-name material caches across reset (old finishes first: %s)', async(oldFirst) => {
        const {creator, request} = controlledLoader('newmtl first\nmap_Kd old.png')
        const old = creator.create('first')
        creator.setMaterials({first: {map_kd: 'new.png'}})
        const current = creator.create('first')

        request(oldFirst ? 'old' : 'new').resolve()
        await (oldFirst ? old : current)
        const reused = creator.create('first')
        request(oldFirst ? 'new' : 'old').resolve()
        const [oldMaterial, currentMaterial] = await Promise.all([old, current])

        expect(await reused).toBe(currentMaterial)
        expect(await creator.create('first')).toBe(currentMaterial)
        expect(oldMaterial.map).toBe(request('old').texture)
        expect(currentMaterial.map).toBe(request('new').texture)
    })

    it('completes after failed images while keeping the other maps', async() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const {creator, request} = controlledLoader('newmtl first\nmap_Kd missing.png\nnorm normal.png')
        const done = creator.create('first')
        request('missing').reject()
        request('normal').resolve()
        const material = await done
        expect(material.map).toBeNull()
        expect(material.normalMap).toBe(request('normal').texture)
    })

    it('tries the next bump alias only after the first fails', async() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_bump missing.png\nbump fallback.png')
        const done = creator.create('first')
        expect(requests.size).toBe(1)
        request('missing').reject()
        await new Promise(resolve => setTimeout(resolve))
        request('fallback').resolve()
        expect((await done).bumpMap).toBe(request('fallback').texture)
    })

    it('loads used OBJ materials together, keeps object order and skips unused materials', async() => {
        const {creator, request, requests} = controlledLoader('newmtl first\nmap_Kd a.png\nnewmtl second\nmap_Kd b.png\nnewmtl unused\nmap_Kd unused.png')
        const done = new OBJLoader2(undefined).setMaterials(creator).parse(`
v 0 0 0
v 1 0 0
v 0 1 0
o firstObject
usemtl first
f 1 2 3
o secondObject
usemtl second
f 1 2 3
`)
        expect(requests.size).toBe(2)
        request('b').resolve()
        request('a').resolve()
        const object = await done
        expect(object.children.map(child => child.name)).toEqual(['firstObject', 'secondObject'])
        expect(object.children[0].material).toBe(await creator.create('first'))
        expect(object.children[1].material).toBe(await creator.create('second'))
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
})
