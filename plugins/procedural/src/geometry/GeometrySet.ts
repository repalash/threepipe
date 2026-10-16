/**
 * `GeometrySet` (`blenkernel/BKE_geometry_set.hh:151`): up to one mesh, point cloud, curves and
 * instances component, plus a name.
 *
 * Values flowing between nodes are treated as immutable. {@link copy} shares the components;
 * `*ForWrite()` clones a shared component before the first write, which is Blender's implicit sharing
 * (`BLI_implicit_sharing.hh`) at component granularity.
 */

import {AttrDomain, MeshData} from '@threepipe/mesh-kernel'
import {AttributeAccessor} from './attributeAccessor'
import {CurvesGeometry, Instances, MeshAccessor, PointCloud} from './components'

export type ComponentType = 'mesh' | 'pointcloud' | 'curves' | 'instances'

/** Order Blender iterates components in (`GeometryComponent::Type`, `BKE_geometry_set.hh:77`). */
export const COMPONENT_ORDER: readonly ComponentType[] = ['mesh', 'pointcloud', 'instances', 'curves']

export class GeometrySet {
    name = ''
    private _mesh?: MeshData
    private _pointCloud?: PointCloud
    private _curves?: CurvesGeometry
    private _instances?: Instances
    /** Components this set may write in place. */
    private readonly owned = new Set<ComponentType>()

    static fromMesh(mesh: MeshData): GeometrySet {
        const g = new GeometrySet()
        g.setMesh(mesh)
        return g
    }

    static fromPointCloud(pc: PointCloud): GeometrySet {
        const g = new GeometrySet()
        g.setPointCloud(pc)
        return g
    }

    static fromCurves(c: CurvesGeometry): GeometrySet {
        const g = new GeometrySet()
        g.setCurves(c)
        return g
    }

    static fromInstances(i: Instances): GeometrySet {
        const g = new GeometrySet()
        g.setInstances(i)
        return g
    }

    get mesh(): MeshData | undefined {
        return this._mesh
    }

    get pointCloud(): PointCloud | undefined {
        return this._pointCloud
    }

    get curves(): CurvesGeometry | undefined {
        return this._curves
    }

    get instances(): Instances | undefined {
        return this._instances
    }

    has(type: ComponentType): boolean {
        return this.get(type) !== undefined
    }

    get(type: ComponentType): MeshData | PointCloud | CurvesGeometry | Instances | undefined {
        switch (type) {
        case 'mesh': return this._mesh
        case 'pointcloud': return this._pointCloud
        case 'curves': return this._curves
        case 'instances': return this._instances
        }
    }

    /** `is_empty()`: no component at all. */
    get isEmpty(): boolean {
        return !this._mesh && !this._pointCloud && !this._curves && !this._instances
    }

    /**
     * Set the mesh. By default the set takes ownership (writes go in place); pass `shared` when the
     * mesh also lives elsewhere, so the first write clones it.
     */
    setMesh(mesh: MeshData | undefined, shared = false): void {
        this._mesh = mesh
        this.own('mesh', !!mesh && !shared)
    }

    setPointCloud(pc: PointCloud | undefined, shared = false): void {
        this._pointCloud = pc
        this.own('pointcloud', !!pc && !shared)
    }

    setCurves(c: CurvesGeometry | undefined, shared = false): void {
        this._curves = c
        this.own('curves', !!c && !shared)
    }

    setInstances(i: Instances | undefined, shared = false): void {
        this._instances = i
        this.own('instances', !!i && !shared)
    }

    private own(type: ComponentType, owned: boolean): void {
        if (owned) this.owned.add(type)
        else this.owned.delete(type)
    }

    /** Set a component of `type` taken from `from`, shared with it. */
    setShared(type: ComponentType, from: GeometrySet): void {
        switch (type) {
        case 'mesh': return this.setMesh(from.mesh, true)
        case 'pointcloud': return this.setPointCloud(from.pointCloud, true)
        case 'curves': return this.setCurves(from.curves, true)
        case 'instances': return this.setInstances(from.instances, true)
        }
    }

