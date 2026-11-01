/**
 * ViewOverridesPlugin: the material views and lighting presets are applied only between the viewer's `preRender` and
 * `postRender` events, and everything they change (the render pass override material, the override environment, the
 * scene light layers, the fat line materials) is restored after each render, when turned off and when the plugin is
 * removed. Fat lines draw with a line variant of their line material in the depth, material ID, normal and UV views.
 * No WebGL: a small viewer with the parts the plugin uses.
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
    /** The material that draws the threepipe fat line in this render */
    fatLineMaterial: any
    lightsRootVisible: boolean
    presetLights: number
}

/** A viewer with what the plugin uses, a model, a scene light, a fat line not upgraded and a threepipe fat line */
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
    const fatLineGeometry = new tp.LineGeometry2()
    fatLineGeometry.setPositions([-1, 0, 0, 1, 0, 0])
    const fatLine = new tp.MeshLine(fatLineGeometry, new tp.LineMaterial2({color: '#ff6b3d', linewidth: 4}))
    const fatLineMaterial = fatLine.material
    scene.modelRoot.add(fatLine)

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
            fatLineMaterial: fatLine.material,
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
        fatLineOwn: fatLine.material === fatLineMaterial && fatLine.forcedOverrideMaterial === undefined &&
            fatLineMaterial.allowOverride,
    })
    return {plugin, viewer, scene, sceneLight, line, fatLine, fatLineMaterial, render, real}
}

