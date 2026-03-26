import {CustomContextMenu, SwitchNodeBasePlugin, type ObjectSwitchNode} from 'threepipe'
import {GridItemListPlugin} from './GridItemListPlugin'

/**
 * Switch Node Plugin (Basic UI)
 * This plugin allows you to configure object variations in a file and apply them in the scene.
 * Each SwitchNode is a parent object with multiple direct children. Only one child is visible at a time.
 * This works by toggling the `visible` property of the children of a parent object.
 * The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
 * It also provides a function to create snapshot previews of individual variations. This creates a limited render of the object with the selected child visible.
 * To get a proper render, it's better to render it offline and set the image as a preview.
 * This functionality is inherited from `SwitchNodeBasePlugin`.
 *
 * Additionally, this plugin adds a Grid UI using {@link GridItemListPlugin} in the DOM over the viewer canvas to show various object variations and allow the user to select them.
 * The UI can also be used in the editor to edit the variations and apply them.
 */
export class SwitchNodePlugin extends SwitchNodeBasePlugin {
    public static readonly PluginType = 'SwitchNodePlugin'

    enableEditContextMenus = false

    dependencies = [GridItemListPlugin]

    protected _refreshUi(): boolean {
        if (!super._refreshUi()) return false

        const grid = this._viewer?.getPlugin(GridItemListPlugin)
        if (!grid) return false

        grid.removeAll(SwitchNodePlugin.PluginType)

        for (const variation of this.variations) {
            const obj = this._viewer!.scene.getObjectByName(variation.name)
            if (!obj) {
                console.warn('no object found for variation, skipping', variation)
                continue
            }
            if (obj.children.length < 1) {
                console.warn('SwitchNode does not have enough children', variation)
            }
            const container = grid.create(SwitchNodePlugin.PluginType,
                variation.title + (this.enableEditContextMenus ? ' (' + variation.name + ')' : ''),
                Math.min(5, obj.children.length),
                20, 0,
                obj.children.map(child => {
                    return {
                        id: child.uuid,
                        image: this.getPreview(variation, child),
                        onClick: () => {
                            this.selectNode(variation, child.name || child.uuid)
                        },
                        tooltip: child.name || child.uuid,
                    }
                }), (d, item)=> {
                    d.oncontextmenu = (e) => {
                        if (!this.enableEditContextMenus) return
                        e.preventDefault()
                        e.stopPropagation()
                        const menu = CustomContextMenu.Create(this.nodeItemContextMenuItems(variation, item.id), e.clientX, e.clientY)
                        document.body.appendChild(menu)
                    }
                }
            )
            container.oncontextmenu = (e) => {
                if (!this.enableEditContextMenus) return
                e.preventDefault()
                e.stopPropagation()
                const menu = CustomContextMenu.Create(this.nodeContextMenuItems(variation), e.clientX, e.clientY)
                document.body.appendChild(menu)
            }
        }
        grid.rebuildUi()

        return true
    }

    nodeItemContextMenuItems = (variation: ObjectSwitchNode, uuid: string) => ({
        ['Select']: () => {
            this.selectNode(variation, uuid)
            this.refreshUi()
            CustomContextMenu.Remove()
        },
    })

    nodeContextMenuItems = (variation: ObjectSwitchNode) => ({
        ['Rename Title']: async() => {
            CustomContextMenu.Remove()
            const name = await this._viewer?.dialog.prompt('Change title: New display title for this switch node', variation.title, true)
            if (name) {
                variation.title = name
                this.refreshUi()
            }
        },
        ['Rename Node']: async() => {
            CustomContextMenu.Remove()
            const name = await this._viewer?.dialog.prompt('Change node name: New object name to map to', variation.name, true)
            if (name) {
                variation.name = name
                this.refreshUi()
            }
        },
        ['Remove Section']: async() => {
            CustomContextMenu.Remove()
            const conf = await this._viewer?.dialog.confirm('Remove switch node: Remove this switch node configuration?')
            if (!conf) return
            this.variations = this.variations.filter(v => v !== variation)
            this.refreshUi()
        },
    })
}
