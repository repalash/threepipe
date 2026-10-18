/**
 * `bke::GeometryFieldContext` (`blenkernel/intern/geometry_fields.cc:59-230`): the component and domain
 * a field is evaluated on.
 */

import {AttrDomain, AttributeStorage, MeshData} from '@threepipe/mesh-kernel'
import {AttributeAccessor, SingleDomainAccessor} from '../geometry/attributeAccessor'
import {CurvesGeometry, Instances, MeshAccessor, PointCloud} from '../geometry/components'
import type {ComponentType} from '../geometry/GeometrySet'

export type ComponentData = MeshData | PointCloud | CurvesGeometry | Instances

export class FieldContext {
    private _attributes?: AttributeAccessor
    private _size?: number

    constructor(readonly type: ComponentType | 'none', readonly component: ComponentData | undefined, readonly domain: AttrDomain) {}

    /**
     * A context with no geometry, only a size: `PointsFieldContext` (`node_geo_points.cc`) and the
     * other "index only" contexts. Geometry inputs read as their defaults there.
     */
    static forSize(size: number): FieldContext {
        const c = new FieldContext('none', undefined, AttrDomain.Point)
        c._size = size
        return c
    }

    /** `ListFieldContext` (`list_function_eval.hh`): `size` list elements; only Index and ID have values (the index). */
    static forList(size: number): FieldContext {
        const c = FieldContext.forSize(size)
        c.isList = true
        return c
    }

    /** {@link forList}. */
    isList = false

    /** `GeometryFieldContext(other, domain)`. */
    withDomain(domain: AttrDomain): FieldContext {
        const c = new FieldContext(this.type, this.component, domain)
        c._size = this._size
        return c
    }

    get mesh(): MeshData | undefined {
        return this.type === 'mesh' ? this.component as MeshData : undefined
    }

    get pointCloud(): PointCloud | undefined {
        return this.type === 'pointcloud' ? this.component as PointCloud : undefined
    }

    get curves(): CurvesGeometry | undefined {
        return this.type === 'curves' ? this.component as CurvesGeometry : undefined
    }

    get instances(): Instances | undefined {
        return this.type === 'instances' ? this.component as Instances : undefined
    }

    attributes(): AttributeAccessor {
        if (!this._attributes) {
            const c = this.component
            if (!c) {
                this._attributes = new SingleDomainAccessor(new AttributeStorage({[AttrDomain.Point]: this._size ?? 0}), {}, AttrDomain.Point)
            } else {
                this._attributes = this.type === 'mesh' ? new MeshAccessor(c as MeshData) : (c as PointCloud | CurvesGeometry | Instances).accessor()
            }
        }
        return this._attributes
    }

    /** Number of elements on this context's domain. */
    get size(): number {
        return this._size ?? this.attributes().domainSize(this.domain)
    }
}
