import {
    IGeometry,
    iGeometryCommons,
    IMaterial,
    iMaterialCommons,
    IMaterialEventMap,
    IObject3D,
    IObject3DEventMap,
    iObjectCommons,
    ITexture,
    LegacyPhongMaterial,
    PhysicalMaterial,
    UnlitLineMaterial,
    UnlitMaterial,
    upgradeTexture,
} from '../core'
import {IObjectExtension} from '../core/IObject'
import {Event, Event2, EventDispatcher, VideoTexture} from 'three'
import {generateUUID} from '../three'
import {object3DTextureProperties, sceneTextureProperties} from '../core/object/iObjectCommons'
import {materialTextureProperties, materialTexturePropertiesUserData} from '../core/material/iMaterialCommons'
import {safeSetProperty} from 'ts-browser-helpers'

/**
 * Event map for Object3DManager events.
 */
export interface Object3DManagerEventMap {
    'videoAdd': {video: VideoTexture & ITexture}
    'videoRemove': {video: VideoTexture & ITexture}
    'objectAdd': {object: IObject3D}
    'objectRemove': {object: IObject3D}
    'materialAdd': {material: IMaterial}
    'materialRemove': {material: IMaterial}
    'geometryAdd': {geometry: IGeometry}
    'geometryRemove': {geometry: IGeometry}
    'textureAdd': {texture: ITexture}
    'textureRemove': {texture: ITexture}
    'dispose': object
}

/**
 * Manages 3D objects, materials, geometries, textures, and videos in a scene.
 */
export class Object3DManager extends EventDispatcher<Object3DManagerEventMap> {
    private _root: IObject3D | undefined
    private _objects = new Set<IObject3D>()
    private _objectExtensions: IObjectExtension[] = []
    private _materials = new Set<IMaterial>()
    private _geometries = new Set<IGeometry>()
    private _textures = new Set<ITexture>()
    private _videos = new Set<VideoTexture & ITexture>()

    getObjects() {
        return [...this._objects]
    }
    getObjectExtensions() {
        return [...this._objectExtensions]
    }
    getMaterials() {
        return [...this._materials]
    }
    getGeometries() {
        return [...this._geometries]
    }
    getTextures() {
        return [...this._textures]
    }
    getVideos() {
        return [...this._videos]
    }

    autoDisposeTextures = true
    autoDisposeMaterials = true
    autoDisposeGeometries = true
    autoDisposeObjects = false

    constructor() {
        super()
        this._rootChanged = this._rootChanged.bind(this)
        this._materialChanged = this._materialChanged.bind(this)
        this._geometryChanged = this._geometryChanged.bind(this)
        this._texturesChanged = this._texturesChanged.bind(this) // todo add texturesChanged to textures on objects as well like background and environment
        // this._objAdded = this._objAdded.bind(this)
    }

    onPostFrame(timeline: {time: number, running: boolean}) {
        // const delta = time.delta
        for (const video of this._videos) {
            const data = video.userData.timeline
            if (data) {
                if (!data.enabled) continue
            }
            const elem = video.image as HTMLVideoElement
            const delay = data?.delay || 0
            const scale = data?.scale || 1
            const start = data?.start || 0
            const duration = elem.duration || 1
            const end = duration - (data?.end || 0)
            // elem.pause()
            let t = timeline.time
            t -= delay
            t *= scale
            if (t < start) t = start
            if (t > end) t = end
            if (t < 0) t = 0
            if (t > duration) t = duration
            const d1 = Math.abs(t - elem.currentTime)
            if (/* d1 > delta && */d1 > 1 / 60) { // todo determine fps?
                // console.log(t)
                elem.currentTime = t
                if (elem.paused) {
                    const i1 = (video._playid || 0) + 1 // increment play id to avoid playing the video multiple times
                    video._playid = i1
                    elem.play().then(() => {
                        if (video._playid !== i1) return // if play id changed, do not play the video
                        if (!elem.paused) {
                            elem.pause()
                        }
                        delete video._playid
                    })
                }
            }
            if (!timeline.running) {
                // if the timeline is not running, pause the video
                if (!elem.paused && !video._playid) {
                    elem.pause()
                }
            }
        }
    }

    setRoot(root: IObject3D) {
        this._root = root
    }

