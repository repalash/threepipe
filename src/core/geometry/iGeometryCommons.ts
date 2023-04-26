import {UiObjectConfig} from 'uiconfig.js'
import {IGeometry, IGeometrySetDirtyOptions} from '../IGeometry'

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
                // {
                //     type: 'input',
                //     property: [this, 'name'],
                // },
                {
                    type: 'button',
                    label: 'Create uv2 from uv',
                    value: () => {
                        if (this.hasAttribute('uv2')) {
                            if (!confirm('uv2 already exists, replace with uv data?')) return
                        }
                        this.setAttribute('uv2', this.getAttribute('uv'))
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
                    },
                },
                // {
                //     type: 'button',
                //     label: 'Invert eigen vectors',
                //     value: () => {
                //         console.log(geometry)
                //         const offsets = geometry.userData.normalsCaptureOffsets
                //         if (!offsets) return
                //         const m = offsets.offsetMatrix as Matrix4
                //         console.log(offsets.offsetMatrix.toArray())
                //         console.log(m.determinant())
                //
                //         const m1 = new Matrix4().makeRotationX(Math.PI / 2)
                //         m.multiply(m1)
                //
                //         console.log(m.determinant())
                //         offsets.offsetMatrixInv.copy(m).invert()
                //         console.log(offsets.offsetMatrix.toArray())
                //     },
                // },
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
