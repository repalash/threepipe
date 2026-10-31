/**
 * ViewOverridesPlugin: the material views and lighting presets are applied only between the viewer's `preRender` and
 * `postRender` events, and everything they change (the render pass override material, the override environment, the
 * scene light layers, the fat line materials) is restored after each render, when turned off and when the plugin is
 * removed. No WebGL: a small viewer with the parts the plugin uses.
 */
import {beforeAll, describe, expect, test, vi} from 'vitest'
import {EventDispatcher, Material, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Texture} from 'three'

let tp: typeof import('threepipe')
// a cold import of the package entry can take longer than the default 10 s hook timeout
const timeout = 60_000
beforeAll(async() => {
    tp = await import('threepipe')
}, timeout)

interface RenderState {
    overrideMaterial: Material | null
    overrideEnvironment: Texture | null
    sceneLightMask: number
    lineAllowOverride: boolean
    lightsRootVisible: boolean
    presetLights: number
}

/** A viewer with what the plugin uses, a model, a scene light and a fat line */
function setup(importer: (url: string) => Promise<any> = async() => new Texture()) {
    const scene = new Scene() as any
    scene.modelRoot = new Object3D()
    scene.add(scene.modelRoot)
    scene.overrideRenderEnvironment = null
    scene.environment = null
    scene.mainCamera = new PerspectiveCamera(45, 1, 0.1, 100)
    scene.mainCamera.position.set(0, 0, 10)
    scene.add(scene.mainCamera)
    scene.addObject = (o: Object3D, opts: any) => (opts?.addToRoot ? scene : scene.modelRoot).add(o)

    const mesh = new Mesh(new tp.BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    scene.modelRoot.add(mesh)
    const sceneLight = new tp.DirectionalLight2(0xffffff, 1)
    scene.add(sceneLight)
    const line = new Mesh(undefined, new tp.LineMaterial2())
    scene.modelRoot.add(line)

    const viewer = new EventDispatcher() as any
    viewer.scene = scene
    viewer.renderManager = {renderPass: {overrideMaterial: null}}
    viewer.dirty = 0
    viewer.setDirty = () => viewer.dirty++
    viewer.import = vi.fn(importer)
    viewer.console = {error: vi.fn()}

    const plugin = new tp.ViewOverridesPlugin()
    plugin.onAdded(viewer)

    /** Renders one frame and returns the state seen during it */
    const render = (): RenderState => {
        viewer.dispatchEvent({type: 'preRender'})
        const state = {
            overrideMaterial: viewer.renderManager.renderPass.overrideMaterial,
            overrideEnvironment: scene.overrideRenderEnvironment,
            sceneLightMask: sceneLight.layers.mask,
            lineAllowOverride: line.material.allowOverride,
            lightsRootVisible: plugin.lightsRoot.visible,
            presetLights: plugin.lightsRoot.children.length,
        }
        viewer.dispatchEvent({type: 'postRender'})
        return state
    }
    /** The state outside a render: what the user, an export and the UI see */
    const real = () => ({
        overrideMaterial: viewer.renderManager.renderPass.overrideMaterial,
        overrideEnvironment: scene.overrideRenderEnvironment,
        sceneLightMask: sceneLight.layers.mask,
        lineAllowOverride: line.material.allowOverride,
    })
    return {plugin, viewer, scene, sceneLight, line, render, real}
}

const untouched = {overrideMaterial: null, overrideEnvironment: null, sceneLightMask: 1, lineAllowOverride: true}

describe('ViewOverridesPlugin', {timeout}, () => {
    test('a material view applies only during a render and restores the previous override material', () => {
        const {plugin, viewer, render, real} = setup()
        const own = new MeshBasicMaterial()
        viewer.renderManager.renderPass.overrideMaterial = own // e.g. a clay view of the app
        expect(render().overrideMaterial).toBe(own)

        for (const type of plugin.materialTypes.map(m => m.key)) {
            plugin.setMaterial(type)
            const during = render()
            expect(during.overrideMaterial).not.toBe(own)
            expect(during.overrideMaterial?.name).toBe('View Override')
            expect(during.sceneLightMask).toBe(1) // lights untouched
            expect(real().overrideMaterial).toBe(own)
        }
        expect(plugin.material).toBe('uv')
        expect(plugin.active).toBe(true)

        plugin.setMaterial(null)
        expect(render().overrideMaterial).toBe(own)
        expect(plugin.active).toBe(false)
    })

    test('fat lines keep their own material in a material view', () => {
        const {plugin, line, render, real} = setup()
        expect(render().lineAllowOverride).toBe(true)
        plugin.setMaterial('normal')
        expect(render().lineAllowOverride).toBe(false)
        expect(real().lineAllowOverride).toBe(true)

        // a line material that opted out itself stays out
        line.material.allowOverride = false
        render()
        expect(line.material.allowOverride).toBe(false)
    })

    test('a lights preset hides the scene lights and the environment during a render', async() => {
        const {plugin, render, real} = setup()
        await plugin.setLighting('lights-studio')
        expect(plugin.lighting).toBe('lights-studio')
        const during = render()
        expect(during.sceneLightMask).toBe(0)
        expect(during.lightsRootVisible).toBe(true)
        expect(during.presetLights).toBe(4)
        expect(during.overrideEnvironment?.name).toBe('View Override No Environment')
        expect(during.overrideMaterial).toBe(null)
        expect(real()).toEqual(untouched)
    })

    test('lightsKeepEnvironment keeps the scene environment with the preset lights', async() => {
        const {plugin, render} = setup()
        plugin.lightsKeepEnvironment = true
        await plugin.setLighting('lights-day')
        const during = render()
        expect(during.overrideEnvironment).toBe(null)
        expect(during.sceneLightMask).toBe(0)
        expect(during.presetLights).toBe(2)
    })

    test('an env preset loads its map once, shows loading, and is applied when loaded', async() => {
        const tex = new Texture()
        const {plugin, viewer, render, real} = setup(async() => tex)
        const changes: string[] = []
        plugin.addEventListener('change', () => changes.push(plugin.loading ?? plugin.lighting ?? 'none'))

        const p = plugin.setLighting('env-studio')
        expect(plugin.loading).toBe('env-studio')
        expect(plugin.lighting).toBe(null)
        await p
        expect(plugin.loading).toBe(null)
        expect(plugin.lighting).toBe('env-studio')
        expect(changes).toEqual(['env-studio', 'env-studio'])
        const during = render()
        expect(during.overrideEnvironment).toBe(tex)
        expect(during.sceneLightMask).toBe(0)
        expect(during.presetLights).toBe(0)
        expect(real()).toEqual(untouched)

        await plugin.setLighting(null)
        await plugin.setLighting('env-studio')
        expect(viewer.import).toHaveBeenCalledTimes(1) // cached
        await plugin.setLighting('env-indoors')
        expect(viewer.import).toHaveBeenCalledTimes(2)
    })

    test('a map that does not load keeps the current view and is tried again next time', async() => {
        let fail = true
        const {plugin, viewer, render} = setup(async() => {
            if (fail) throw new Error('404')
            return new Texture()
        })
        await plugin.setLighting('lights-night')
        await plugin.setLighting('env-day')
        expect(viewer.console.error).toHaveBeenCalledTimes(1)
        expect(plugin.loading).toBe(null)
        expect(plugin.lighting).toBe('lights-night')
        expect(render().presetLights).toBe(2)

        plugin.setMaterial('normal')
        await plugin.setLighting('env-day')
        expect(plugin.material).toBe('normal')
        expect(render().overrideMaterial?.name).toBe('View Override')

        fail = false
        await plugin.setLighting('env-day')
        expect(plugin.lighting).toBe('env-day')
        expect(viewer.import).toHaveBeenCalledTimes(3)
    })

    test('the last choice wins while a map loads', async() => {
        let resolve!: (t: Texture) => void
        const {plugin, render} = setup(() => new Promise(r => resolve = r))
        const p = plugin.setLighting('env-night')
        plugin.setMaterial('depth') // turns the lighting off
        expect(plugin.loading).toBe(null)
        resolve(new Texture())
        await p
        expect(plugin.lighting).toBe(null)
        expect(plugin.material).toBe('depth')
        const during = render()
        expect(during.overrideEnvironment).toBe(null)
        expect(during.sceneLightMask).toBe(1)
    })

    test('a material view and a lighting preset are exclusive', async() => {
        const {plugin, render} = setup()
        plugin.setMaterial('unlit')
        await plugin.setLighting('lights-day')
        expect(plugin.material).toBe(null)
        expect(render().overrideMaterial).toBe(null)

        const lights = [...plugin.lightsRoot.children] as any[]
        const disposed = lights.map(l => vi.spyOn(l, 'dispose'))
        plugin.setMaterial('materialId')
        expect(plugin.lighting).toBe(null)
        expect(plugin.lightsRoot.children.length).toBe(0)
        expect(plugin.lightsRoot.visible).toBe(false)
        for (const d of disposed) expect(d).toHaveBeenCalled()
        const during = render()
        expect(during.sceneLightMask).toBe(1)
        expect(during.overrideMaterial?.name).toBe('View Override')
    })

    test('clear turns everything off', async() => {
        const {plugin, render, real} = setup()
        await plugin.setLighting('lights-studio')
        plugin.clear()
        expect(plugin.active).toBe(false)
        expect({...render(), lightsRootVisible: undefined, presetLights: undefined}).toEqual({...untouched, lightsRootVisible: undefined, presetLights: undefined})
        expect(real()).toEqual(untouched)
    })

    test('disabled, the scene renders as it is; enabled again, the view comes back', async() => {
        const {plugin, viewer, render} = setup()
        await plugin.setLighting('lights-day')
        const dirty = viewer.dirty
        plugin.enabled = false
        expect(viewer.dirty).toBe(dirty + 1)
        expect(render().sceneLightMask).toBe(1)
        expect(render().overrideEnvironment).toBe(null)
        plugin.enabled = true
        expect(render().sceneLightMask).toBe(0)
    })

    test('uvChannel selects the UV set of the uv view', () => {
        const {plugin, render} = setup()
        plugin.setMaterial('uv')
        const material = render().overrideMaterial as any
        expect(plugin.uvChannel).toBe(0)
        expect(material.customProgramCacheKey()).toBe('view-override-uv-0')
        const version = material.version
        let changes = 0
        plugin.addEventListener('change', () => changes++)
        plugin.uvChannel = 2
        expect(material.customProgramCacheKey()).toBe('view-override-uv-2')
        expect(material.version).toBeGreaterThan(version)
        expect(changes).toBe(1)
        plugin.uvChannel = 2
        expect(changes).toBe(1)
    })

    test('the depth view fits its range to the models along the view direction', () => {
        const {plugin, render} = setup()
        plugin.setMaterial('depth')
        const material = render().overrideMaterial as any
        // a 2x2x2 box at the origin, the camera at z = 10 looking at it
        expect(material.depthNear.value).toBeCloseTo(9)
        expect(material.depthFar.value).toBeCloseTo(11)
    })

    test('removing the plugin restores the scene, removes the lights root and its listeners', async() => {
        const used = new Texture(), unused = new Texture()
        const {plugin, viewer, scene, render, real} = setup(async(url: string) => url.includes('studio') ? used : unused)
        await plugin.setLighting('env-studio')
        await plugin.setLighting('env-indoors')
        scene.environment = used // the app set the same map as its environment
        const disposeUsed = vi.spyOn(used, 'dispose'), disposeUnused = vi.spyOn(unused, 'dispose')
        await plugin.setLighting('lights-studio')

        viewer.dispatchEvent({type: 'preRender'}) // removed during a render
        expect(real().sceneLightMask).toBe(0)
        plugin.onRemove(viewer)
        expect(real()).toEqual(untouched)
        expect(plugin.active).toBe(false)
        expect(plugin.lightsRoot.parent).toBe(null)
        expect(render().sceneLightMask).toBe(1)
        await Promise.resolve()
        await Promise.resolve()
        expect(disposeUnused).toHaveBeenCalled()
        expect(disposeUsed).not.toHaveBeenCalled()
    })

    test('the UI dropdowns set and show the views; the state is not saved with the viewer', async() => {
        const {plugin} = setup()
        expect(plugin.serializeWithViewer).toBe(false)
        const children = plugin.uiConfig.children as any[]
        const material = children.find(c => c.label === 'Material')
        const lighting = children.find(c => c.label === 'Lighting')
        const uvSet = children.find(c => c.label === 'UV Set')
        expect(material.children[0]().map((o: any) => o.value)).toEqual(['none', 'unlit', 'depth', 'normal', 'normalWorld', 'materialId', 'uv'])
        material.setValue('uv')
        expect(plugin.material).toBe('uv')
        expect(uvSet.hidden()).toBe(false)
        material.setValue('none')
        expect(plugin.material).toBe(null)
        expect(material.getValue()).toBe('none')
        expect(uvSet.hidden()).toBe(true)

        expect(lighting.children[0]().length).toBe(plugin.lightingPresets.length + 1)
        lighting.setValue('lights-night')
        await Promise.resolve()
        expect(plugin.lighting).toBe('lights-night')
        expect(lighting.getValue()).toBe('lights-night')
    })

    test('the preset lights are hidden outside a render, and while the plugin is disabled', async() => {
        const {plugin, render} = setup()
        await plugin.setLighting('lights-studio')
        expect(plugin.lightsRoot.visible).toBe(false)
        expect(render().lightsRootVisible).toBe(true)
        expect(plugin.lightsRoot.visible).toBe(false)
        plugin.enabled = false
        const during = render()
        expect(during.lightsRootVisible).toBe(false)
        expect(during.sceneLightMask).toBe(1)
        plugin.enabled = true
        expect(render().lightsRootVisible).toBe(true)
    })

    test('a lights preset chosen while an environment map loads clears the loading state', async() => {
        let resolve!: (t: Texture) => void
        const {plugin, render} = setup(() => new Promise(r => resolve = r))
        const env = plugin.setLighting('env-night')
        expect(plugin.loading).toBe('env-night')
        await plugin.setLighting('lights-day')
        expect(plugin.loading).toBe(null)
        expect(plugin.lighting).toBe('lights-day')
        const lighting = (plugin.uiConfig.children as any[]).find(c => c.label === 'Lighting')
        expect(lighting.getValue()).toBe('lights-day')
        resolve(new Texture())
        await env
        expect(plugin.loading).toBe(null)
        expect(plugin.lighting).toBe('lights-day')
        expect(render().presetLights).toBe(2)
    })

    test('the world normal view converts the final view-space normal of the normal view to world space', () => {
        const {plugin, render} = setup()
        plugin.setMaterial('normalWorld')
        const material = render().overrideMaterial as any
        const vertexShader = tp.ShaderLib.normal.vertexShader
        const fragmentShader = tp.ShaderLib.normal.fragmentShader
        const shader = {uniforms: {}, vertexShader, fragmentShader}
        material.onBeforeCompile(shader)
        // the normal after the normal and bump maps, the back face flip, skinning, morphs and the normal matrix
        expect(shader.fragmentShader).toContain('gl_FragColor = vec4( packNormalToRGB( normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ) ), diffuseColor.a );')
        expect(shader.fragmentShader.indexOf('viewMatrix ).xyz')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <normal_fragment_maps>'))
        // no world normal from the object normal and the model matrix (wrong for a non-uniform scale)
        expect(shader.vertexShader).toBe(vertexShader)
    })

    test('the preset directional lights point from their position to the scene centre', async() => {
        const {plugin} = setup()
        await plugin.setLighting('lights-studio')
        plugin.lightsRoot.updateMatrixWorld(true)
        const lights = plugin.lightsRoot.children.filter((l: any) => l.isDirectionalLight) as any[]
        expect(lights.length).toBe(3) // key, fill, back
        const directions = lights.map(l => {
            const from = l.getWorldPosition(new tp.Vector3())
            const direction = l.target.getWorldPosition(new tp.Vector3()).sub(from).normalize()
            // towards the origin
            expect(direction.dot(from.clone().negate().normalize())).toBeCloseTo(1, 5)
            return direction
        })
        expect(directions[0].dot(directions[1])).toBeLessThan(0.99)
        expect(directions[0].dot(directions[2])).toBeLessThan(0.99)
        expect(directions[1].dot(directions[2])).toBeLessThan(0.99)
    })

    test('the shared override materials get a new program exactly when the program state of the next mesh differs', () => {
        const {plugin} = setup()
        const renderer = {resetCurrentMaterial: vi.fn()} as any
        const camera = new PerspectiveCamera()
        const mesh = (params: any = {}) => new Mesh(new tp.BoxGeometry(), new MeshBasicMaterial(params))
        // three.js picks the program again only when the material version changed since the last draw
        const draw = (material: any, m: any) => {
            material.onBeforeRender(renderer, m.parent, camera, m.geometry, m, null)
            const version = material.version
            material.onAfterRender(renderer, m.parent, camera, m.geometry, m, null)
            return version
        }
        const textured = mesh({map: new Texture()}), plain = mesh(), plain2 = mesh()
        const unlit = (plugin as any)._materials.unlit
        const v1 = draw(unlit, textured)
        const v2 = draw(unlit, plain)
        expect(v2).not.toBe(v1) // no map: the program without the map define
        expect(draw(unlit, plain2)).toBe(v2) // the same program state: no new program
        expect(draw(unlit, textured)).not.toBe(v2)

        // alpha map, alpha hash and side are program defines too, for each per-mesh override material
        for (const key of ['unlit', 'materialId', 'uv']) {
            const material = (plugin as any)._materials[key]
            const a = draw(material, plain)
            const b = draw(material, mesh({alphaMap: new Texture()}))
            expect(b).not.toBe(a)
            const c = draw(material, mesh({side: tp.DoubleSide}))
            expect(c).not.toBe(b)
            const d = draw(material, mesh({alphaHash: true}))
            expect(d).not.toBe(c)
            const e = draw(material, plain)
            expect(e).not.toBe(d)
            expect(draw(material, plain2)).toBe(e)
        }
    })

    test('the texture UV channels, transparent and the other copied program parameters select the program too', () => {
        const {plugin} = setup()
        const renderer = {resetCurrentMaterial: vi.fn()} as any
        const camera = new PerspectiveCamera()
        const draw = (material: any, m: any) => {
            material.onBeforeRender(renderer, m.parent, camera, m.geometry, m, null)
            const version = material.version
            material.onAfterRender(renderer, m.parent, camera, m.geometry, m, null)
            return version
        }
        const texture = (channel: number) => Object.assign(new Texture(), {channel})
        const mesh = (params: any = {}) => new Mesh(new tp.BoxGeometry(), new MeshBasicMaterial(params))
        const unlit = (plugin as any)._materials.unlit
        for (const name of ['map', 'aoMap', 'lightMap', 'alphaMap']) {
            const a = draw(unlit, mesh({[name]: texture(0)}))
            const b = draw(unlit, mesh({[name]: texture(1)})) // the same maps, another UV set
            expect(b).not.toBe(a)
            expect(draw(unlit, mesh({[name]: texture(1)}))).toBe(b)
        }
        for (const key of ['materialId', 'uv']) {
            const material = (plugin as any)._materials[key]
            const a = draw(material, mesh({alphaMap: texture(0)}))
            const b = draw(material, mesh({alphaMap: texture(2)}))
            expect(b).not.toBe(a)
            const c = draw(material, mesh({alphaMap: texture(2), transparent: true})) // the opaque parameter
            expect(c).not.toBe(b)
            expect(draw(material, mesh({alphaMap: texture(2), transparent: true}))).toBe(c)
        }
    })
})
