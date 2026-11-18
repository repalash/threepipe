import {IObject3D, ThreeViewer} from 'threepipe'

/**
 * Live counts of the models in the scene (`viewer.scene.modelRoot`), for the rows of an example card. They are counted
 * again after the scene changes (a file loaded or dropped, an object removed), when they are read.
 *
 * ```ts
 * const stats = modelStats(viewer)
 * createExampleCard(viewer, {actions: [
 *     {type: 'monitor', label: 'Triangles', getValue: () => stats.triangles.toLocaleString()},
 * ]})
 * ```
 */
export function modelStats(viewer: ThreeViewer) {
    let dirty = true
    const counts = {meshes: 0, triangles: 0, vertices: 0}
    viewer.scene.addEventListener('sceneUpdate', () => dirty = true)
    const update = () => {
        if (!dirty) return counts
        dirty = false
        counts.meshes = counts.triangles = counts.vertices = 0
        viewer.scene.modelRoot.traverse((o: IObject3D) => {
            const geometry = o.isMesh ? o.geometry : undefined
            if (!geometry) return
            // an instanced mesh draws its geometry once per instance
            const instances = (o as any).isInstancedMesh ? (o as any).count as number : 1
            const position = geometry.attributes.position
            const indices = geometry.index?.count ?? position?.count ?? 0
            counts.meshes++
            counts.triangles += Math.floor(indices / 3) * instances
            counts.vertices += (position?.count ?? 0) * instances
        })
        return counts
    }
    return {
        get meshes() { return update().meshes },
        get triangles() { return update().triangles },
        get vertices() { return update().vertices },
    }
}
