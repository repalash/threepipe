import {BoxGeometry, IGeometry, IObject3D, Intersection, Material, Matrix4, Mesh2, Ray, Raycaster, Vector3} from 'threepipe'
import {VolumeData} from './VolumeData'
import {VolumeMaterial, VolumeRenderMode} from './VolumeMaterial'

export interface VolumeObjectOptions {
    /**
     * Size of one {@link VolumeData.units} in object units. Default: 0.001 for millimetres (glTF and threepipe scenes
     * are in metres), 0.01 for centimetres, 1 for metres and for anything else.
     */
    unitScale?: number
    mode?: VolumeRenderMode
    preset?: string
    material?: VolumeMaterial
}

/**
 * A volume in the scene: a box (three.js `BoxGeometry`, the pattern of the three.js volume examples) whose material
 * ray marches through its fields.
 *
 * Following the USD volume schema (`UsdVolVolume`), a volume has named fields ({@link fields}, like
 * `field:density`, `field:temperature`) and one material. The box is sized from the voxel count and spacing of the
 * field it shows, so it has its real size; the object's own position, rotation and scale stay free.
 *
 * Use it like any mesh: add it to the scene, move it, select it, dispose it.
 *
 * @category Objects
 */
export class VolumeObject extends Mesh2<IGeometry, VolumeMaterial> {
    readonly isVolumeObject = true

    /**
     * The fields of the volume by name, as the `field:<name>` relationships of a USD volume.
     */
    readonly fields: Record<string, VolumeData> = {}

    /**
     * Size of one data unit in object units, see {@link VolumeObjectOptions.unitScale}.
     */
    unitScale: number

    private _activeField = ''

    constructor(data?: VolumeData | VolumeData[], options: VolumeObjectOptions = {}) {
        const material = options.material ?? new VolumeMaterial({mode: options.mode, preset: options.preset})
        super(new BoxGeometry(1, 1, 1) as unknown as IGeometry, material)
        this.name = 'Volume'
        this.castShadow = false
        this.receiveShadow = false
        this.unitScale = options.unitScale ?? 0
        const list = data ? Array.isArray(data) ? data : [data] : []
        for (const d of list) this.addField(d)
        // threepipe sets dispose() on the instance, so listen to its event instead of overriding it
        this.addEventListener('dispose', this._onDispose)
    }

    /**
     * Add (or replace) a field under its {@link VolumeData.name}. The first field becomes the {@link activeField}.
     */
    addField(data: VolumeData) {
        const old = this.fields[data.name]
        if (old && old !== data) old.events.removeEventListener('update', this._onFieldUpdate)
        this.fields[data.name] = data
        data.events.addEventListener('update', this._onFieldUpdate)
        if (!this._activeField || this._activeField === data.name) this.activeField = data.name
    }

    /**
     * In iso mode, the material that draws the surface into the G-buffer ({@link VolumeMaterial.gbufferMaterial});
     * else none (the volume is not in the G-buffer).
     */
    get customGBufferMaterial(): Material | undefined {
        const m = this.material
        return m?.isVolumeMaterial && m.mode === 'iso' ? m.gbufferMaterial : undefined
    }
    set customGBufferMaterial(_v: Material | undefined) {
        // follows the mode of the material
    }

    /**
     * Name of the field the material shows.
     */
    get activeField() {
        return this._activeField
    }
    set activeField(name: string) {
        this._activeField = name
        this.material.field = this.fields[name]
        this.refreshBox()
    }

    /**
     * The field the material shows.
     */
    get data(): VolumeData | undefined {
        return this.fields[this._activeField]
    }

    private _onFieldUpdate = () => {
        this.refreshBox()
        ;(this as unknown as IObject3D).setDirty?.({change: 'volumeData'})
    }

    /**
     * Resize the box to the physical size of the active field.
     */
    refreshBox() {
        const d = this.data
        if (!d) return
        const scale = this.unitScale || defaultUnitScale(d.units)
        const [sx, sy, sz] = d.physicalSize.map(s => s * scale)
        const p = (this.geometry as unknown as BoxGeometry).parameters
        if (p && p.width === sx && p.height === sy && p.depth === sz) return
        const geom = new BoxGeometry(sx, sy, sz) as unknown as IGeometry
        const old = this.geometry
        this.geometry = geom
        old.dispose()
        this.geometry.computeBoundingBox()
        this.geometry.computeBoundingSphere()
    }

