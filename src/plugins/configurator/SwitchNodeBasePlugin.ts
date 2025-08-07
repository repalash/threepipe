import {Object3D, Vector3} from 'three'
import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {PickingPlugin} from '../interaction/PickingPlugin'
import {UiObjectConfig} from 'uiconfig.js'
import {serialize} from 'ts-browser-helpers'
import {snapObject} from '../../three'
import {IObject3D} from '../../core'

/**
 * Switch Node Plugin (Base)
 *
 * This plugin allows you to configure object variations in a file and apply them in the scene.
 * Each SwitchNode is a parent object with multiple direct children. Only one child is visible at a time.
 * This works by toggling the `visible` property of the children of a parent object.
 * The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
 * It also provides a function to create snapshot previews of individual variations. This creates a limited render of the object with the selected child visible.
 * To get a proper render, it's better to render it offline and set the image as a preview.
 *
 * See `SwitchNodePlugin` in [plugin-configurator](https://threepipe.org/plugins/configurator/docs/index.html) for example on inheriting with a custom UI renderer.
 *
 * @category Plugins
 */
export class SwitchNodeBasePlugin extends AViewerPluginSync {
    public static readonly PluginType = 'SwitchNodePlugin'

    enabled = true
    private _picking: PickingPlugin | undefined
    private _uiNeedRefresh = false

    constructor() {
        super()

        this._postFrame = this._postFrame.bind(this)
        this.refreshUiConfig = this.refreshUiConfig.bind(this)
        this.addEventListener('deserialize', async() => {
            // await timeout(200) // not needed actually
            this.refreshUi()
        })
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        // todo subscribe to plugin add event if picking is not added yet.
        this._picking = viewer.getPlugin<PickingPlugin>('Picking')
        this._picking?.addEventListener('selectedObjectChanged', this.refreshUiConfig) // don't call this.refreshUi here
        viewer.addEventListener('postFrame', this._postFrame)
    }
    onRemove(viewer: ThreeViewer) {
        this._picking = viewer.getPlugin<PickingPlugin>('Picking')
        this._picking?.removeEventListener('selectedObjectChanged', this.refreshUiConfig)
        viewer.removeEventListener('postFrame', this._postFrame)
        super.onRemove(viewer)
    }

    protected _postFrame() {
        if (this._uiNeedRefresh) this._refreshUi() // only call this from here.
    }

    /**
     * Whether refreshScene should be called when a node is selected. Refreshing scene will notify the plugins about the update, like shadows can be baked.
     * Disable this when nothing significant geometry/node changes happen when switch nodes are changed.
     */
    @serialize() refreshScene = true

    /**
     * Select a switch node variation with name or uuid.
     * @param node
     * @param nameOrUuid
     * @param setDirty - set dirty in the viewer after update.
     */
    selectNode(node: ObjectSwitchNode, nameOrUuid: string|number, setDirty = true) {
        const obj = this._viewer?.scene.getObjectByName(node.name)
        if (!obj || obj.children.length < 1) return
        const child = typeof nameOrUuid === 'number' ?
            obj.children[nameOrUuid] :
            obj.children.find(c => c.name === nameOrUuid || c.uuid === nameOrUuid)
        if (!child) {
            this._viewer?.console.warn('SwitchNodePlugin: child not found', nameOrUuid)
            return false
        }
        node.selected = child.name || child.uuid
        let changed = false
        for (const child1 of obj.children) {
            const visible = child1.visible
            child1.visible = (child1.name || child1.uuid) === node.selected
            changed = changed || visible !== child1.visible
        }
        if (changed && setDirty) this._viewer!.scene.setDirty({refreshScene: this.refreshScene, frameFade: true})
        return changed
    }


    /**
     * Apply all variations(by selected index or first item) when a config is loaded
     */
    applyOnLoad = true

    /**
     * Reapply all selected variations again.
     * Useful when the scene is loaded or changed and the variations are not applied.
     */
    reapplyAll() {
        this.variations.forEach(v => this.selectNode(v, v.selected || 0, false))
        this._viewer!.scene.setDirty({refreshScene: true, frameFade: true})
    }

    fromJSON(data: any, meta?: any): this | Promise<this | null> | null {
        this.variations = []
        if (!super.fromJSON(data, meta)) return null // its not a promise
        if (data.applyOnLoad === undefined) { // old files
            this.applyOnLoad = true // setting true because all the items will be visible otherwise.
        }
        if (this.applyOnLoad) this.reapplyAll()
        return this
    }

    refreshUi() {
        if (!this.enabled) return
        this._uiNeedRefresh = true
    }

    protected _refreshUi(): boolean {
        if (!this.enabled) return false
        if (!this._viewer) return false
        this._uiNeedRefresh = false
        if (this.autoSnapIcons) this.snapIcons()

        this.refreshUiConfig()
        return true
    }

    refreshUiConfig() {
        if (!this.enabled) return
        this.uiConfig.uiRefresh?.()
    }

    @serialize() variations: ObjectSwitchNode[] = []

