import {
    AViewerPluginSync,
    Euler,
    HalfFloatType,
    IObject3D,
    ITexture,
    Matrix3,
    Matrix4,
    serialize,
    ThreeViewer,
    uiFolderContainer,
    uiMonitor,
    uiToggle,
    Vector3,
    WebGLCubeRenderTarget,
} from 'threepipe'
import {LightProbeGenerator} from 'three/examples/jsm/lights/LightProbeGenerator.js'
import type {VolumeObject} from './VolumeObject'
import type {VolumeMaterial} from './VolumeMaterial'
import {VolumeData} from './VolumeData'
import {volumeGLTFExtension} from './gltf'

/**
 * Adds volume rendering to the viewer: saving and loading volumes in glTF files, and the quality switch while the
 * frame is not still.
 *
 * Volumes themselves are scene objects ({@link VolumeObject}) and can be created and shown without this plugin;
 * the load plugins (like {@link NRRDLoadPlugin}) add it as a dependency.
 *
 * While the camera or a setting changes, volumes march with their `interactiveSamplingRate`. When the frame is
 * still, one more frame is rendered at the full `samplingRate` (and `ProgressivePlugin`, if added, then averages the
 * jittered frames).
 *
 * Before each frame it builds the GPU maps the volumes use to skip empty space (and the gradient textures), within
 * {@link kernelBudget} per frame, and keeps frames coming until they are done. It also sets
 * {@link VolumeData.maxTextureSize} from the renderer, and gives the volume materials the environment light of the scene
 * as spherical harmonics (for `shading`).
 *
 * @category Plugins
 */
@uiFolderContainer('Volume Rendering')
export class VolumePlugin extends AViewerPluginSync {
    public static readonly PluginType = 'VolumePlugin'
    enabled = true

    /**
     * Use the lower sampling rate of each volume while the frame is not still.
     */
    @uiToggle('Lower quality while moving')
    @serialize() interactiveQuality = true

    /**
     * Texture reads per frame for building derived fields (block ranges, empty space maps, gradients). A 512³
     * field with 8³ blocks needs about 270 million for its block ranges.
     */
    @serialize() kernelBudget = 2 ** 27

    /**
     * GPU memory of the volumes in the scene and their derived fields, in MiB.
     */
    @uiMonitor('GPU Memory (MiB)')
    get gpuMemoryMiB(): number {
        let bytes = 0
        const fields = new Set<VolumeData>()
        for (const v of this.volumes) {
            for (const f of Object.values(v.fields)) fields.add(f)
            bytes += v.material?.derivedGpuBytes ?? 0
        }
        for (const f of fields) bytes += f.gpuBytes + f.derivedGpuBytes
        return Math.round(bytes / 2 ** 20 * 10) / 10
    }

    /**
     * Volumes in the scene.
     */
    readonly volumes = new Set<VolumeObject>()

