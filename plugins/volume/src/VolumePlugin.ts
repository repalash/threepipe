import {AViewerPluginSync, IObject3D, serialize, ThreeViewer, uiFolderContainer, uiToggle} from 'threepipe'
import type {VolumeObject} from './VolumeObject'
import type {VolumeData} from './VolumeData'
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
     * Volumes in the scene.
     */
    readonly volumes = new Set<VolumeObject>()

    private _renderedInteractive = false

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.assetManager.registerGltfExtension(volumeGLTFExtension)
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object => this._objectAdd({object}))
        viewer.addEventListener('preRender', this._preRender)
        viewer.addEventListener('postRender', this._postRender)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.unregisterGltfExtension(volumeGLTFExtension.name)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.removeEventListener('preRender', this._preRender)
        viewer.removeEventListener('postRender', this._postRender)
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
    }

    private _postRender = () => {
        // render one more frame, without a reset, so the still image gets the full sampling rate
        if (this._renderedInteractive) this._viewer?.renderManager.setDirty()
        this._renderedInteractive = false
    }
}