    protected _selectedSwitchNode = (): Object3D | undefined => {
        const obj = this._picking?.getSelectedObject<IObject3D>() // (?.material || undefined) as IMaterial | undefined
        if (!obj?.isObject3D) return undefined
        const nodes = this.variations.map(v => v.name)
        let found: Object3D | undefined = undefined
        obj.traverseAncestors(a => {
            if (found) return
            if (!a.name) return
            if (nodes.includes(a.name)) found = a
        })
        return found
    }

    /**
     * Get the preview for a switch node variation
     * Should be called from preFrame ideally. (or preRender but set viewerSetDirty = false)
     * @param child - Child Object to get the preview for
     * @param variation - Switch node variation that contains the child.
     * @param viewerSetDirty - call viewer.setDirty() after setting the preview. So that the preview is cleared from the canvas.
     */
    getPreview(variation: ObjectSwitchNode, child: Object3D, viewerSetDirty = true): string {
        if (!this._viewer || !variation) return ''
        // const m = typeof material === 'number' ? variation.materials[material] : material
        const cv = variation.camView
        const camOffset = new Vector3(
            (cv.includes('right') ? 1 : 0) - (cv.includes('left') ? 1 : 0),
            (cv.includes('top') ? 1 : 0) - (cv.includes('bottom') ? 1 : 0),
            (cv.includes('front') ? 1 : 0) - (cv.includes('back') ? 1 : 0)
        )
        if (!variation.camDistance) variation.camDistance = 1
        const image = snapObject(this._viewer!.renderManager.renderer, child, this._viewer?.scene, 7, camOffset.multiplyScalar(variation.camDistance * 2))
        if (viewerSetDirty) this._viewer.setDirty() // because called from preFrame
        return image
    }

    addNode(node: ObjectSwitchNode, refreshUi = true) {
        this.variations.push(node)
        if (refreshUi) this.refreshUi()
    }

    /**
     * If true, the plugin will automatically take snapshots of the icons in _refreshUi and put them in the object.userdata.__icon
     * Otherwise, call {@link snapIcons} manually
     */
    autoSnapIcons = false

    /**
     * Snapshots icons and puts in the userdata.__icon
     */
    snapIcons() {
        for (const variation of this.variations) {
            const obj = this._viewer!.scene.getObjectByName(variation.name)
            if (!obj) {
                console.warn('no object found for variation, skipping', variation)
                continue
            }
            if (obj.children.length < 1) {
                console.warn('SwitchNode does not have enough children', variation)
            }

            for (const child of obj.children) {
                if (child.userData.__icon) return
                const image = this.getPreview(variation, child, false)
                if (image) child.userData.__icon = image
            }
        }
    }

    uiConfig: UiObjectConfig = {
        label: 'Switch Node Plugin',
        type: 'folder',
        // expanded: true,
        children: [
            {
                type: 'checkbox',
                label: 'Enabled',
                property: [this, 'enabled'],
            },
            () => [
                {
                    type: 'folder',
                    label: 'All nodes',
                    expanded: true,
                    children: [
                        this.variations.map(v => ({
                            type: 'input',
                            label: v.title,
                            property: [v, 'name'],
                            onChange: () => this.refreshUi(),
                        })),
                    ],
                },
                {
                    type: 'button',
                    label: 'Add Node',
                    value: () => {
                        this.addNode({
                            name: 'switch_node',
                            selected: '',
                            title: 'Switch Node',
                            camView: 'front',
                            camDistance: 1,
                        })
                    },
                },
                {
                    type: 'button',
                    label: 'Refresh UI',
                    value: () => this.refreshUi(),
                },
                {
                    type: 'input',
                    label: 'Selected node title',
                    hidden: () => !this._selectedSwitchNode(),
                    property: () => {
                        const node = this._selectedSwitchNode()
                        if (!node) return []
                        return [this.variations.find(v => v.name === node.name), 'title']
                    },
                    onChange: () => this.refreshUi(),
                },
                {
                    type: 'slider',
                    bounds: [0.01, 2],
                    stepSize: 0.01,
                    label: 'Cam Distance',
                    hidden: () => !this._selectedSwitchNode(),
                    property: () => {
                        const node = this._selectedSwitchNode()
                        if (!node) return []
                        return [this.variations.find(v => v.name === node.name), 'camDistance']
                    },
                    // onChange: ()=> this.refreshUi(),
                },
                {
                    type: 'dropdown',
                    label: 'Cam View',
                    hidden: () => !this._selectedSwitchNode(),
                    property: () => {
                        const node = this._selectedSwitchNode()
                        if (!node) return []
                        return [this.variations.find(v => v.name === node.name), 'camView']
                    },
                    onChange: () => this.refreshUi(),
                    children: ['top', 'bottom', 'front', 'back', 'left', 'right'].map(k => ({
                        label: k,
                        value: k,
                    })),
                },

            ],
        ],
    }

}

export interface ObjectSwitchNode{
    name: string,
    title: string,
    selected: string,
    camView: 'top'|'bottom'|'front'|'back'|'left'|'right'|string,
    camDistance: number,
}
