import {Event, Matrix4, Mesh, Vector3} from 'three'
import {IMaterial} from '../IMaterial'
import {IEvent, objectHasOwn} from 'ts-browser-helpers'
import {IObject3D, IObject3DEventMap, IObjectProcessor, IObjectSetDirtyOptions} from '../IObject'
import {copyObject3DUserData} from '../../utils'
import {IGeometry, IGeometryEventMap} from '../IGeometry'
import {Box3B} from '../../three'
import {makeIObject3DUiConfig} from './IObjectUi'
import {iGeometryCommons} from '../geometry/iGeometryCommons'
import {iMaterialCommons} from '../material/iMaterialCommons'
import {ILight} from '../light/ILight'

export const iObjectCommons = {
    setDirty: function(this: IObject3D, options?: IObjectSetDirtyOptions, ...args: any[]): void {
        if (typeof options === 'string') { // just incase called by decorators
            options = {change: options}
        }
        this.dispatchEvent({bubbleToParent: this.userData?.autoUpdateParent ?? true, ...options, type: 'objectUpdate', object: this, args}) // this sets sceneUpdate in root scene
        if (options?.refreshUi !== false && options?.last !== false) this.refreshUi?.()
        // console.log('object update')
    },

    upgradeObject3D: upgradeObject3D,
    makeUiConfig: makeIObject3DUiConfig,

    autoCenter: function<T extends IObject3D>(this: T, setDirty = true, undo = false): T {
        // todo use bounding sphere?
        if (undo) {
            if (!this.userData.autoCentered || !this.userData._lastCenter) return this
            if (!isFinite(this.userData._lastCenter.lengthSq())) return this
            this.position.add(this.userData._lastCenter)
            delete this.userData.autoCentered
            delete this.userData.isCentered
            delete this.userData._lastCenter
        } else {
            const bb = new Box3B().expandByObject(this, true, true)
            const center = bb.getCenter(new Vector3())
            if (!isFinite(center.lengthSq())) return this
            this.userData._lastCenter = center/* .clone()*/
            this.position.sub(center)
            this.userData.autoCentered = true
            this.userData.isCentered = true
        }
        this.updateMatrix()
        if (setDirty) this.setDirty({change: 'autoCenter', undo})
        return this
    },

    autoScale: function<T extends IObject3D>(this: T, autoScaleRadius?: number, isCentered?: boolean, setDirty = true, undo = false): T {
        let scale = 1
        if (undo) { // Note - undo only works for quick undo, not for multiple times
            if (!this.userData.autoScaled || !this.userData._lastScaleRadius) return this
            const rad = this.userData.autoScaleRadius || autoScaleRadius || 1
            scale = this.userData._lastScaleRadius / rad
            if (!isFinite(scale)) return this // NaN when radius is 0
            this.userData.autoScaled = true
            this.userData.autoScaleRadius = autoScaleRadius
            delete this.userData._lastScaleRadius
        } else {
            const bbox = new Box3B().expandByObject(this, true, true)
            const radius = bbox.getSize(new Vector3()).length() * 0.5
            if (autoScaleRadius === undefined) {
                autoScaleRadius = this.userData.autoScaleRadius || 1
            }
            scale = autoScaleRadius / radius
            if (!isFinite(scale)) return this // NaN when radius is 0
            this.userData.autoScaled = true
            this.userData.autoScaleRadius = autoScaleRadius
            this.userData._lastScaleRadius = radius
        }

        if (this.userData.pseudoCentered) {
            this.children.forEach(child => {
                child.scale.multiplyScalar(scale)
            })
        } else
            this.scale.multiplyScalar(scale)
        if (isCentered || this.userData.isCentered) this.position.multiplyScalar(scale)

        this.traverse((obj) => {
            const l = obj as any
            if (l.isLight && l.shadow?.camera?.right) {
                l.shadow.camera.right *= scale
                l.shadow.camera.left *= scale
                l.shadow.camera.top *= scale
                l.shadow.camera.bottom *= scale
                obj.setDirty()
            }
            if (l.isCamera && l.right) {
                l.right *= scale
                l.left *= scale
                l.top *= scale
                l.bottom *= scale
                obj.setDirty()
            }
        })

        if (setDirty) this.setDirty({change: 'autoScale', undo})

        return this
    },

    pivotToBoundsCenter: function<T extends IObject3D>(this: T, setDirty = true): ()=>void {
        const bb = new Box3B().expandByObject(this, true, true)
        const center = bb.getCenter(new Vector3())
        return iObjectCommons.pivotToPoint.call(this, center, setDirty)
    },

    pivotToPoint: function<T extends IObject3D>(this: T, point: Vector3, setDirty = true): ()=>void {
        const worldCenter = new Vector3().copy(point)
        const localCenter = new Vector3().copy(worldCenter)

        const worldMatrixInv = new Matrix4().copy(this.matrixWorld).invert()
        const m = this.parent?.matrixWorld
        const parentWorldMatrixInv = new Matrix4()
        if (m !== undefined)
            parentWorldMatrixInv.copy(m).invert()

        // Get the center with respect to the parent
        worldCenter.applyMatrix4(parentWorldMatrixInv)
        const lastPosition = this.position.clone()

        // Apply the new position
        this.position.copy(worldCenter)

        // local center
        localCenter.applyMatrix4(worldMatrixInv).negate()

        // Shift the geometry
        if (this.geometry) {
            this.geometry.translate(localCenter.x, localCenter.y, localCenter.z)
        }
        // Add offsets
        this.children.forEach((object)=> {
            object.position.add(localCenter)
        })
        if (setDirty) this.setDirty({change: 'pivotToPoint', undo: false})

        return ()=>{
            // undo
            this.position.copy(lastPosition)
            if (this.geometry) {
                this.geometry.translate(-localCenter.x, -localCenter.y, -localCenter.z)
            }
            this.children.forEach((object)=> {
                object.position.sub(localCenter)
            })
            if (setDirty) this.setDirty({change: 'pivotToPoint', undo: true})
        }
    },

    eventCallbacks: {
        onAddedToParent: function(this: IObject3D, e: Event): void {
            // added to some parent
            const root = this.parent?.parentRoot ?? this.parent
            if (!this.objectProcessor && root?.objectProcessor) { // this is added so that when an upgraded(not processed) object is added to the scene, it will be processed by the scene processor
                this.traverse(o=>{
                    o.objectProcessor = root.objectProcessor
                    o.objectProcessor?.processObject(o)
                })
            }
            if (root !== this.parentRoot) {
                this.traverse(o=>{
                    o.parentRoot = root
                })
            }
            this.setDirty?.({...e, change: 'addedToParent'})
        },
        onRemovedFromParent: function(this: IObject3D, e: Event): void {
            // removed from some parent
            this.setDirty?.({...e, change: 'removedFromParent'})
            if (this.parentRoot !== undefined) {
                this.traverse(o=>{
                    o.parentRoot = undefined
                })
            }
        },
        onGeometryUpdate: function(this: IObject3D, e: IGeometryEventMap['geometryUpdate']&Event<'geometryUpdate'>): void {
            if (!e.bubbleToObject) return
            this.dispatchEvent({bubbleToParent: true, ...e, object: this, geometry: e.geometry})
        },
    },

    initMaterial: function(this: IObject3D): void {
        if (objectHasOwn(this, '_currentMaterial')) return
        this._currentMaterial = null

        const currentMaterial = this.material
        delete this.material
        Object.defineProperty(this, 'material', {
            get: iObjectCommons.getMaterial,
            set: iObjectCommons.setMaterial,
        })
        Object.defineProperty(this, 'materials', {
            get: iObjectCommons.getMaterials,
            set: iObjectCommons.setMaterials,
        })
        // this is called initially in Material manager from process model below, not required here...
        // todo: shouldnt be called from there. maybe check if material is upgraded before
        // if (currentMaterial && !Array.isArray(currentMaterial) && !currentMaterial.assetType) {
        //     console.error('todo: initMaterial: material not upgraded')
        // }
        this.material = currentMaterial

        // Legacy
        if (!(this as any).setMaterial) {
            (this as any).setMaterial = (m: IMaterial | IMaterial[]| undefined)=>{
                const mats = this.material
                console.error('setMaterial is deprecated, use material property directly')
                this.material = m
                return mats
            }
        }
        // Legacy
        if (this.userData.setMaterial) console.error('userData.setMaterial already defined')
        this.userData.setMaterial = (m: any)=>{
            console.error('userData.setMaterial is deprecated, use setMaterial directly')
            this.material = m
        }

    },

    getMaterial: function(this: IObject3D): IMaterial | IMaterial[] | undefined {
        return this._currentMaterial || undefined
    },
    getMaterials: function(this: IObject3D): IMaterial[] {
        return !this._currentMaterial ? [] : Array.isArray(this._currentMaterial) ? [...this._currentMaterial] : [this._currentMaterial]
    },

    setMaterial: function(this: IObject3D, material: IMaterial | IMaterial[] | undefined) {
        const imats = (Array.isArray(material) ? material : [material]).filter(v=>v)
        if (this.material == imats || imats.length === 1 && this.material === imats[0]) return []
        // todo: check by uuid?

        // Remove old material listeners
        const oldMats = this.material
        const mats = Array.isArray(oldMats) ? [...oldMats] : [oldMats!]

        let removed = []
        const added = []

        for (const mat of mats) {
            if (!mat) continue
            removed.push(mat)
            // if (mat.appliedMeshes) {
            //     mat.appliedMeshes.delete(this)
            //     // if (mat.userData && mat.appliedMeshes?.size === 0 && mat.userData.disposeOnIdle !== false)
            //     mat.dispose(false) // this will dispose textures(if they are idle) if the material is registered in the material manager
            // }
        }

        const materials = []
        for (const mat of imats) {
            // const mat = material?.materialObject
            if (!mat) continue
            if (!mat.assetType) {
                console.warn('Upgrading Material', mat)
                iMaterialCommons.upgradeMaterial.call(mat)
            }
            if (removed.includes(mat)) removed = removed.filter(m=>m !== mat)
            else added.push(mat)
            materials.push(mat)
            // if (mat && mat.appliedMeshes) {
            //     mat.appliedMeshes.add(this)
            // }
        }

        // todo should these be before or after `materialChanged` event? right now its before, also .material will return the old one since _currentMaterial is old
        for (const mat of removed) {
            if (mat.appliedMeshes) {
                mat.appliedMeshes.delete(this)
                // if (mat.userData && mat.appliedMeshes?.size === 0 && mat.userData.disposeOnIdle !== false)
                mat.dispose(false) // this will dispose textures(if they are idle) if the material is registered in the material manager
            }
            mat.dispatchEvent({type: 'removeFromMesh', object: this})
        }
        for (const mat of added) {
            if (mat.appliedMeshes) {
                mat.appliedMeshes.add(this)
            }
            mat.dispatchEvent({type: 'addToMesh', object: this})
            // note - material bubbleToObject is handled in dispatchEvent override in iMaterialCommons
        }

        this._currentMaterial = !materials.length ? null : materials.length !== 1 ? materials : materials[0] || null

        this.dispatchEvent({type: 'materialChanged', material: this._currentMaterial ?? null, oldMaterial: oldMats ?? null, object: this, bubbleToParent: true})
        this.refreshUi()
    },
    setMaterials: function(this: IObject3D, materials: IMaterial[]) {
        this.material = materials || undefined
    },

    initGeometry: function(this: IObject3D): void {
        const currentGeometry = this.geometry
        this._currentGeometry = null
        delete this.geometry
        Object.defineProperty(this, 'geometry', {
            get: iObjectCommons.getGeometry,
            set: iObjectCommons.setGeometry,
        })
        this.geometry = currentGeometry

        // Legacy
        if (!(this as any).setGeometry) {
            (this as any).setGeometry = (geometry: IGeometry) =>{
                const geom = this.geometry
                console.error('setGeometry is deprecated, use geometry property directly')
                this.geometry = geometry
                return geom
            }
        }
        // Legacy
        if (this.userData.setGeometry) console.error('userData.setGeometry already defined')
        this.userData.setGeometry = (g: any)=>{
            console.error('userData.setGeometry is deprecated, use setGeometry directly')
            this.geometry = g
        }

    },
    getGeometry: function(this: IObject3D&Mesh): IGeometry | undefined {
        return this._currentGeometry || undefined
    },
    setGeometry: function(this: IObject3D&Mesh, geometry: IGeometry | undefined): void {
        const geom = this.geometry || undefined
        // todo: check by uuid?
        if (geom === geometry) return
        if (geom) {
            this._onGeometryUpdate && geom.removeEventListener('geometryUpdate', this._onGeometryUpdate)
            if (geom.appliedMeshes) {
                geom.appliedMeshes.delete(this)
                geom.dispose(false)
            }
        }
        if (geometry) {
            if (!geometry.assetType) {
                // console.error('Geometry not upgraded')
                iGeometryCommons.upgradeGeometry.call(geometry)
            }
        }
        this._currentGeometry = geometry || null
        if (geometry) {
            this.updateMorphTargets()
            this._onGeometryUpdate && geometry.addEventListener('geometryUpdate', this._onGeometryUpdate)
            if (geometry.appliedMeshes) geometry.appliedMeshes.add(this)
        }
        this.dispatchEvent({type: 'geometryChanged', geometry: geometry ?? null, oldGeometry: geom, bubbleToParent: true, object: this})
        this.refreshUi()

    },

    refreshUi: function(this: IObject3D): void {
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    },

    dispatchEvent: (superDispatch: IObject3D['dispatchEvent']): IObject3D['dispatchEvent'] =>
        function(this: IObject3D, event): void {
            if ((event as IEvent<any>).target && (event as IEvent<any>).target !== this && this.acceptChildEvents === false) return
            if ((event as IObject3DEventMap['objectUpdate']).bubbleToParent || this.userData?.__autoBubbleToParentEvents?.includes(event.type)) {
                // console.log('parent dispatch', e, this.parentRoot, this.parent)
                const pRoot = this.parentRoot || this.parent
                if (this.parentRoot !== this) pRoot?.dispatchEvent(event)
            }
            superDispatch.call(this, event)
        },
    clone: (superClone: IObject3D['clone']): IObject3D['clone'] =>
        function(this: IObject3D, ...args): IObject3D {
            const userData = this.userData
            this.userData = {}
            const clone: any = superClone.call(this, ...args)
            this.userData = userData
            copyObject3DUserData(clone.userData, userData) // todo: do same for this.toJSON()
            const objParent = this.parentRoot || undefined
            if (objParent && objParent.assetType !== 'model') {
                console.warn('Cloning an IObject with a parent that is not an \'model\' is not supported')
            }
            iObjectCommons.upgradeObject3D.call(clone, objParent, this.objectProcessor)
            clone.userData.cloneParent = this.uuid
            return clone
        },
    copy: (superCopy: IObject3D['copy']): IObject3D['copy'] =>
        function(this: IObject3D, source: IObject3D, ...args): IObject3D {
            const lightTarget = this.isLight ? (this as ILight).target : null

            const userData = source.userData
            source.userData = {}

            const selfUserData = this.userData
            superCopy.call(this, source, ...args)
            this.userData = selfUserData

            source.userData = userData
            copyObject3DUserData(this.userData, source.userData) // todo: do same for object.toJSON()

            if (lightTarget && (this as ILight).target) { // For eg DirectionalLight2
                lightTarget.position.copy((this as ILight).target!.position)
                lightTarget.updateMatrixWorld()
                ;(this as ILight).target = lightTarget // because t is a child and because of UI.
            }

            return this
        },
    add: (superAdd: IObject3D['add']): IObject3D['add'] =>
        function(this: IObject3D, ...args): IObject3D {
            if (this.autoUpgradeChildren !== false) {
                for (const a of args) iObjectCommons.upgradeObject3D.call(a, this.parentRoot || this, this.objectProcessor)
            }
            return superAdd.call(this, ...args)
        },
    dispose: (superDispose?: IObject3D['dispose']) =>
        function(this: IObject3D, removeFromParent = true): void {
            if (removeFromParent && this.parent) {
                this.removeFromParent()
                delete this.parentRoot
            }

            this.dispatchEvent({type: 'dispose', bubbleToParent: false})

            // if (this.__disposed) {
            //     console.warn('Object already disposed', this)
            //     return
            // }
            // this.__disposed = true

            for (const c of [...this.children]) c?.dispose && c.dispose(false) // not removing the children from parent to preserve hierarchy
            // this.children = []

            // this.uiConfig?.dispose?.() // todo: make uiConfig.dispose

            superDispose?.call(this)
        },


}

