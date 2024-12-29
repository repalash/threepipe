import {SwitchNodeBasePlugin} from 'threepipe'
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
                }), (d, _item)=> {
                    // todo test in shadow dom.
                    d.oncontextmenu = (e) => {
                        if (!this.enableEditContextMenus) return
                        e.preventDefault()
                        e.stopPropagation()
                        // todo
                        // const menu = CustomContextMenu.Create(this.materialContextMenuItems(variation, item.id), e.clientX, e.clientY)
                        // document.body.appendChild(menu)
                    }
                }
            )
            container.oncontextmenu = (e) => {
                if (!this.enableEditContextMenus) return
                e.preventDefault()
                e.stopPropagation()
                // todo
                // const menu = CustomContextMenu.Create(this.variationsContextMenuItems(variation), e.clientX, e.clientY)
                // document.body.appendChild(menu)
            }
        }
        grid.rebuildUi()

        return true
    }
}
