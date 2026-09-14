/**
 * Generic attribute storage over the four mesh domains.
 *
 * Modelled on Blender's `AttributeStorage` (`blenkernel/BKE_attribute_storage.hh`): a mesh is four
 * element counts plus a bag of named, typed, domain-bound arrays. Topology itself lives in attributes
 * too (`.edge_verts`, `.corner_vert`, `.corner_edge`), which is what lets every operator resize, copy
 * and interpolate user data with the same code that handles positions.
 */

import {
    ArrayConstructor2,
    AttrDomain,
    ATTR_DOMAINS,
    ATTR_TYPE_INFO,
    AttrType,
    attrDomainName,
    BUILTIN_ATTRS,
    TypedArray2,
} from './constants'

export interface AttributeLayer {
    readonly name: string
    readonly domain: AttrDomain
    readonly type: AttrType
    /** Length is always `domainSize * components`. Replaced, not mutated, when the domain resizes. */
    data: TypedArray2
}

export interface AttributeInit {
    name: string
    domain: AttrDomain
    type: AttrType
    /** Optional initial contents. Copied, not adopted. Must be `size * components` long. */
    data?: ArrayLike<number>
}

function allocate(type: AttrType, count: number): TypedArray2 {
    const info = ATTR_TYPE_INFO[type]
    const arr = new (info.array as ArrayConstructor2)(count * info.components)
    if (info.defaultValue !== 0) arr.fill(info.defaultValue)
    return arr
}

/**
 * A set of named attribute layers, each bound to a domain.
 *
 * Domain sizes are owned by the containing mesh and passed in on resize, because several layers share
 * one domain and must stay the same length.
 */
export class AttributeStorage {
    private _layers = new Map<string, AttributeLayer>()

    /** Current element count per domain, indexed by {@link AttrDomain}. */
    readonly domainSizes: number[] = [0, 0, 0, 0]

    constructor(domainSizes?: Partial<Record<AttrDomain, number>>) {
        if (domainSizes) for (const d of ATTR_DOMAINS) this.domainSizes[d] = domainSizes[d] ?? 0
    }

    get size(): number {
        return this._layers.size
    }

    names(): string[] {
        return [...this._layers.keys()]
    }

    layers(): AttributeLayer[] {
        return [...this._layers.values()]
    }

    layersOnDomain(domain: AttrDomain): AttributeLayer[] {
        return this.layers().filter(l => l.domain === domain)
    }

    has(name: string): boolean {
        return this._layers.has(name)
    }

    get(name: string): AttributeLayer | undefined {
        return this._layers.get(name)
    }

    /**
     * Look up a layer, asserting its domain and type. Use this in operators so a mesh carrying a
     * wrongly-shaped attribute fails at the point of use with a readable message.
     */
    require(name: string, domain: AttrDomain, type: AttrType): AttributeLayer {
        const layer = this._layers.get(name)
        if (!layer) throw new Error(`mesh-kernel: missing attribute '${name}'`)
        if (layer.domain !== domain) {
            throw new Error(`mesh-kernel: attribute '${name}' is on domain ${attrDomainName(layer.domain)}, expected ${attrDomainName(domain)}`)
        }
        if (layer.type !== type) {
            throw new Error(`mesh-kernel: attribute '${name}' has type '${layer.type}', expected '${type}'`)
        }
        return layer
    }

    /**
     * Create a layer. Throws if the name is taken, or if a built-in name is given the wrong
     * domain/type (a silently mistyped `material_index` would corrupt every exporter downstream).
     */
    add({name, domain, type, data}: AttributeInit): AttributeLayer {
        if (this._layers.has(name)) throw new Error(`mesh-kernel: attribute '${name}' already exists`)
        const builtin = BUILTIN_ATTRS[name]
        if (builtin && (builtin.domain !== domain || builtin.type !== type)) {
            throw new Error(
                `mesh-kernel: built-in attribute '${name}' must be ${attrDomainName(builtin.domain)}/${builtin.type}, ` +
                `got ${attrDomainName(domain)}/${type}`)
        }
        const count = this.domainSizes[domain]
        const arr = allocate(type, count)
        if (data) {
            const expected = count * ATTR_TYPE_INFO[type].components
            if (data.length !== expected) {
                throw new Error(`mesh-kernel: attribute '${name}' initial data has length ${data.length}, expected ${expected}`)
            }
            arr.set(data as ArrayLike<number> & Iterable<number>)
        }
        const layer: AttributeLayer = {name, domain, type, data: arr}
        this._layers.set(name, layer)
        return layer
    }

    /** Get an existing layer or create it. Existing layers must match the requested domain and type. */
    ensure(name: string, domain: AttrDomain, type: AttrType): AttributeLayer {
        const existing = this._layers.get(name)
        if (existing) return this.require(name, domain, type)
        return this.add({name, domain, type})
    }

    remove(name: string): boolean {
        return this._layers.delete(name)
    }

    /**
     * Resize one domain, preserving the leading `min(old, new)` elements of every layer on it.
     * Grown slots get the type's default value.
     */
    resizeDomain(domain: AttrDomain, count: number): void {
        if (count < 0 || !Number.isInteger(count)) throw new Error(`mesh-kernel: bad domain size ${count}`)
        if (this.domainSizes[domain] === count) return
        for (const layer of this._layers.values()) {
            if (layer.domain !== domain) continue
            const next = allocate(layer.type, count)
            const copy = Math.min(layer.data.length, next.length)
            // `subarray` avoids a temporary; both arrays share the same element type by construction.
            if (copy > 0) next.set(layer.data.subarray(0, copy) as never)
            layer.data = next
        }
        this.domainSizes[domain] = count
    }

    /** Deep copy, including the contents of every layer. */
    clone(): AttributeStorage {
        const out = new AttributeStorage()
        for (const d of ATTR_DOMAINS) out.domainSizes[d] = this.domainSizes[d]
        for (const layer of this._layers.values()) {
            out._layers.set(layer.name, {
                name: layer.name,
                domain: layer.domain,
                type: layer.type,
                data: layer.data.slice() as TypedArray2,
            })
        }
        return out
    }

    /**
     * Check that every layer's length agrees with its domain size.
     * Returns a list of human-readable problems; empty means consistent.
     */
    validate(): string[] {
        const problems: string[] = []
        for (const layer of this._layers.values()) {
            const expected = this.domainSizes[layer.domain] * ATTR_TYPE_INFO[layer.type].components
            if (layer.data.length !== expected) {
                problems.push(
                    `attribute '${layer.name}' (${attrDomainName(layer.domain)}/${layer.type}) has ` +
                    `${layer.data.length} values, expected ${expected}`)
            }
        }
        return problems
    }
}