/**
 * Converts three.js Object3D to IObject3D, setup object events, adds utility methods, and runs objectProcessor.
 * @param parent
 * @param objectProcessor
 */
function upgradeObject3D(this: IObject3D, parent?: IObject3D|undefined, objectProcessor?: IObjectProcessor): IObject3D {
    if (!this) return this
    // console.log('upgradeObject3D', this, parent, objectProcessor)
    // if (this.__disposed) {
    //     console.warn('re-init/re-add disposed object, things might not work as intended', this)
    //     delete this.__disposed
    // }
    if (!this.userData) this.userData = {}
    this.userData.uuid = this.uuid

    // not checking assetType but custom var __objectSetup because its required in types sometimes, check PerspectiveCamera2
    // if (this.assetType) return this

    if (this.userData.__objectSetup) return this
    this.userData.__objectSetup = true

    if (!this.objectProcessor) this.objectProcessor = objectProcessor || this.parent?.objectProcessor || parent?.objectProcessor

    if (!this.userData.__autoBubbleToParentEvents) this.userData.__autoBubbleToParentEvents = ['select']
    // Event bubbling. todo: set bubbleToParent in these events when dispatched from child and remove from here?

    if (this.isLight) this.assetType = 'light'
    else if (this.isCamera) this.assetType = 'camera'
    else if (this.isWidget) this.assetType = 'widget'
    else this.assetType = 'model'

    if (parent) this.parentRoot = parent

    // const oldFunctions = {
    //     dispatchEvent: this.dispatchEvent,
    //     clone: this.clone,
    //     copy: this.copy,
    //     add: this.add,
    //     dispose: this.dispose,
    // }
    // this.addEventListener('dispose', () => Object.assign(this, oldFunctions)) // todo: is this required?

    // typed because of type-checking
    this.dispatchEvent = iObjectCommons.dispatchEvent(this.dispatchEvent)
    this.dispose = iObjectCommons.dispose(this.dispose)
    this.clone = iObjectCommons.clone(this.clone)
    this.copy = iObjectCommons.copy(this.copy) // todo: do same for object.toJSON()
    this.add = iObjectCommons.add(this.add)

    if (!this.setDirty) this.setDirty = iObjectCommons.setDirty
    if (!this.refreshUi) this.refreshUi = iObjectCommons.refreshUi
    if (!this.autoScale) this.autoScale = iObjectCommons.autoScale.bind(this)
    if (!this.autoCenter) this.autoCenter = iObjectCommons.autoCenter.bind(this)
    if (!this.pivotToBoundsCenter) this.pivotToBoundsCenter = iObjectCommons.pivotToBoundsCenter.bind(this)
    if (!this.pivotToPoint) this.pivotToPoint = iObjectCommons.pivotToPoint.bind(this)

    // fired from Object3D.js
    this.addEventListener('added', iObjectCommons.eventCallbacks.onAddedToParent)
    this.addEventListener('removed', iObjectCommons.eventCallbacks.onRemovedFromParent)

    // this.addEventListener('dispose', ()=>{
    //     this.removeEventListener('added', iObjectCommons.eventCallbacks.onAddedToParent)
    //     this.removeEventListener('removed', iObjectCommons.eventCallbacks.onRemovedFromParent)
    // })

    if ((this.isMesh || this.isLine) && !this.userData.__meshSetup) {
        this.userData.__meshSetup = true

        this._onGeometryUpdate = (e) => iObjectCommons.eventCallbacks.onGeometryUpdate.call(this, e)

        // Material, Geometry prop init
        iObjectCommons.initMaterial.call(this)
        iObjectCommons.initGeometry.call(this)

        // from GLTFObject3DExtrasExtension
        if (!this.userData.__keepShadowDef) {
            const mat = Array.isArray(this.material) ? this.material[0] : this.material
            this.castShadow = !mat || !mat.transparent && !mat.transmission
            this.receiveShadow = true
            this.userData.__keepShadowDef = true
        }

        this.addEventListener('dispose', ()=>{

            (this.materials || [<IMaterial> this.material]).forEach(m => m?.dispose(false))
            this.geometry?.dispose(false)

            // if (this.material) {
            //     // const oldMats = Array.isArray(this.material) ? [...(this.material as IMaterial[])] : [this.material!]
            //     this.material = undefined // this will dispose material if not used by other meshes
            //     // delete this.material
            //     // for (const oldMat of oldMats) {
            //     //     if (oldMat && oldMat.userData && oldMat.appliedMeshes?.size === 0 && oldMat.userData.disposeOnIdle !== false) oldMat.dispose()
            //     // }
            // }
            // if (this.geometry) {
            //     // const oldGeom = this.geometry
            //     this.geometry = undefined // this will dispose geometry if not used by other meshes
            //     // delete this.geometry
            //     // if (oldGeom && oldGeom.userData && oldGeom.appliedMeshes?.size === 0 && oldGeom.userData.disposeOnIdle !== false) oldGeom.dispose()
            // }
            //
            // delete this._onGeometryUpdate
        })

    }

    if (!this.uiConfig && (this.assetType === 'model' || this.assetType === 'camera')) {
        // todo: lights/other types?
        iObjectCommons.makeUiConfig.call(this)
    }

    // todo: serialization?

    if (this.autoUpgradeChildren !== false) {
        const children = [...this.children]
        for (const c of children) upgradeObject3D.call(c, this)
    }

    // region Legacy

    // eslint-disable-next-line deprecation/deprecation
    !this.userData.dispose && (this.userData.dispose = () => {
        console.warn('userData.dispose is deprecated, use dispose directly')
        this.dispose && this.dispose()
    })
    // eslint-disable-next-line deprecation/deprecation
    !this.modelObject && Object.defineProperty(this, 'modelObject', {
        get: ()=>{
            console.error('modelObject is deprecated, use object directly')
            return this
        },
    })
    // eslint-disable-next-line deprecation/deprecation
    !this.userData.setDirty && (this.userData.setDirty = (e: any)=>{
        console.error('object.userData.setDirty is deprecated, use object.setDirty directly')
        this.setDirty?.(e)
    })

    // endregion

    this.objectProcessor?.processObject(this)

    return this
}
