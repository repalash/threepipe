import {CustomContextMenu, MaterialConfiguratorBasePlugin, MaterialVariations} from 'threepipe'
import {GridItemListPlugin} from './GridItemListPlugin'

/**
 * Material Configurator Plugin (Basic UI)
 * This plugin allows you to create variations of materials mapped to material names or uuids in the scene.
 * These variations can be applied to the materials in the scene. (This copies the properties to the same material instances instead of assigning new materials)
 * The plugin interfaces with the picking plugin and also provides uiConfig to show and edit the variations.
 * This functionality is inherited from `MaterialConfiguratorBasePlugin`
 *
 * Additionally, this plugin adds a Grid UI using {@link GridItemListPlugin} in the DOM over the viewer canvas to show various material variations and allow the user to apply them.
 * The UI can also be used in the editor to edit the variations and apply them.
 */
export class MaterialConfiguratorPlugin extends MaterialConfiguratorBasePlugin {
    public static PluginType = 'MaterialConfiguratorPlugin'

    enableEditContextMenus = false

    dependencies = [GridItemListPlugin]

    /**
     * Animate the material change when applying a variation.
     */
    animateApply = true
    /**
     * Duration of the animation when applying a variation in ms
     */
    animateApplyDuration = 500

    // must be called from preFrame
    protected async _refreshUi(): Promise<boolean> {
        if (!await super._refreshUi()) return false

        const grid = this._viewer?.getPlugin(GridItemListPlugin)
        if (!grid) return false

        grid.removeAll(MaterialConfiguratorPlugin.PluginType)

        for (const variation of this.variations) {
            const container = grid.create(MaterialConfiguratorPlugin.PluginType,
                variation.title + (this.enableEditContextMenus ? ' (' + variation.uuid + ')' : ''),
                5,
                20, 0,
                variation.materials.map(m => {
                    const image = this.getPreview(m, variation.preview)
                    return {
                        id: m.uuid,
                        image, // : (m as any).map?.image ? imageBitmapToBase64((m as any).map.image, 100) : makeColorSvg((m as any).color ?? '#ffffff'),
                        onClick: async(id:string) => this.animateApply ? this.applyVariationAnimate(variation, id, this.animateApplyDuration) : this.applyVariation(variation, id),
                        tooltip: m.name || m.uuid,
                    }
                }), (d, item)=> {
                    // todo test in shadow dom.
                    d.oncontextmenu = (e) => {
                        if (!this.enableEditContextMenus) return
                        e.preventDefault()
                        e.stopPropagation()
                        const menu = CustomContextMenu.Create(this.materialContextMenuItems(variation, item.id), e.clientX, e.clientY)
                        document.body.appendChild(menu)
                    }
                })
            container.oncontextmenu = (e) => {
                if (!this.enableEditContextMenus) return
                e.preventDefault()
                e.stopPropagation()
                const menu = CustomContextMenu.Create(this.variationsContextMenuItems(variation), e.clientX, e.clientY)
                document.body.appendChild(menu)
            }
        }

        grid.rebuildUi()

        return true
    }

    materialContextMenuItems = (variation: MaterialVariations, uuid: string)=>({
        ['Remove']: async()=>{
            const conf = await this._viewer?.dialog.confirm('Remove material: Remove material from this variation list?')
            if (!conf) return
            variation.materials = variation.materials.filter(m => m.uuid !== uuid)
            this.refreshUi()
            CustomContextMenu.Remove()
        },
        // todo set icon url
    })
    variationsContextMenuItems = (variation: MaterialVariations)=>({
        ['Rename mapping']: async() => {
            const name = await this._viewer?.dialog.prompt('Change name: New material name to map to', variation.uuid, true)
            if (name) {
                variation.uuid = name
                this.refreshUi()
            }
        },
        ['Rename title']: async() => {
            const name = await this._viewer?.dialog.prompt('Change name: New material name to map to', variation.title, true)
            if (name) {
                variation.title = name
                this.refreshUi()
            }
        },
        ['Clear Materials']: async()=>{
            const conf = await this._viewer?.dialog.confirm('Remove all: Remove all materials from this variation list?')
            if (!conf) return
            variation.materials = []
            this.refreshUi()
            CustomContextMenu.Remove()
        },
        ['Remove Section']: async()=>{
            const conf = await this._viewer?.dialog.confirm('Remove variations: Remove this category of variations?')
            if (!conf) return
            this.removeVariation(variation)
            CustomContextMenu.Remove()
        },
    })

}