const untouched = {overrideMaterial: null, overrideEnvironment: null, sceneLightMask: 1, lineAllowOverride: true, fatLineOwn: true}

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

    test('a fat line that is not a threepipe object keeps its own material in a material view', () => {
        const {plugin, line, render, real} = setup()
        expect(render().lineAllowOverride).toBe(true)
        plugin.setMaterial('normal')
        expect(render().lineAllowOverride).toBe(false)
        expect(real().lineAllowOverride).toBe(true)
        expect((line as any).forcedOverrideMaterial).toBe(undefined)

        // a line material that opted out itself stays out
        line.material.allowOverride = false
        render()
        expect(line.material.allowOverride).toBe(false)
    })

    test('the unlit view draws a fat line with its own material', () => {
        const {plugin, viewer, fatLine, fatLineMaterial, real} = setup()
        plugin.setMaterial('unlit')
        viewer.dispatchEvent({type: 'preRender'})
        expect(fatLine.material).toBe(fatLineMaterial)
        expect(fatLineMaterial.allowOverride).toBe(false) // kept out of the override material
        viewer.dispatchEvent({type: 'postRender'})
        expect(real()).toEqual(untouched)
    })

    /** Compiles a line variant as three.js does: the uniforms and shaders of MeshBasicMaterial, then onBeforeCompile */
    const compile = (variant: any) => {
        const basic = tp.ShaderLib.basic
        const shader = {uniforms: tp.UniformsUtils.clone(basic.uniforms), vertexShader: basic.vertexShader, fragmentShader: basic.fragmentShader, defines: undefined as any}
        variant.onBeforeCompile(shader)
        return shader
    }

    test('the depth view draws a fat line with the line shader and the depth range of the meshes', () => {
        const {plugin, fatLine, fatLineMaterial, render, real} = setup()
        fatLineMaterial.dashed = true
        plugin.setMaterial('depth')
        const during = render()
        const variant = during.fatLineMaterial
        const depth = during.overrideMaterial as any
        expect(variant).not.toBe(fatLineMaterial)
        expect(variant.name).toBe('View Override Line')
        expect(variant.allowOverride).toBe(false) // not replaced by the override material of the render pass
        expect(variant.lineMaterial).toBe(fatLineMaterial)
        expect(variant.depthRange).toBe(depth)
        expect(real()).toEqual(untouched)
        expect(fatLine.material).toBe(fatLineMaterial)

        const shader = compile(variant)
        // the same uniforms as the depth material of the meshes: the same range in each frame
        expect(shader.uniforms.depthNear).toBe(depth.depthNear)
        expect(shader.uniforms.depthFar).toBe(depth.depthFar)
        expect(shader.uniforms.depthNear.value).toBeCloseTo(9)
        expect(shader.uniforms.depthFar.value).toBeCloseTo(11)
        // the width and dashes of the line material, the viewport size of the variant
        expect(shader.uniforms.linewidth).toBe(fatLineMaterial.uniforms.linewidth)
        expect(shader.uniforms.dashSize).toBe(fatLineMaterial.uniforms.dashSize)
        expect(shader.uniforms.resolution).toBe(variant.resolution)
        expect(shader.defines.USE_DASH).toBe('')
        // the vertex shader of the line, with the view depth
        expect(shader.vertexShader).toContain('attribute vec3 instanceStart;')
        expect(shader.vertexShader).toContain('vViewOverrideZ = -mvPosition.z;')
        expect(shader.fragmentShader).toContain('discard; // discard endcaps')
        expect(shader.fragmentShader).toContain('gl_FragColor = vec4( vec3( 1.0 - viewOverrideDepth ), alpha );')
        expect(shader.fragmentShader).not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );')

        // the same variant in the next render
        expect(render().fatLineMaterial).toBe(variant)
    })

    test('the material ID view draws a fat line in the colour of its material id, the normal and UV views in grey and magenta', () => {
        const {plugin, fatLineMaterial, render, real} = setup()
        fatLineMaterial.transparent = true
        fatLineMaterial.opacity = 0.5
        plugin.setMaterial('materialId')
        const ids = (plugin as any)._materials.materialId
        let variant = render().fatLineMaterial
        expect(variant.lineMaterial).toBe(fatLineMaterial)
        expect(variant.depthRange).toBe(undefined)
        expect(variant.color.getHex()).toBe(ids.colorFor(fatLineMaterial.id).getHex())
        // the blend settings of the line material, as the meshes keep theirs in this view
        expect(variant.transparent).toBe(true)
        expect(variant.opacity).toBe(0.5)
        const shader = compile(variant)
        // the diffuse uniform of the variant (three.js sets it from its color), not the one of the line
        expect(shader.uniforms.diffuse).not.toBe(fatLineMaterial.uniforms.diffuse)
        expect(shader.uniforms.opacity).not.toBe(fatLineMaterial.uniforms.opacity)
        expect(shader.uniforms.linewidth).toBe(fatLineMaterial.uniforms.linewidth)
        expect(shader.fragmentShader).toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );') // the output of the line
        expect(real()).toEqual(untouched)

        plugin.setMaterial('normal')
        variant = render().fatLineMaterial
        expect(variant.color.toArray()).toEqual([0.5, 0.5, 0.5]) // the colour of a zero normal
        expect(variant.blending).toBe(tp.NoBlending) // as the normal material of the meshes
        expect(variant.transparent).toBe(false)
        plugin.setMaterial('normalWorld')
        expect(render().fatLineMaterial.color.toArray()).toEqual([0.5, 0.5, 0.5])
        plugin.setMaterial('uv')
        variant = render().fatLineMaterial
        expect(variant.color.getHex()).toBe(0xff00ff) // as a mesh without the UV set
        expect(variant.transparent).toBe(true)
        expect(real()).toEqual(untouched)
    })

    test('a line variant gets a new program when a define or program setting of the line material changes', () => {
        const {plugin, fatLineMaterial, render} = setup()
        plugin.setMaterial('depth')
        const variant = render().fatLineMaterial
        const key = variant.customProgramCacheKey()
        let version = variant.version
        render()
        expect(variant.version).toBe(version) // nothing changed: the same program
        for (const change of [() => fatLineMaterial.dashed = true, () => fatLineMaterial.worldUnits = true,
            () => fatLineMaterial.alphaToCoverage = true, () => fatLineMaterial.side = tp.DoubleSide]) {
            change()
            render()
            expect(variant.version).toBeGreaterThan(version)
            version = variant.version
        }
        expect(variant.customProgramCacheKey()).not.toBe(key)
        expect(variant.customProgramCacheKey()).toContain('USE_DASH')
        expect(variant.customProgramCacheKey()).toContain('WORLD_UNITS')
        expect(variant.alphaToCoverage).toBe(true)
        expect(variant.side).toBe(tp.DoubleSide)
    })

    test('a line variant takes the viewport size as its line material does', () => {
        const {plugin, fatLineMaterial, render} = setup()
        plugin.setMaterial('materialId')
        const variant = render().fatLineMaterial
        const renderer = {getSize: (v: any) => v.set(800, 600)} as any
        variant.onBeforeRender(renderer, null, null, null, null, null)
        expect(variant.resolution.value.toArray()).toEqual([800, 600])
        expect(fatLineMaterial.resolution.toArray()).toEqual([1, 1]) // the line material does not change
        fatLineMaterial.autoUpdateResolution = false
        fatLineMaterial.resolution.set(300, 200)
        variant.onBeforeRender(renderer, null, null, null, null, null)
        expect(variant.resolution.value.toArray()).toEqual([300, 200])
    })

    test('a GBuffer pass in the render puts the line variant back after its own line material', () => {
        const {plugin, viewer, fatLine, real} = setup()
        plugin.setMaterial('depth')
        const pass = new tp.GBufferRenderPass('gbuffer', undefined, new MeshBasicMaterial())
        viewer.dispatchEvent({type: 'preRender'})
        const variant = fatLine.material
        expect(variant.name).toBe('View Override Line')
        pass.preprocessObject(fatLine)
        expect(fatLine.material).toBe(fatLine.customDepthMaterial)
        pass.postprocessObject(fatLine)
        expect(fatLine.material).toBe(variant) // the main render pass draws the variant
        viewer.dispatchEvent({type: 'postRender'})
        expect(real()).toEqual(untouched)
        // without the plugin, the pass leaves no forced material
        pass.preprocessObject(fatLine)
        pass.postprocessObject(fatLine)
        expect(real()).toEqual(untouched)
    })

    test('removing the plugin disposes the line variants', () => {
        const {plugin, viewer, render} = setup()
        plugin.setMaterial('depth')
        const depth = render().fatLineMaterial
        plugin.setMaterial('materialId')
        const color = render().fatLineMaterial
        expect(color).not.toBe(depth)
        const disposeDepth = vi.spyOn(depth, 'dispose'), disposeColor = vi.spyOn(color, 'dispose')
        plugin.onRemove(viewer)
        expect(disposeDepth).toHaveBeenCalled()
        expect(disposeColor).toHaveBeenCalled()
        expect((plugin as any)._lineVariants.size).toBe(0)
    })

    test('line segments, a shared line material and a line material array', () => {
        const {plugin, scene, fatLineMaterial, render, real} = setup()
        const segmentsGeometry = new tp.LineSegmentsGeometry2()
        segmentsGeometry.setPositions([-1, 1, 0, 1, 1, 0])
        const segments = new tp.MeshLineSegments(segmentsGeometry, fatLineMaterial) // shares the material of fatLine
        const other = new tp.LineMaterial2()
        const multi = new tp.MeshLine(new tp.LineGeometry2(), [other, new MeshBasicMaterial()] as any)
        scene.modelRoot.add(segments, multi)
        plugin.setMaterial('depth')
        const pre = () => (plugin as any)._preRender(), post = () => (plugin as any)._postRender()
        pre()
        const variant = segments.material as any
        expect(variant.name).toBe('View Override Line')
        expect(variant.lineMaterial).toBe(fatLineMaterial)
        expect((plugin as any)._lineVariants.size).toBe(2) // one for the shared material, one for `other`
        const mats = multi.material as any
        expect(Array.isArray(mats)).toBe(true)
        expect(mats[0].lineMaterial).toBe(other)
        expect(mats[1]).toBeInstanceOf(MeshBasicMaterial) // not a line material: the override material replaces it
        post()
        expect(segments.material).toBe(fatLineMaterial)
        expect(multi.material[0]).toBe(other)
        expect((segments as any).forcedOverrideMaterial).toBe(undefined)
        expect((multi as any).forcedOverrideMaterial).toBe(undefined)
        expect(real()).toEqual(untouched)
        expect(render().fatLineMaterial).toBe(variant) // fatLine and segments draw with the same variant
    })

    test('a forced override material that the object had is put back after the render', () => {
        const {plugin, fatLine, fatLineMaterial, render} = setup()
        const forced = new tp.LineMaterial2()
        ;(fatLine as any).forcedOverrideMaterial = forced
        plugin.setMaterial('materialId')
        const variant = render().fatLineMaterial
        expect(variant.lineMaterial).toBe(forced) // the material that would draw
        expect(fatLine.material).toBe(forced)
        expect(fatLine.currentMaterial).toBe(fatLineMaterial)
    })

    test('the variants of a line material that no line uses any more are disposed; a hidden line keeps them', () => {
        const {plugin, fatLine, render, real} = setup()
        plugin.setMaterial('depth')
        const first = render().fatLineMaterial
        const dispose = vi.spyOn(first, 'dispose')
        fatLine.visible = false
        expect(render().fatLineMaterial).toBe(first)
        expect(dispose).not.toHaveBeenCalled()
        fatLine.visible = true

        const next = new tp.LineMaterial2()
        fatLine.material = next // the material changes while the view is on
        const second = render().fatLineMaterial
        expect(second.lineMaterial).toBe(next)
        expect(dispose).toHaveBeenCalled()
        expect((plugin as any)._lineVariants.has(next)).toBe(true)
        expect((plugin as any)._lineVariants.size).toBe(1)
        expect({...real(), fatLineOwn: fatLine.material === next && fatLine.forcedOverrideMaterial === undefined}).toEqual(untouched)
    })

    test('clear, enabled = false and removing the plugin during a render restore the fat line', () => {
        for (const stop of ['clear', 'disable', 'remove'] as const) {
            const {plugin, viewer, fatLine, real} = setup()
            plugin.setMaterial('materialId')
            viewer.dispatchEvent({type: 'preRender'})
            expect(fatLine.material.name).toBe('View Override Line')
            if (stop === 'clear') plugin.clear()
            else if (stop === 'disable') plugin.enabled = false
            else plugin.onRemove(viewer)
            viewer.dispatchEvent({type: 'postRender'})
            expect(real()).toEqual(untouched)
        }
    })

    test('the material ID colour of a line is the colour of a mesh with the same material id; vertex colours do not change it', () => {
        const {plugin, fatLineMaterial, render} = setup()
        fatLineMaterial.vertexColors = true
        plugin.setMaterial('materialId')
        const variant = render().fatLineMaterial
        const ids = (plugin as any)._materials.materialId
        const mesh = new Mesh(new tp.BoxGeometry(), fatLineMaterial as any) // a mesh with that material, as the override draws it
        ids.onBeforeRender({resetCurrentMaterial: vi.fn()}, null, null, mesh.geometry, mesh, null)
        expect(variant.color.getHex()).toBe(ids.color.getHex())
        ids.onAfterRender({}, null, null, mesh.geometry, mesh, null)
        expect(variant.vertexColors).toBe(false) // a flat colour: no USE_COLOR in the line shader
    })

    test('the shadow and GBuffer line materials keep the line material while a line variant is forced', () => {
        const {plugin, viewer, fatLine, fatLineMaterial} = setup()
        plugin.setMaterial('depth')
        viewer.dispatchEvent({type: 'preRender'})
        expect(fatLine.material.name).toBe('View Override Line')
        // e.g. the shadow map compiles customDepthMaterial during the main render pass
        const depthMaterial = fatLine.customDepthMaterial
        const lib = tp.ShaderLib.depth
        const shader = {uniforms: tp.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: {}}
        depthMaterial.onBeforeCompile(shader, {} as any)
        expect(shader.vertexShader).toContain('attribute vec3 instanceStart;')
        expect(shader.uniforms.linewidth).toBe(fatLineMaterial.uniforms.linewidth)
        viewer.dispatchEvent({type: 'postRender'})
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

    test('lightsKeepEnvironment changed while a lights preset is on applies at once; an env preset keeps its map', async() => {
        const tex = new Texture()
        const {plugin, render} = setup(async() => tex)
        await plugin.setLighting('lights-studio')
        expect(render().overrideEnvironment?.name).toBe('View Override No Environment')
        plugin.lightsKeepEnvironment = true
        expect(render().overrideEnvironment).toBe(null) // the scene environment, with the preset lights
        expect(render().presetLights).toBe(4)
        plugin.lightsKeepEnvironment = false
        expect(render().overrideEnvironment?.name).toBe('View Override No Environment')
        // an env preset replaces the environment: the flag does not change it
        await plugin.setLighting('env-studio')
        plugin.lightsKeepEnvironment = true
        expect(render().overrideEnvironment).toBe(tex)
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
        const {fatLineMaterial, ...during} = render()
        expect(fatLineMaterial.name).not.toBe('View Override Line')
        expect({...during, lightsRootVisible: undefined, presetLights: undefined}).toEqual({...untouched, fatLineOwn: undefined, lightsRootVisible: undefined, presetLights: undefined})
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

    test('a mesh with geometry groups: each group draw takes the material of its group', () => {
        const {plugin} = setup()
        const renderer = {resetCurrentMaterial: vi.fn()} as any
        const camera = new PerspectiveCamera()
        const geometry = new tp.PlaneGeometry()
        geometry.clearGroups()
        geometry.addGroup(0, 3, 0)
        geometry.addGroup(3, 3, 1)
        const map = new Texture()
        const red = new MeshBasicMaterial({color: 0xff0000, map})
        const blue = new MeshBasicMaterial({color: 0x0000ff, transparent: true, opacity: 0.5})
        const mesh = new Mesh(geometry, [red, blue])
        /** The state of the override material while it draws one group (three.js calls the material with the group) */
        const drawGroup = (material: any, group: any) => {
            material.onBeforeRender(renderer, null, camera, geometry, mesh, group)
            const state = {color: material.color.getHex(), map: material.map, opacity: material.opacity, transparent: material.transparent}
            material.onAfterRender(renderer, null, camera, geometry, mesh, group)
            return state
        }
        const [g0, g1] = geometry.groups
        const unlit = (plugin as any)._materials.unlit
        expect(drawGroup(unlit, g0)).toEqual({color: 0xff0000, map, opacity: 1, transparent: false})
        expect(drawGroup(unlit, g1)).toEqual({color: 0x0000ff, map: null, opacity: 0.5, transparent: true})

        const ids = (plugin as any)._materials.materialId
        const c0 = drawGroup(ids, g0).color, c1 = drawGroup(ids, g1).color
        expect(c0).not.toBe(c1)
        expect(c0).toBe(ids.colorFor(red.id).getHex())
        expect(c1).toBe(ids.colorFor(blue.id).getHex())
        // no group (a draw of the whole mesh): the first material
        expect(drawGroup(unlit, null).color).toBe(0xff0000)
    })

    test('the unlit view keeps vertex colors, the blend, depth, clipping and fog settings of each material', () => {
        const {plugin} = setup()
        const renderer = {resetCurrentMaterial: vi.fn()} as any
        const camera = new PerspectiveCamera()
        const unlit = (plugin as any)._materials.unlit
        const props = ['vertexColors', 'alphaToCoverage', 'premultipliedAlpha', 'blending', 'blendSrc', 'blendDst', 'depthTest',
            'depthWrite', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'clippingPlanes', 'clipIntersection', 'fog']
        /** The version and the copied settings while the override draws the mesh */
        const draw = (m: any) => {
            unlit.onBeforeRender(renderer, null, camera, m.geometry, m, null)
            const state: any = {version: unlit.version}
            for (const k of props) state[k] = unlit[k]
            unlit.onAfterRender(renderer, null, camera, m.geometry, m, null)
            return state
        }
        const colored = (itemSize: number) => {
            const g = new tp.BoxGeometry()
            g.setAttribute('color', new tp.BufferAttribute(new Float32Array(g.attributes.position.count * itemSize).fill(0.5), itemSize))
            return new Mesh(g, new MeshBasicMaterial({vertexColors: true})) // as PLYLoadPlugin and STLLoadPlugin make them
        }
        const plain = new Mesh(new tp.BoxGeometry(), new MeshBasicMaterial())
        const p0 = draw(plain)
        const rgb = draw(colored(3))
        expect(rgb.vertexColors).toBe(true)
        expect(rgb.version).not.toBe(p0.version) // vertexColors
        expect(unlit.vertexColors).toBe(false) // reset after the draw
        const rgba = draw(colored(4))
        expect(rgba.version).not.toBe(rgb.version) // vertexAlphas
        expect(draw(colored(4)).version).toBe(rgba.version)
        const p1 = draw(plain)
        expect(p1.version).not.toBe(rgba.version)

        const planes = [new tp.Plane()]
        const special = new Mesh(new tp.BoxGeometry(), new MeshBasicMaterial({
            alphaToCoverage: true, premultipliedAlpha: true, blending: tp.CustomBlending, blendSrc: tp.OneFactor, blendDst: tp.OneFactor,
            depthTest: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
            clippingPlanes: planes, clipIntersection: true, fog: false,
        }))
        const s = draw(special)
        expect(s).toMatchObject({alphaToCoverage: true, premultipliedAlpha: true, blending: tp.CustomBlending, blendSrc: tp.OneFactor,
            blendDst: tp.OneFactor, depthTest: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
            polygonOffsetUnits: -2, clippingPlanes: planes, clipIntersection: true, fog: false})
        expect(s.version).not.toBe(p1.version) // opaque, alphaToCoverage, premultipliedAlpha, useFog
        const after = draw(plain)
        const defaults = new MeshBasicMaterial() as any
        for (const k of props) expect(after[k]).toEqual(k === 'vertexColors' ? false : defaults[k])
    })
})