    remove(type: ComponentType): void {
        switch (type) {
        case 'mesh': return this.setMesh(undefined)
        case 'pointcloud': return this.setPointCloud(undefined)
        case 'curves': return this.setCurves(undefined)
        case 'instances': return this.setInstances(undefined)
        }
    }

    /** Shallow copy sharing every component; neither set may write a shared component in place. */
    copy(): GeometrySet {
        const g = new GeometrySet()
        g.name = this.name
        g._mesh = this._mesh
        g._pointCloud = this._pointCloud
        g._curves = this._curves
        g._instances = this._instances
        this.owned.clear()
        return g
    }

    meshForWrite(): MeshData | undefined {
        if (this._mesh && !this.owned.has('mesh')) this.setMesh(this._mesh.clone())
        return this._mesh
    }

    pointCloudForWrite(): PointCloud | undefined {
        if (this._pointCloud && !this.owned.has('pointcloud')) this.setPointCloud(this._pointCloud.clone())
        return this._pointCloud
    }

    curvesForWrite(): CurvesGeometry | undefined {
        if (this._curves && !this.owned.has('curves')) this.setCurves(this._curves.clone())
        return this._curves
    }

    instancesForWrite(): Instances | undefined {
        if (this._instances && !this.owned.has('instances')) this.setInstances(this._instances.clone())
        return this._instances
    }

    /** Read accessor of a component (`GeometryComponent::attributes()`). */
    attributes(type: ComponentType): AttributeAccessor | undefined {
        switch (type) {
        case 'mesh': return this._mesh ? new MeshAccessor(this._mesh) : undefined
        case 'pointcloud': return this._pointCloud?.accessor()
        case 'curves': return this._curves?.accessor()
        case 'instances': return this._instances?.accessor()
        }
    }

    /** Write accessor: makes the component owned first (`attributes_for_write()`). */
    attributesForWrite(type: ComponentType): AttributeAccessor | undefined {
        switch (type) {
        case 'mesh': {
            const m = this.meshForWrite()
            return m ? new MeshAccessor(m) : undefined
        }
        case 'pointcloud': return this.pointCloudForWrite()?.accessor()
        case 'curves': return this.curvesForWrite()?.accessor()
        case 'instances': return this.instancesForWrite()?.accessor()
        }
    }

    /** Domain size of a component (`attribute_domain_size`). */
    domainSize(type: ComponentType, domain: AttrDomain): number {
        return this.attributes(type)?.domainSize(domain) ?? 0
    }

    /** Remove anonymous attributes from every component (`geometry_nodes_execute.cc:453`), recursively into instance geometry. */
    removeAnonymousAttributes(): void {
        for (const type of COMPONENT_ORDER) {
            const read = this.attributes(type)
            if (read?.hasAnonymous()) this.attributesForWrite(type)!.removeAnonymous()
        }
        const inst = this._instances
        if (inst && inst.references.some(r => r.type === 'geometry')) {
            const w = this.instancesForWrite()!
            w.references = w.references.map(r => {
                if (r.type !== 'geometry') return r
                const g = r.geometry.copy()
                g.removeAnonymousAttributes()
                return {type: 'geometry', geometry: g}
            })
        }
    }

    describe(): string {
        const parts: string[] = []
        if (this._mesh) parts.push(`mesh(${this._mesh.vertsNum}v ${this._mesh.edgesNum}e ${this._mesh.facesNum}f)`)
        if (this._pointCloud) parts.push(`points(${this._pointCloud.pointsNum})`)
        if (this._curves) parts.push(`curves(${this._curves.curvesNum}c ${this._curves.pointsNum}p)`)
        if (this._instances) parts.push(`instances(${this._instances.instancesNum}, ${this._instances.references.length} refs)`)
        return parts.length ? parts.join(' ') : 'empty'
    }
}