    private _renderedInteractive = false
    private _derivedPending = false
    private _lightingVersions = new WeakMap<object, number>()
    private _envKey = ''
    private _envSH?: Vector3[]
    private readonly _envRotation = new Matrix3()

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        const gl = viewer.renderManager.webglRenderer.getContext() as WebGL2RenderingContext
        const max3d = gl?.getParameter?.(gl.MAX_3D_TEXTURE_SIZE)
        if (typeof max3d === 'number' && max3d > 0) VolumeData.maxTextureSize = max3d
        viewer.assetManager.registerGltfExtension(volumeGLTFExtension)
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object => this._objectAdd({object}))
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
        viewer.renderManager.addEventListener('contextRestored', this._contextRestored)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.unregisterGltfExtension(volumeGLTFExtension.name)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
        viewer.renderManager.removeEventListener('contextRestored', this._contextRestored)
        for (const v of this.volumes) v.material.interactive = false
        this.volumes.clear()
        super.onRemove(viewer)
    }

    private _objectAdd = (e: {object?: IObject3D}) => {
        const o = e.object as unknown as VolumeObject
        if (!o?.isVolumeObject) return
        this.volumes.add(o)
        if (o.pendingFieldLinks?.length) this._loadFieldLinks(o)
    }

    /**
     * Loads the fields of a saved volume other than its active one, and adds them under their saved names.
     */
    private async _loadFieldLinks(o: VolumeObject) {
        const viewer = this._viewer
        if (!viewer) return
        const links = o.pendingFieldLinks
        o.pendingFieldLinks = []
        for (const link of links) {
            try {
                const data = await viewer.assetManager.importer.importSingle(link.filePath, {volumeDataOnly: true} as any) as unknown as VolumeData | undefined
                if (!(data as any)?.isVolumeData) {
                    console.warn('VolumePlugin: could not load the field', link.name, 'from', link.filePath)
                    continue
                }
                const d = data as VolumeData
                d.name = link.name
                d.fieldName = link.fieldName ?? ''
                d.fieldIndex = link.fieldIndex ?? 0
                if (!d.filePath) d.filePath = link.filePath
                if (!o.fields[link.name]) o.addField(d)
            } catch (e) {
                console.warn('VolumePlugin: could not load the field', link.name, 'from', link.filePath, e)
            }
        }
    }

    private _objectRemove = (e: {object?: IObject3D}) => {
        const o = e.object as unknown as VolumeObject
        if (o?.isVolumeObject) this.volumes.delete(o)
    }

    private _preRender = () => {
        const viewer = this._viewer
        if (!viewer) return
        // frameCount is 0 on the first frame after any change (camera, setting): that frame is interactive
        const interactive = this.enabled && this.interactiveQuality && viewer.renderManager.frameCount === 0
        let differs = false
        for (const v of this.volumes) {
            const m = v.material
            if (!m?.isVolumeMaterial) continue
            m.interactive = interactive
            if (interactive && m.interactiveSamplingRate !== m.samplingRate && v.visible) differs = true
        }
        this._renderedInteractive = interactive && differs
        this._updateDerived()
    }

    // render targets lose their contents with the context
    private _contextRestored = () => {
        for (const v of this.volumes) v.material?.invalidateDerived?.()
    }

    private _updateDerived() {
        const viewer = this._viewer
        if (!viewer || !this.enabled) return
        const renderer = viewer.renderManager.webglRenderer
        // each volume: a shared material builds the maps of the field and the shadows of each volume
        const materials = new Set<VolumeMaterial>()
        for (const v of this.volumes) if (v.visible && v.material?.isVolumeMaterial) materials.add(v.material)
        this._updateEnvironment([...materials])
        let budget = this.kernelBudget
        let pending = false
        let lightingChanged = false
        const context = {scene: viewer.scene, camera: viewer.scene.mainCamera}
        for (const v of this.volumes) {
            const m = v.material as VolumeMaterial
            if (!v.visible || !m?.isVolumeMaterial) continue
            if (budget > 0) budget -= m.updateDerived(renderer, budget, {...context, object: v})
            pending = pending || m.derivedPending
            const lv = m.lightingVersion
            if ((this._lightingVersions.get(m) ?? 0) !== lv) lightingChanged = true
            this._lightingVersions.set(m, lv)
        }
        this._derivedPending = pending
        // a finished shadow or occlusion volume changes the image: start the progressive frames again
        if (lightingChanged) viewer.setDirty()
    }

    /**
     * The environment of the scene as spherical harmonics, computed again when it changes.
     */
    private _updateEnvironment(materials: VolumeMaterial[]) {
        const viewer = this._viewer!
        const scene = viewer.scene
        const env = scene.environment as ITexture | null
        const lit = materials.some(m => m.shading !== 'none')
        const rot = (scene as any).environmentRotation as Euler | undefined
        const key = !lit || !env ? '' : [env.uuid, env.version, scene.environmentIntensity ?? 1, rot ? rot.toArray().join(',') : ''].join(';')
        if (key !== this._envKey) {
            this._envKey = key
            this._envSH = key ? environmentSH(viewer, env!, scene.environmentIntensity ?? 1) : undefined
            // as three.js does for environment maps (WebGLMaterials, envMapRotation): the Euler angles negated
            if (rot) this._envRotation.setFromMatrix4(new Matrix4().makeRotationFromEuler(new Euler(-rot.x, -rot.y, -rot.z, rot.order)))
            else this._envRotation.identity()
        }
        for (const m of materials) m.setEnvironment(this._envSH, this._envRotation)
    }

    private _postRender = () => {
        // render one more frame, without a reset, so the still image gets the full sampling rate; and more frames
        // while derived fields are being built (the image does not change, the frames get faster)
        if (this._renderedInteractive || this._derivedPending) this._viewer?.renderManager.setDirty()
        this._renderedInteractive = false
    }
}

/**
 * Spherical harmonics (radiance, 9 coefficients) of an environment texture: drawn into a small cube render target
 * and projected with three.js LightProbeGenerator. Equirectangular textures and cube textures are supported.
 */
function environmentSH(viewer: ThreeViewer, env: ITexture, intensity: number): Vector3[] | undefined {
    const renderer = viewer.renderManager.webglRenderer
    try {
        let probe
        if ((env as any).isCubeTexture && Array.isArray((env as any).image) && (env as any).image[0]?.width) {
            probe = LightProbeGenerator.fromCubeTexture(env as any)
        } else if ((env as any).image) {
            const rt = new WebGLCubeRenderTarget(32, {type: HalfFloatType})
            rt.fromEquirectangularTexture(renderer, env as any)
            probe = LightProbeGenerator.fromCubeRenderTarget(renderer, rt)
            rt.dispose()
        }
        if (!probe) return undefined
        return probe.sh.coefficients.map(c => c.clone().multiplyScalar(intensity))
    } catch (e) {
        console.warn('VolumePlugin: could not read the environment for volume lighting', e)
        return undefined
    }
}
