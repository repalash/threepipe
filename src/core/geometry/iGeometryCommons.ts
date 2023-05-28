import {UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometrySetDirtyOptions} from '../IGeometry'
import {toIndexedGeometry} from '../../three'

export const iGeometryCommons = {
    setDirty: function(this: IGeometry, options?: IGeometrySetDirtyOptions): void {
        this.dispatchEvent({bubbleToObject: true, ...options, type: 'geometryUpdate', geometry: this}) // this sets sceneUpdate in root scene
        this.refreshUi()
    },
    refreshUi: function(this: IGeometry) {
        this.uiConfig?.uiRefresh?.(true, 'postFrame', 1)
    },
    upgradeGeometry: upgradeGeometry,
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
                    type: 'button',
                    label: 'Center Geometry',
                    value: () => {
                        this.center()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Compute vertex normals',
                    value: () => {
                        if (this.hasAttribute('normal') && !confirm('Normals already exist, replace with computed normals?')) return
                        this.computeVertexNormals()
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Compute vertex tangents',
                    value: () => {
                        if (this.hasAttribute('tangent') && !confirm('Tangents already exist, replace with computed tangents?')) return
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
                    value: () => {
                        if (this.attributes.index) return
                        const tolerance = parseFloat(prompt('Tolerance', '-1') ?? '-1')
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
                    value: () => {
                        if (this.hasAttribute('uv1')) {
                            if (!confirm('uv1 already exists, replace with uv data?')) return
                        }
                        this.setAttribute('uv1', this.getAttribute('uv'))
                        this.setDirty()
                    },
                },
                {
                    type: 'button',
                    label: 'Remove vertex color attribute',
                    hidden: () => !this.hasAttribute('color'),
                    value: () => {
                        if (!this.hasAttribute('color')) {
                            prompt('No color attribute found')
                            return
                        }
                        if (!confirm('Remove color attribute?')) return
                        this.deleteAttribute('color')
                        this.setDirty()
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

export function upgradeGeometry(this: IGeometry) {
    if (this.assetType === 'geometry') return // already upgraded
    if (!this.isBufferGeometry) {
        console.error('Material is not a this', this)
        return
    }
    this.assetType = 'geometry'
    if (!this.setDirty) this.setDirty = iGeometryCommons.setDirty
    if (!this.refreshUi) this.refreshUi = iGeometryCommons.refreshUi
    if (!this.appliedMeshes) this.appliedMeshes = new Set()
    if (!this.userData) this.userData = {}
    this.uiConfig = iGeometryCommons.makeUiConfig.call(this)
    // todo: dispose uiconfig on geometry dispose

    // todo: add serialization?
}
