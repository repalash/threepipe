/**
 * `geometry::join_geometries` (`geometry/intern/join_geometries.cc`) and
 * `geometry::foreach_real_geometry` (`geometry/intern/foreach_geometry.cc`).
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {DATA_TYPES, DataType} from './dataTypes'
import {GeometrySet, ComponentType} from './GeometrySet'
import {Instances, InstanceReference, instanceReferenceEquals} from './components'
import {realizeInstances, ensureGeometryInstances} from './realizeInstances'
import type {SceneProvider} from '../runtime/context'

/** `GeometryComponent::is_empty()`. */
function componentEmpty(g: GeometrySet, type: ComponentType): boolean {
    switch (type) {
    case 'mesh': return !g.mesh || (g.mesh.vertsNum === 0 && g.mesh.edgesNum === 0 && g.mesh.facesNum === 0)
    case 'pointcloud': return !g.pointCloud || g.pointCloud.pointsNum === 0
    case 'curves': return !g.curves || g.curves.curvesNum === 0
    case 'instances': return !g.instances || g.instances.instancesNum === 0
    }
}

/** `join_attributes` (`join_geometries.cc:118`) for instances: all attributes except the ignored ones. */
function joinInstanceAttributes(src: Instances[], dst: Instances): void {
    const names: string[] = []
    const kinds: {domain: AttrDomain, type: DataType}[] = []
    for (const inst of src) {
        const acc = inst.accessor()
        for (const name of acc.names()) {
            if (name === '.reference_index') continue
            const meta = acc.lookupMeta(name)!
            const i = names.indexOf(name)
            if (i < 0) {
                names.push(name)
                kinds.push({domain: meta.domain, type: meta.type})
            }
            // `GatheredAttributes::add` merges kinds; instances only have one domain and these share a type in practice.
        }
    }
    const dacc = dst.accessor()
    names.forEach((name, ai) => {
        const type = kinds[ai].type
        if (!dacc.contains(name)) dacc.add(name, AttrDomain.Instance, type)
        const layer = dst.attributes.get(name)!
        const c = DATA_TYPES[type].components
        let offset = 0
        for (const inst of src) {
            const v = inst.accessor().lookupOrDefault(name, AttrDomain.Instance, type)
            for (let i = 0; i < inst.instancesNum; i++) for (let k = 0; k < c; k++) layer.data[(offset + i) * c + k] = v.get(i, k)
            offset += inst.instancesNum
        }
    })
}

/** `join_instances` (`join_geometries.cc:145`). */
function joinInstances(src: Instances[], allowMerging: boolean, result: GeometrySet): void {
    const total = src.reduce((s, i) => s + i.instancesNum, 0)
    const dst = new Instances(total)
    const handles = dst.referenceHandles
    const cache = new Map<InstanceReference, number>()
    let offset = 0
    for (const inst of src) {
        const map = inst.references.map(r => {
            if (!allowMerging) {
                dst.references.push(r)
                return dst.references.length - 1
            }
            // `lookup_or_add_cb(src_reference)` keys on equality, then `add_new_reference`.
            for (const [k, h] of cache) {
                if (instanceReferenceEquals(k, r)) return h
            }
            dst.references.push(r)
            cache.set(r, dst.references.length - 1)
            return dst.references.length - 1
        })
        for (let i = 0; i < inst.instancesNum; i++) handles[offset + i] = map[inst.referenceHandles[i]]
        offset += inst.instancesNum
    }
    joinInstanceAttributes(src, dst)
    result.setInstances(dst)
}

