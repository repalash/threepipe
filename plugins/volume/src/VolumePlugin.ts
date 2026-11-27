import {AViewerPluginSync, IObject3D, serialize, ThreeViewer, uiFolderContainer, uiMonitor, uiToggle} from 'threepipe'
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
 * {@link VolumeData.maxTextureSize} from the renderer.
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
        if (o?.isVolumeObject) this.volumes.add(o)
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
        const materials = new Set<VolumeMaterial>()
        for (const v of this.volumes) if (v.visible && v.material?.isVolumeMaterial) materials.add(v.material)
        let budget = this.kernelBudget
        let pending = false
        for (const m of materials) {
            if (budget > 0) budget -= m.updateDerived(renderer, budget)
            pending = pending || m.derivedPending
        }
        this._derivedPending = pending
    }

    private _postRender = () => {
        // render one more frame, without a reset, so the still image gets the full sampling rate; and more frames
        // while derived fields are being built (the image does not change, the frames get faster)
        if (this._renderedInteractive || this._derivedPending) this._viewer?.renderManager.setDirty()
        this._renderedInteractive = false
    }
}
