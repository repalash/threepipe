/**
 * Attribute access on any geometry component - the subset of Blender's `AttributeAccessor` /
 * `MutableAttributeAccessor` (`blenkernel/BKE_attribute.hh`) that geometry nodes use: lookup with
 * implicit domain interpolation and type conversion, metadata, add/remove, built-in attribute rules.
 *
 * Storage is the kernel's `AttributeStorage` (the mesh's own, or a point cloud's / curves' / instances'),
 * so every geometry type shares one attribute model.
 */

import {AttrDomain, AttributeLayer, AttributeStorage} from '@threepipe/mesh-kernel'
import {allocate, DATA_TYPES, DataType, TypedArray} from './dataTypes'
import {GVArray} from './varray'
import {convertVArray, isConvertible} from './typeConversions'

export interface AttributeMeta {
    domain: AttrDomain
    type: DataType
}

/** `AttrBuiltinInfo` (`BKE_attribute.hh`): fixed domain and type, optional default and validator. */
export interface BuiltinAttribute {
    domain: AttrDomain
    type: DataType
    /** `deletable = false` attributes cannot be removed. */
    deletable?: boolean
    /** Value of elements when the attribute is created without data (`default_value`). */
    defaultValue?: readonly number[]
    /** `AttributeValidator`: applied to values written through Store Named Attribute / capture. */
    validate?: (v: number[]) => number[]
}

/** `bke::attribute_name_is_anonymous` (`BKE_anonymous_attribute_id.hh:24`). */
export function isAnonymousAttributeName(name: string): boolean {
    return name.startsWith('.a_')
}

/**
 * Accessor over one component's attributes. Subclasses give the domain sizes, the built-in table and
 * the domain interpolation (`adapt_domain`).
 */
export abstract class AttributeAccessor {
    abstract readonly storage: AttributeStorage
    abstract readonly builtins: Readonly<Record<string, BuiltinAttribute>>
    /** `domain_supported`. */
    abstract supportsDomain(domain: AttrDomain): boolean
    /** `adapt_domain` (`BKE_attribute.hh`): undefined when the pair is not supported. */
    abstract adaptDomain(varray: GVArray, from: AttrDomain, to: AttrDomain): GVArray | undefined

    domainSize(domain: AttrDomain): number {
        return this.storage.domainSizes[domain] ?? 0
    }

    contains(name: string): boolean {
        return this.storage.has(name)
    }

    isBuiltin(name: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.builtins, name)
    }

    /** `get_builtin_default`: the default element of a built-in attribute, or the type default. */
    builtinDefault(name: string): readonly number[] | undefined {
        const b = this.builtins[name]
        if (!b) return undefined
        return b.defaultValue ?? DATA_TYPES[b.type].defaultValue
    }

    lookupMeta(name: string): AttributeMeta | undefined {
        const layer = this.storage.get(name)
        if (!layer) return undefined
        return {domain: layer.domain, type: layer.type as DataType}
    }

    /** Layer names, in storage order (`foreach_attribute`). */
    names(): string[] {
        return this.storage.names()
    }

    /**
     * `lookup(name, domain, type)`: the attribute on `domain` as `type`, interpolated and converted as
     * needed. Undefined when it does not exist or cannot be adapted/converted.
     */
    lookup(name: string, domain?: AttrDomain, type?: DataType): GVArray | undefined {
        const layer = this.storage.get(name)
        if (!layer) return undefined
        let varray = GVArray.fromArray(layer.type as DataType, layer.data)
        if (domain !== undefined && domain !== layer.domain) {
            const adapted = this.adaptDomain(varray, layer.domain, domain)
            if (!adapted) return undefined
            varray = adapted
        }
        if (type !== undefined && type !== varray.type) {
            if (!isConvertible(varray.type, type)) return undefined
            varray = convertVArray(varray, type)
        }
        return varray
    }

    /** `lookup_or_default`. */
    lookupOrDefault(name: string, domain: AttrDomain, type: DataType, defaultValue?: readonly number[]): GVArray {
        return this.lookup(name, domain, type) ??
            GVArray.fromSingle(type, this.domainSize(domain), defaultValue ?? DATA_TYPES[type].defaultValue)
    }

    // region writing

    /**
     * `add(name, domain, type, init)`: false when the name exists, or a built-in name is given the
     * wrong domain or type. `init`: a typed array (moved in), a single value, or nothing (default).
     */
    add(name: string, domain: AttrDomain, type: DataType, init?: TypedArray | readonly number[]): boolean {
        if (this.storage.has(name)) return false
        const b = this.builtins[name]
        if (b && (b.domain !== domain || b.type !== type)) return false
        if (!this.supportsDomain(domain)) return false
        const size = this.domainSize(domain)
        const layer = this.storage.add({name, domain, type})
        const c = DATA_TYPES[type].components
        if (init && ArrayBuffer.isView(init) && init.length === size * c) {
            layer.data = init as never
        } else {
            const value = init ?? (b ? this.builtinDefault(name)! : DATA_TYPES[type].defaultValue)
            if (value.length === c) {
                const data = allocate(type, size, false)
                for (let i = 0; i < size; i++) for (let k = 0; k < c; k++) data[i * c + k] = value[k]
                layer.data = data as never
            } else if (value.length !== size * c) {
                this.storage.remove(name)
                throw new Error(`procedural: attribute '${name}' init has ${value.length} values, expected ${c} or ${size * c}`)
            }
        }
        return true
    }

    /** `remove(name)`: false for missing or non-deletable built-in attributes. */
    remove(name: string): boolean {
        const b = this.builtins[name]
        if (b && b.deletable === false) return false
        return this.storage.remove(name)
    }

    /** The raw layer for in-place writes (`lookup_for_write_span`). */
    layerForWrite(name: string): AttributeLayer | undefined {
        return this.storage.get(name)
    }

    /** `remove_anonymous()`. */
    removeAnonymous(): void {
        for (const name of this.storage.names()) if (isAnonymousAttributeName(name)) this.storage.remove(name)
    }

    hasAnonymous(): boolean {
        return this.storage.names().some(isAnonymousAttributeName)
    }

    // endregion
}

/** Accessor for geometry with a single domain (point clouds, instances): no interpolation. */
export class SingleDomainAccessor extends AttributeAccessor {
    constructor(
        readonly storage: AttributeStorage,
        readonly builtins: Readonly<Record<string, BuiltinAttribute>>,
        private readonly domain: AttrDomain,
    ) {
        super()
    }

    supportsDomain(domain: AttrDomain): boolean {
        return domain === this.domain
    }

    adaptDomain(varray: GVArray, from: AttrDomain, to: AttrDomain): GVArray | undefined {
        return from === to && from === this.domain ? varray : undefined
    }
}