    registerObject(obj: IObject3D) {
        if (!obj || !obj.uuid || !obj.isObject3D) return
        if (this._objects.has(obj)) return
        const existing = [...this._objects].find(o => o.uuid === obj.uuid)
        if (existing) {
            if (existing && obj !== existing) {
                // console.error('AssetManager - Object with the same uuid already registered', obj, existing)
                safeSetProperty(obj, 'uuid', generateUUID(), true, true)
            }
            // return
        }
        if (!obj.assetType) {
            iObjectCommons.upgradeObject3D.call(obj)
        }
        this._objects.add(obj)
        obj.addEventListener('parentRootChanged', this._rootChanged)
        obj.addEventListener('materialChanged', this._materialChanged)
        obj.addEventListener('geometryChanged', this._geometryChanged)
        this._registerMaterials(obj.materials, obj)
        this._registerGeometry(obj.geometry, obj)
        const maps = iObjectCommons.getMapsForObject3D.call(obj)
        if (maps) for (const tex of maps) {
            this._registerTexture(tex, obj)
        }
        if (!obj.objectExtensions) obj.objectExtensions = []
        const exts = obj.objectExtensions
        for (const ext of this._objectExtensions) {
            if (exts.includes(ext)) continue
            const compatible = ext.isCompatible ? ext.isCompatible(obj) : true
            if (compatible) {
                exts.push(ext)
                ext.onRegister && ext.onRegister(obj)
            }
        }
        this.dispatchEvent({type: 'objectAdd', object: obj})
    }

    unregisterObject(obj: IObject3D) {
        if (!obj || !obj.uuid || !this._objects.has(obj)) return false
        this._objects.delete(obj)
        obj.removeEventListener('materialChanged', this._materialChanged)
        obj.removeEventListener('geometryChanged', this._geometryChanged)
        // obj.removeEventListener('added', this._objAdded)
        this._unregisterMaterials(obj.materials, obj)
        this._unregisterGeometry(obj.geometry, obj)
        const maps = iObjectCommons.getMapsForObject3D.call(obj)
        if (maps) for (const tex of maps) {
            this._unregisterTexture(tex, obj)
        }
        if (this.autoDisposeObjects && obj.userData?.disposeOnIdle !== false) { // todo add disposeOnIdle to types and docs
            obj.dispose(false)
        }
        this.dispatchEvent({type: 'objectRemove', object: obj})
        return true

        // todo - extensions are not removed from the object, so they can be reused later
        // if (obj.objectExtensions) {
        //     for (const ext of this._objectExtensions) {
        //         const ind1 = obj.objectExtensions.indexOf(ext)
        //         if (ind1 >= 0) obj.objectExtensions.splice(ind1, 1)
        //     }
        // }

        // listener is not removed, it will be used to know when its added back to root. todo - because of this reference to the manager is kept even after dispose, if the object is removed from the scene before dispose. but it would be empty.
        // obj.removeEventListener('parentRootChanged', this._rootChanged)
    }

    registerObjectExtension(ext: IObjectExtension) {
        if (!ext) return
        if (!ext.uuid) ext.uuid = generateUUID()
        const ind = this._objectExtensions.includes(ext)
        if (ind) return
        this._objectExtensions.push(ext)
        for (const obj of this._objects) {
            if (obj.objectExtensions && !obj.objectExtensions.includes(ext)) {
                const compatible = ext.isCompatible ? ext.isCompatible(obj) : true
                if (compatible) {
                    obj.objectExtensions.push(ext)
                }
            }
        }
    }

    unregisterObjectExtension(ext: IObjectExtension) {
        if (!ext) return
        const ind = this._objectExtensions.indexOf(ext)
        if (ind < 0) return
        this._objectExtensions.splice(ind, 1)
        // todo - extensions are not removed from objects at the moment, so they can be reused later
        // for (const obj of this._objects) {
        //     if (obj.objectExtensions && obj.objectExtensions.includes(ext)) {
        //         const ind1 = obj.objectExtensions.indexOf(ext)
        //         if (ind1 >= 0) obj.objectExtensions.splice(ind1, 1)
        //     }
        // }
    }

    private _rootChanged = (ev: Event<'parentRootChanged', IObject3D>) => {
        if (!ev.target || !this._root) return
        const parent = ev.target.parentRoot
        let inRoot = false
        if (parent === this._root) inRoot = true
        else {
            ev.target.traverseAncestors(a => {
                if (a === this._root) inRoot = true
            })
        }
        if (inRoot) {
            this.registerObject(ev.target)
        } else {
            this.unregisterObject(ev.target)
        }
    }

    // private _objAdded = (ev: Event<'added', IObject3D>) => {
    //     if (!ev.target) return
    //     let inRoot = false
    //     ev.target.traverseAncestors(a => {
    //         if (a === this._root) inRoot = true
    //     })
    //     if (!inRoot) return
    //     this.registerObject(ev.target)
    // }

    private _materialChanged = (ev: Event2<'materialChanged', IObject3DEventMap, IObject3D>) => {
        if (!ev.target) return
        const obj = ev.target

        const oldMaterials = ev.oldMaterial
        if (oldMaterials) {
            if (Array.isArray(oldMaterials)) {
                this._unregisterMaterials(oldMaterials, obj)
            } else {
                this._unregisterMaterial(oldMaterials, obj)
            }
        }

        this._registerMaterials(obj.materials, obj)
    }