    /**
     * Ray test against the box, so picking selects the volume. Phase 1 picks the box, not the first visible sample.
     */
    raycast(raycaster: Raycaster, intersects: Intersection[]) {
        if (!this.visible) return
        const box = this.geometry.boundingBox ?? (this.geometry.computeBoundingBox(), this.geometry.boundingBox!)
        _inv.copy(this.matrixWorld).invert()
        _ray.copy(raycaster.ray).applyMatrix4(_inv)
        const local = _ray.intersectBox(box, _point)
        if (!local) return
        const world = local.clone().applyMatrix4(this.matrixWorld)
        const distance = raycaster.ray.origin.distanceTo(world)
        if (distance < raycaster.near || distance > raycaster.far) return
        intersects.push({distance, point: world, object: this} as Intersection)
    }

    /**
     * Copies the fields (shared, not duplicated: the data stays in memory once), the active field and the unit scale
     * of another volume, with the mesh properties.
     */
    copy(source: this, recursive?: boolean): this {
        super.copy(source, recursive)
        if ((source as any)?.isVolumeObject && source !== this) {
            for (const d of Object.values(this.fields)) d.events.removeEventListener('update', this._onFieldUpdate)
            for (const k of Object.keys(this.fields)) delete this.fields[k]
            this._activeField = ''
            this.unitScale = source.unitScale
            for (const d of Object.values(source.fields)) this.addField(d)
            if (source.activeField) this.activeField = source.activeField
            this.pendingFieldLinks = source.pendingFieldLinks.map(l => ({...l}))
        }
        return this
    }

    /**
     * A copy with the same fields, active field and unit scale, and the same material (as three.js `Mesh.clone`).
     */
    clone(recursive?: boolean): this {
        return new (this.constructor as typeof VolumeObject)(undefined, {material: this.material, unitScale: this.unitScale}).copy(this, recursive) as this
    }

    /**
     * Fields of a saved volume that are still to be loaded from their files (all but the active one, which the asset
     * manager loads). {@link VolumePlugin} loads them and adds them with their saved names.
     */
    pendingFieldLinks: VolumeFieldLink[] = []

    /**
     * Copies settings from an object that was saved as a link to this volume's file. Called by the asset manager
     * when a saved scene loads the volume again from its `rootPath`.
     * @internal
     */
    _copyFromEmbedded(obj: IObject3D) {
        obj.matrix.decompose(this.position, this.quaternion, this.scale)
        this.name = obj.name
        this.visible = obj.visible
        this.userData = {...obj.userData, ...this.userData}
        const saved = obj.userData.__volumeSettings
        if (saved) {
            if (saved.unitScale) this.unitScale = saved.unitScale
            // the file loaded again is the saved active field: give it its saved name and place in the file
            const loaded = this.data
            const link = saved.fields?.[saved.activeField]
            if (loaded && saved.activeField && loaded.name !== saved.activeField) {
                delete this.fields[loaded.name]
                loaded.name = saved.activeField
                this.fields[loaded.name] = loaded
                this._activeField = loaded.name
            }
            if (loaded && link) {
                loaded.fieldName = link.fieldName ?? ''
                loaded.fieldIndex = link.fieldIndex ?? 0
            }
            // the other fields are loaded by VolumePlugin
            this.pendingFieldLinks = Object.entries(saved.fields ?? {})
                .filter(([name, l]: [string, any]) => !this.fields[name] && l?.filePath)
                .map(([name, l]: [string, any]) => ({name, filePath: l.filePath, fieldName: l.fieldName, fieldIndex: l.fieldIndex}))
            if (saved.activeField && this.fields[saved.activeField]) this.activeField = saved.activeField
            if (saved.material) this.material.fromJSON(saved.material, undefined, true)
            this.refreshBox()
        }
        delete this.userData.__volumeSettings
        this._rootPathRefreshed = true
        // @ts-expect-error keep the saved uuid
        this.uuid = obj.uuid
    }

    private _onDispose = () => {
        for (const d of Object.values(this.fields)) d.events.removeEventListener('update', this._onFieldUpdate)
    }

    /** @internal */
    declare _rootPathRefreshed?: boolean
}

/**
 * A field of a volume saved as a link to its file (USD `VolumeFieldAsset`).
 */
export interface VolumeFieldLink {
    name: string
    filePath: string
    fieldName?: string
    fieldIndex?: number
}

/**
 * Object units per data unit: millimetres and centimetres to metres, anything else as it is.
 */
export function defaultUnitScale(units: string) {
    const u = (units || '').trim().toLowerCase()
    if (u === 'mm' || u === 'millimeter' || u === 'millimetre' || u === 'millimeters') return 0.001
    if (u === 'cm' || u === 'centimeter' || u === 'centimetre') return 0.01
    if (u === 'um' || u === 'µm' || u === 'micron' || u === 'microns') return 1e-6
    return 1
}

const _inv = new Matrix4()
const _ray = new Ray()
const _point = new Vector3()
