import {IObject3D} from '../core'
import {IObjectExtension} from '../core/IObject'
import {Event} from 'three'
import {generateUUID} from '../three'

export class Object3DManager {
    private _root: IObject3D | undefined
    private _objects: IObject3D[] = []
    private _objectExtensions: IObjectExtension[] = []

    constructor() {
        this._objRemoved = this._objRemoved.bind(this)
        this._objAdded = this._objAdded.bind(this)
    }

    setRoot(root: IObject3D) {
        this._root = root
    }

    registerObject(obj: IObject3D) {
        if (!obj || !obj.uuid) return
        const existing = this._objects.find(o => o.uuid === obj.uuid)
        if (existing) {
            if (existing && obj !== existing) {
                console.error('AssetManager - Object with the same uuid already registered', obj, existing)
            }
            return
        }
        this._objects.push(obj)
        obj.addEventListener('removed', this._objRemoved)
        obj.removeEventListener('added', this._objAdded)
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
    }

    unregisterObject(obj: IObject3D) {
        if (!obj || !obj.uuid) return false
        obj.addEventListener('removed', this._objRemoved)
        const ind = this._objects.findIndex(o => o.uuid === obj.uuid)
        if (ind < 0) return false
        this._objects.splice(ind, 1)
        return true
        // todo - extensions are not removed from the object, so they can be reused later
        // if (obj.objectExtensions) {
        //     for (const ext of this._objectExtensions) {
        //         const ind1 = obj.objectExtensions.indexOf(ext)
        //         if (ind1 >= 0) obj.objectExtensions.splice(ind1, 1)
        //     }
        // }
    }

    private _objRemoved = (ev: Event<'removed', IObject3D>) => {
        if (!ev.target) return
        const res = this.unregisterObject(ev.target)
        if (res) {
            ev.target.addEventListener('added', this._objAdded)
        }
    }
    private _objAdded = (ev: Event<'added', IObject3D>) => {
        if (!ev.target) return
        let inRoot = false
        ev.target.traverseAncestors(a => {
            if (a === this._root) inRoot = true
        })
        if (!inRoot) return
        this.registerObject(ev.target)
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

    dispose() {
        this._objects.forEach(o => {
            o.removeEventListener('removed', this._objRemoved)
            o.removeEventListener('added', this._objAdded)
        })
        this._objects = []
        this._objectExtensions = []
        // this._root = undefined
    }
}
