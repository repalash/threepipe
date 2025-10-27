import {SerializationMetaType, ThreeSerialization} from '../../../utils'

// not exported
class ItemRef {
    readonly isItemRef = true
    id: string
    constructor(id?: string) {
        this.id = id || ''
    }
    toJSON(meta?: SerializationMetaType) {
        if (!this.id) return {}
        if (meta) {
            if (!meta.typed) meta.typed = {}
            if (!meta.typed[this.id]) {
                const item = ReferenceManager.Get(this)
                if (item) {
                    if (item.__rootPath) {
                        meta.typed[this.id] = {
                            external: true,
                            rootPath: item.__rootPath,
                            rootPathOptions: item.__rootPathOptions,
                        }
                    } else {
                        meta.typed[this.id] = ThreeSerialization.Serialize(item, meta)
                    }
                }
            }
        }
        return {id: this.id}
    }

    ['_itemObject']: any

    fromJSON(data: any, meta?: SerializationMetaType) {
        if (data && typeof data.id === 'string') {
            this.id = data.id
            if (meta?.typed) {
                const itemData = meta.typed[this.id]
                const isLoaded = meta.__isLoadedResources
                const itemObject = isLoaded && itemData ? itemData : ThreeSerialization.Deserialize(itemData, meta)
                if (itemObject?.external && itemObject.rootPath) {
                    console.warn('ReferenceManager - External resources is expected to be loaded already in ImportMeta phase:', itemObject)
                } else {
                    this._itemObject = itemObject
                    if (isLoaded) meta.typed[this.id] = itemObject // cache the deserialized object, isLoaded is also true when resources are being loaded in ImportMeta
                }
            }
        }
        return this
    }
}

interface Item{
    id: string;
    refs: Map<any, Set<ItemRef>>;
    object: any
}

export class ReferenceManager {
    static {
        ThreeSerialization.MakeSerializable(ItemRef as any, 'ItemRef')
    }

    static Objects: Map<string, Item> = new Map()

    static Get(ref: ItemRef) {
        const item = this.Objects.get(ref.id)
        return item ? item.object : null
    }

    static Add(id: string, object: any, refOwner: any) {
        let item = this.Objects.get(id)
        if (!item) {
            item = {
                id,
                refs: new Map<any, Set<ItemRef>>(),
                object,
            }
            this.Objects.set(id, item)
        }
        // const count = item.refs.get(refOwner) || 0
        // item.refs.set(refOwner, count + 1)
        let refSet = item.refs.get(refOwner)
        if (!refSet) {
            refSet = new Set<ItemRef>()
            item.refs.set(refOwner, refSet)
        }
        const ref = new ItemRef(id)
        refSet.add(ref)
        return ref
    }

    static Remove(id: string, refOwner: any, ref: ItemRef) {
        const item = this.Objects.get(id)
        if (item) {
            const refs = item.refs.get(refOwner)
            if (refs && refs.has(ref)) {
                refs.delete(ref)
                if (refs.size === 0) {
                    item.refs.delete(refOwner)
                    if (item.refs.size === 0) {
                        this.Objects.delete(id)
                    }
                }
            }
        }
    }

    static Delete(object: any) {
        if (object) {
            for (const [id, item] of [...this.Objects]) {
                // object references
                item.refs.delete(object)
                if (item.refs.size === 0) {
                    this.Objects.delete(id)
                }
                // refs to object
                if (item.object === object) {
                    this.Objects.delete(id)
                }
            }
        } else {
            // this.Objects.clear()
        }
    }

    static RemoveOp(val: ItemRef | any, refOwner: any) {
        if (val !== undefined && (val as ItemRef).isItemRef) {
            const ref = val as ItemRef
            ReferenceManager.Remove(ref.id, refOwner, ref)
        }
    }

    static GetOp(val: ItemRef | any, warn = true) {
        if ((val as ItemRef).isItemRef) {
            const value = ReferenceManager.Get(val as ItemRef)
            if (!value) {
                if (warn) console.error('Object3DComponent: Reference not found', val)
                return null // todo we should not return null, should be special error object or something
            }
            return value
        }
        return undefined
    }

    static GetCached(valRaw: ItemRef | any) {
        if (valRaw && (valRaw as ItemRef).isItemRef && (valRaw as ItemRef)._itemObject) {
            const val = (valRaw as ItemRef)._itemObject
            ;(valRaw as ItemRef)._itemObject = undefined
            return val
        }
        return undefined
    }

}