    private _geometryChanged = (ev: Event2<'geometryChanged', IObject3DEventMap, IObject3D>) => {
        if (!ev.target) return
        const obj = ev.target

        const oldGeometry = ev.oldGeometry
        if (oldGeometry) this._unregisterGeometry(oldGeometry, obj)

        this._registerGeometry(obj.geometry, obj)
    }

    // region materials

    private _registerMaterials(mat: IMaterial[]|undefined, mesh: IObject3D) {
        return mat && mat.forEach(m => this._registerMaterial(m, mesh))
    }

    private _unregisterMaterials(mat: IMaterial[]|undefined, mesh: IObject3D) {
        return mat && mat.forEach(m => this._unregisterMaterial(m, mesh))
    }

    private _registerMaterial(mat: IMaterial, mesh: IObject3D) {
        if (!mat || !mat.isMaterial || !mesh || !mesh.uuid) return
        if (!mat.assetType) {
            iMaterialCommons.upgradeMaterial.call(mat)
        }
        let meshes = mat.appliedMeshes
        if (!meshes) {
            meshes = new Set<IObject3D>()
            mat.appliedMeshes = meshes
        }
        const isNewMaterial = !this._materials.has(mat)
        meshes.add(mesh)
        this._materials.add(mat)

        // Add texturesChanged event listener for new materials
        if (isNewMaterial) {
            mat.addEventListener('texturesChanged', this._texturesChanged)
        }

        const maps = /* mat._mapRefs || */iMaterialCommons.getMapsForMaterial.call(mat)
        if (maps) for (const tex of maps) {
            this._registerTexture(tex, mat)
        }

        if (isNewMaterial) {
            this.dispatchEvent({type: 'materialAdd', material: mat})
        }
    }

    private _unregisterMaterial(mat: IMaterial, mesh: IObject3D) {
        if (!mat || !mesh || !mesh.uuid) return
        const meshes = mat.appliedMeshes
        if (!meshes) return
        meshes.delete(mesh)
        if (meshes.size === 0 && this._materials.has(mat)) {
            this._materials.delete(mat)

            // Remove texturesChanged event listener when material is no longer used
            mat.removeEventListener('texturesChanged', this._texturesChanged)

            const maps = /* mat._mapRefs || */iMaterialCommons.getMapsForMaterial.call(mat)
            if (maps) for (const tex of maps) {
                this._unregisterTexture(tex, mat)
            }

            this.dispatchEvent({type: 'materialRemove', material: mat})

            if (this.autoDisposeMaterials) {
                mat.dispose(false)
            }
        }
    }

    private _texturesChanged = (ev: Event2<'texturesChanged', IMaterialEventMap, IMaterial>) => {
        if (!ev.target) return
        const material = ev.target

        const removedTextures = ev.removedTextures
        if (removedTextures) for (const tex of removedTextures) {
            this._unregisterTexture(tex, material)
        }

        const addedTextures = ev.textures // using textures instead of addedTextures here
        if (addedTextures) for (const tex of addedTextures) {
            this._registerTexture(tex, material)
        }
    }

    // endregion

    // region geometry

    private _registerGeometry(geom: IGeometry|undefined, mesh: IObject3D) {
        if (!geom || !geom.isBufferGeometry || !mesh || !mesh.uuid) return
        if (!geom.assetType) {
            iGeometryCommons.upgradeGeometry.call(geom)
        }
        let meshes = geom.appliedMeshes
        if (!meshes) {
            meshes = new Set<IObject3D>()
            geom.appliedMeshes = meshes
        }
        const isNewGeometry = !this._geometries.has(geom)
        meshes.add(mesh)
        this._geometries.add(geom)

        if (isNewGeometry) {
            this.dispatchEvent({type: 'geometryAdd', geometry: geom})
        }
    }

    private _unregisterGeometry(geom: IGeometry|undefined, mesh: IObject3D) {
        if (!geom || !mesh || !mesh.uuid) return
        const meshes = geom.appliedMeshes
        if (!meshes) return
        meshes.delete(mesh)
        if (meshes.size === 0 && this._geometries.has(geom)) {
            this._geometries.delete(geom)

            this.dispatchEvent({type: 'geometryRemove', geometry: geom})

            if (this.autoDisposeGeometries)
                geom.dispose(false)
        }
    }

    // endregion

    // region textures

