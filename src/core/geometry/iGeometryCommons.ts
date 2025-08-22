import {UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometrySetDirtyOptions} from '../IGeometry'
import {autoGPUInstanceMeshes, toIndexedGeometry} from '../../three/utils'
import {BufferGeometry, Vector3} from 'three'
import {ThreeViewer} from '../../viewer'
import {IObject3D} from '../IObject'

export const iGeometryCommons = {
    setDirty: function(this: IGeometry, options?: IGeometrySetDirtyOptions): void {
        this.dispatchEvent({bubbleToObject: true, ...options, type: 'geometryUpdate', geometry: this}) // this sets sceneUpdate in root scene
        this.refreshUi()
    },
    refreshUi: function(this: IGeometry) {
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    },
    /** @ignore */
    dispose: (superDispose: BufferGeometry['dispose']): IGeometry['dispose'] =>
        function(this: IGeometry, force = true): void {
            if (!force && this.userData.disposeOnIdle === false) return
            superDispose.call(this)
        },
    /** @ignore */
    clone: (superClone: BufferGeometry['clone']): IGeometry['clone'] =>
        function(this: IGeometry): IGeometry {
            return iGeometryCommons.upgradeGeometry.call(superClone.call(this))
        },
    upgradeGeometry: upgradeGeometry,
    /** @ignore */
    center: (superCenter: BufferGeometry['center']): IGeometry['center'] =>
        function(this: IGeometry, offset?: Vector3, keepWorldPosition = false, setDirty = true): IGeometry {
            if (keepWorldPosition) {
                offset = offset ? offset.clone() : new Vector3()
                superCenter.call(this, offset)
                offset.negate()
                const meshes = this.appliedMeshes
                for (const m of meshes) {
                    m.updateMatrix()
                    m.position.copy(offset).applyMatrix4(m.matrix)
                    if (setDirty) m.setDirty()
                }
            } else {
                superCenter.call(this, offset)
            }
            if (setDirty) this.setDirty()
            return this
        },
    center2: function(this: IGeometry, offset?: Vector3, keepWorldPosition = false, setDirty = true): ()=>void {
        const offset1 = offset ? offset : new Vector3()
        if (keepWorldPosition) {
            this.center(offset1, false, false)
            const meshes = this.appliedMeshes
            const positions = new WeakMap<IObject3D, Vector3>()
            for (const m of meshes) {
                m.updateMatrix()
                positions.set(m, m.position.clone())
                m.position.set(-offset1.x, -offset1.y, -offset1.z).applyMatrix4(m.matrix)
                if (setDirty) m.setDirty()
            }
            if (setDirty) this.setDirty()
            return ()=>{
                // undo
                for (const m of meshes) {
                    const pos = positions.get(m)
                    if (!pos) {
                        console.warn('GeometryCommons: No position found for mesh', m)
                        continue
                    }
                    m.position.copy(pos)
                    if (setDirty) m.setDirty()
                }
                if (setDirty) this.setDirty()
            }
        } else {
            this.center(offset1, false, false)
            if (setDirty) this.setDirty()
            return ()=>{
                // undo
                this.translate(-offset1.x, -offset1.y, -offset1.z)
                if (setDirty) this.setDirty()
            }
        }
    },
    makeUiConfig: function(this: IGeometry): UiObjectConfig {
        if (this.uiConfig) return this.uiConfig
        return {
            label: 'Geometry',
            type: 'folder',
            children: [
                {
                    type: 'input',
                    property: [this, 'uuid'],
                    disabled: true,
                },
                {
                    type: 'input',
                    property: [this, 'name'],
                },
                {
                    type: 'divider',
                },
                {
                    type: 'button',
                    label: 'Center Geometry',
                    value: async() => {
                        if (!await ThreeViewer.Dialog.confirm('This will move the objects based on the geometry center, do you want to continue?')) return
                        return this.center2()
                    },
                },
                {
                    type: 'button',
                    label: 'Center Geometry (keep position)',
                    value: async() => {
                        if (!await ThreeViewer.Dialog.confirm('This will move the geometry center keeping the object position, do you want to continue?')) return
                        return this.center2(undefined, true)
                    },
                },
                {
                    type: 'button',
                    label: 'Compute vertex normals',
                    value: async() => {
                        if (this.hasAttribute('normal') && !await ThreeViewer.Dialog.confirm('Normals already exist, replace with computed normals?\nThis action cannot be undone.')) return
                        this.computeVertexNormals()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Compute vertex tangents',
                    value: async() => {
                        if (this.hasAttribute('tangent') && !await ThreeViewer.Dialog.confirm('Tangents already exist, replace with computed tangents?\nThis action cannot be undone.')) return
                        this.computeTangents()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Normalize normals',
                    value: () => {
                        this.normalizeNormals()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Convert to indexed',
                    hidden: () => !!this.index,
                    value: async() => {
                        if (this.attributes.index) return
                        const tolerance = parseFloat(await ThreeViewer.Dialog.prompt('Convert to Indexed: Tolerance?', '-1') ?? '-1')
                        toIndexedGeometry(this, tolerance)
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Convert to non-indexed',
                    hidden: () => !this.index,
                    value: () => {
                        if (!this.attributes.index) return
                        this.toNonIndexed()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Create uv1 from uv',
                    value: async() => {
                        if (this.hasAttribute('uv1')) {
                            if (!await ThreeViewer.Dialog.confirm('uv1 already exists, replace with uv data?\nThis action cannot be undone.')) return
                        }
                        this.setAttribute('uv1', this.getAttribute('uv'))
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Remove vertex color attribute',
                    hidden: () => !this.hasAttribute('color'),
                    value: async() => {
                        if (!this.hasAttribute('color')) {
                            await ThreeViewer.Dialog.alert('No color attribute found')
                            return
                        }
                        if (!await ThreeViewer.Dialog.confirm('Remove color attribute?')) return
                        this.deleteAttribute('color')
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Auto GPU Instances',
                    hidden: ()=> !this.appliedMeshes || this.appliedMeshes.size < 2,
                    value: async()=>{
                        if (!await ThreeViewer.Dialog.confirm('This will automatically create Instanced Mesh from geometry instances. This action is irreversible, do you want to continue?')) return
                        autoGPUInstanceMeshes(this)
                    },
                },
                {
                    type: 'input',
                    label: 'Mesh count',
                    getValue: () => this.appliedMeshes?.size ?? 0,
                    disabled: true,
                },
            ],
        }
    },
}

function upgradeGeometry(this: IGeometry) {
    if (this.assetType === 'geometry') return this// already upgraded
    if (!this.isBufferGeometry) {
        console.error('Geometry is not a BufferGeometry', this)
        return this
    }
    this.assetType = 'geometry'

    this.dispose = iGeometryCommons.dispose(this.dispose)
    this.center = iGeometryCommons.center(this.center)
    this.clone = iGeometryCommons.clone(this.clone)
    if (!this.center2) this.center2 = iGeometryCommons.center2

    if (!this.setDirty) this.setDirty = iGeometryCommons.setDirty
    if (!this.refreshUi) this.refreshUi = iGeometryCommons.refreshUi

    if (!this.appliedMeshes) this.appliedMeshes = new Set()
    if (!this.userData) this.userData = {}
    this.uiConfig = iGeometryCommons.makeUiConfig.call(this)

    // todo: dispose uiconfig on geometry dispose

    // todo: add serialization?

    return this
}
