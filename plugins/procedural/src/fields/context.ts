/**
 * `bke::GeometryFieldContext` (`blenkernel/intern/geometry_fields.cc:59-230`): the component and domain
 * a field is evaluated on.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {AttributeAccessor} from '../geometry/attributeAccessor'
import {CurvesGeometry, Instances, MeshAccessor, PointCloud} from '../geometry/components'
import type {ComponentType} from '../geometry/GeometrySet'

export type ComponentData = MeshData | PointCloud | CurvesGeometry | Instances

export class FieldContext {
    private _attributes?: AttributeAccessor

    constructor(readonly type: ComponentType, readonly component: ComponentData, readonly domain: AttrDomain) {}

    /** `GeometryFieldContext(other, domain)`. */
    withDomain(domain: AttrDomain): FieldContext {
        return new FieldContext(this.type, this.component, domain)
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
            this._attributes = this.type === 'mesh' ? new MeshAccessor(c as MeshData) : (c as PointCloud | CurvesGeometry | Instances).accessor()
        }
        return this._attributes
    }

    /** Number of elements on this context's domain. */
    get size(): number {
        return this.attributes().domainSize(this.domain)
    }
}