    private _registerTexture(tex: ITexture|undefined, obj: IObject3D | IMaterial) {
        if (!tex || !tex.isTexture || !obj || !obj.uuid) return
        if (!tex.assetType) upgradeTexture.call(tex)
        let objects = tex.appliedObjects
        if (!objects) {
            objects = new Set<IObject3D|IMaterial>()
            tex.appliedObjects = objects
        }
        const isNewTexture = !this._textures.has(tex)
        objects.add(obj)
        this._textures.add(tex)
        if (tex.isVideoTexture) this._registerVideo(tex as VideoTexture & ITexture)

        if (isNewTexture) {
            this.dispatchEvent({type: 'textureAdd', texture: tex})
        }
    }

    private _unregisterTexture(tex: ITexture|undefined, obj: IObject3D | IMaterial) {
        if (!tex || !obj || !obj.uuid) return
        const objects = tex.appliedObjects
        if (!objects) return
        objects.delete(obj)
        if (objects.size === 0 && this._textures.has(tex)) {
            this._textures.delete(tex)
            if (tex.isVideoTexture) this._videos.delete(tex as VideoTexture & ITexture)

            this.dispatchEvent({type: 'textureRemove', texture: tex})

            if (tex.userData?.disposeOnIdle !== false && this.autoDisposeTextures && !tex.isRenderTargetTexture && tex.dispose)
                tex.dispose()

            if (tex.isVideoTexture) {
                const elem = tex.image as HTMLVideoElement
                if (elem) {
                    // elem.pause() // stop the video, todo required?
                }
                this.dispatchEvent({type: 'videoRemove', video: tex as VideoTexture & ITexture})
            }
        }
    }

    private _registerVideo(tex: VideoTexture & ITexture) {
        this._videos.add(tex)
        const elem = tex.image as HTMLVideoElement
        elem.preload = 'auto'
        elem.autoplay = true
        // elem.play().then(() => {
        //     console.log('video started playing', elem)
        //     elem.pause()
        // })
        elem.loop = true
        elem.muted = true // to avoid autoplay issues in browsers
        this.dispatchEvent({type: 'videoAdd', video: tex})
    }

    // endregion textures

    // region utils

    findObject(nameOrUuid: string): IObject3D|undefined {
        if (!nameOrUuid) return undefined
        const obj = this._objects.values().find(o => o.uuid === nameOrUuid)
        if (obj) return obj
        const obj1 = this.findObjectsByName(nameOrUuid)
        if (obj1.length > 1) {
            console.warn('Multiple objects found with name:', nameOrUuid, obj1)
            return undefined
        }
        return obj1[0]
    }
    findObjectsByName(name: string): IObject3D[] {
        const objs: IObject3D[] = []
        this._objects.forEach(o=>{
            if (o.name === name) {
                objs.push(o)
            }
        })
        return objs
    }
    findMaterial(nameOrUuid: string): IMaterial|undefined {
        if (!nameOrUuid) return undefined
        const mat = this._materials.values().find(m => m.uuid === nameOrUuid)
        if (mat) return mat
        const mats = this.findMaterialsByName(nameOrUuid)
        if (mats.length > 1) {
            console.warn('Multiple materials found with name:', nameOrUuid, mats)
            return undefined
        }
        return mats[0]
    }
    findMaterialsByName(name: string): IMaterial[] {
        const mats: IMaterial[] = []
        this._materials.forEach(m=>{
            if (m.name === name) {
                mats.push(m)
            }
        })
        return mats
    }

    // endregion utils

    dispose() {
        const objects = [...this._objects]
        for (const o of objects) {
            this.unregisterObject(o)
            o.removeEventListener('parentRootChanged', this._rootChanged)
            // o.removeEventListener('added', this._objAdded)
        }
        this._objectExtensions = []
        this._objects.clear() // todo should this dispatch objectRemove events?
        this._materials.clear() // todo should this dispatch materialRemove events?
        this._geometries.clear() // todo should this dispatch geometryRemove events?
        // this._root = undefined
        this.dispatchEvent({type: 'dispose'})
    }

    static readonly MaterialTextureProperties: Set<string> = materialTextureProperties
    // todo add from plugins like custom bump map etc.
    static readonly MaterialTexturePropertiesUserData: Set<string> = materialTexturePropertiesUserData

    static readonly SceneTextureProperties: Set<string> = sceneTextureProperties
    static readonly Object3DTextureProperties: Set<string> = object3DTextureProperties

    static {
        new Set([
            ...UnlitMaterial.MapProperties,
            ...UnlitLineMaterial.MapProperties,
            ...PhysicalMaterial.MapProperties,
            ...LegacyPhongMaterial.MapProperties,
        ]).forEach(v=>Object3DManager.MaterialTextureProperties.add(v))
    }
}

// add _playid to VideoTexture types
declare module 'three' {
    interface VideoTexture {
        // used to avoid playing the video multiple times when the currentTime is set
        // and the video is already playing. this is used in Object3DManager to control video playback
        // based on timeline events.
        _playid?: number
    }
}