/** `join_component_type` (`join_geometries.cc:188`). */
function joinComponentType(type: ComponentType, src: GeometrySet[], allowMerging: boolean, result: GeometrySet, scene: SceneProvider | undefined): void {
    const with_ = src.filter(g => !componentEmpty(g, type))
    if (!with_.length) return
    if (with_.length === 1) {
        // `result.add(component)`: the component is shared, not copied.
        result.setShared(type, with_[0])
        return
    }
    if (type === 'instances') {
        joinInstances(with_.map(g => g.instances!), allowMerging, result)
        return
    }
    // One identity instance per component, realized with original ids and without instance attributes.
    const inst = new Instances(with_.length)
    inst.transforms.fill(0)
    for (let i = 0; i < with_.length; i++) {
        const t = inst.transforms.subarray(i * 16, i * 16 + 16)
        t[0] = t[5] = t[10] = t[15] = 1
        const tmp = new GeometrySet()
        tmp.setShared(type, with_[i])
        inst.references.push({type: 'geometry', geometry: tmp})
        inst.referenceHandles[i] = i
    }
    const joined = realizeInstances(GeometrySet.fromInstances(inst), {keepOriginalIds: true, realizeInstanceAttributes: false, scene})
    switch (type) {
    case 'mesh': result.setMesh(joined.mesh); break
    case 'pointcloud': result.setPointCloud(joined.pointCloud); break
    case 'curves': result.setCurves(joined.curves); break
    }
}

/** `join_geometries(geometries, filter, component_types, allow_merging_instance_references)` (`:236`). */
export function joinGeometries(geometries: GeometrySet[], options: {allowMergingInstanceReferences?: boolean, scene?: SceneProvider} = {}): GeometrySet {
    const result = new GeometrySet()
    result.name = geometries.length ? geometries[0].name : ''
    // Supported types in Blender's order: mesh, point cloud, instances, volume, curves, grease pencil, edit.
    for (const type of ['mesh', 'pointcloud', 'instances', 'curves'] as ComponentType[]) {
        joinComponentType(type, geometries, options.allowMergingInstanceReferences ?? true, result, options.scene)
    }
    return result
}

/**
 * `foreach_real_geometry` (`foreach_geometry.cc:70`): run `fn` once per distinct non-instance part of the
 * geometry and of every geometry instanced by it (object and collection references become geometry
 * references first, `ensure_geometry_instances`), then join each result back at every place it came
 * from. Distinct means `GeometrySet::operator==` (same components and name), so shared geometry is
 * processed once and stays shared, as in Blender. Empty parts are passed to `fn` too.
 */
export function foreachRealGeometry(geometry: GeometrySet, fn: (g: GeometrySet) => void, scene: SceneProvider | undefined): GeometrySet {
    const root = geometry.copy()
    const real: {geometry: GeometrySet, paths: number[][]}[] = []
    // `extract_real_geometries_recursive` (:13).
    const extract = (g: GeometrySet, path: number[]) => {
        const r = g.copy()
        r.remove('instances')
        for (const t of ['mesh', 'pointcloud', 'curves'] as ComponentType[]) g.remove(t)
        const entry = real.find(e => e.geometry.equals(r))
        if (entry) entry.paths.push(path.slice())
        else real.push({geometry: r, paths: [path.slice()]})
        const inst = g.instancesForWrite()
        if (!inst) return
        ensureGeometryInstances(inst, scene)
        inst.references.forEach((ref, i) => {
            if (ref.type !== 'geometry') return
            // `references_for_write()`: the sub-geometry is edited in place.
            const sub = ref.geometry.copy()
            inst.references[i] = {type: 'geometry', geometry: sub}
            path.push(i)
            extract(sub, path)
            path.pop()
        })
    }
    extract(root, [])
    for (const e of real) fn(e.geometry)
    // `reinsert_modified_geometry_recursive` (:41).
    const reinsert = (g: GeometrySet, insert: GeometrySet, path: number[]): GeometrySet => {
        if (!path.length) {
            // Old geometry first so the instance reference paths stay valid; no reference merging.
            return joinGeometries([g, insert], {allowMergingInstanceReferences: false, scene})
        }
        const inst = g.instancesForWrite()!
        const ref = inst.references[path[0]]
        if (ref.type !== 'geometry') throw new Error('procedural: foreach_real_geometry: path does not lead to geometry')
        inst.references[path[0]] = {type: 'geometry', geometry: reinsert(ref.geometry, insert, path.slice(1))}
        return g
    }
    let out = root
    for (const e of real) for (const path of e.paths) out = reinsert(out, e.geometry, path)
    return out
}
