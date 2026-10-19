import {afterEach, describe, expect, it, vi} from 'vitest'
import {ClampToEdgeWrapping, DoubleSide, Loader, LoadingManager, SRGBColorSpace, Texture} from 'three'
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
})
