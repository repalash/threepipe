import {onChange} from 'ts-browser-helpers'
import {Importer, Rhino3dmLoader2} from '../../assetmanager'
import {BaseImporterPlugin} from '../base/BaseImporterPlugin'
import {IUiConfigContainer, uiFolderContainer, UiObjectConfig, uiToggle} from 'uiconfig.js'

/**
 * Adds support for loading Rhino `.3dm`, `model/vnd.3dm`, `model/3dm` files and data uris.
 * @category Plugins
 */
@uiFolderContainer('Rhino 3dm Loader')
export class Rhino3dmLoadPlugin extends BaseImporterPlugin implements IUiConfigContainer {
    public static readonly PluginType = 'Rhino3dmLoadPlugin'
    protected _importer = new Importer(Rhino3dmLoader2, ['3dm'], ['model/vnd.3dm', 'model/3dm'], true)
    uiConfig!: UiObjectConfig

    /**
     * Import materials from the file based on material source and color source. If false, a default material will be used
     * Same as {@link Rhino3dmLoader2.ImportMaterials}
     */
    @onChange(Rhino3dmLoadPlugin.prototype._refresh) @uiToggle()
        importMaterials = Rhino3dmLoader2.ImportMaterials
    /**
     * Force layer materials even if material/color source is not from layer. Only works if {@link importMaterials} is true
     * Same as {@link Rhino3dmLoader2.ForceLayerMaterials}
     */
    @onChange(Rhino3dmLoadPlugin.prototype._refresh) @uiToggle()
        forceLayerMaterials = Rhino3dmLoader2.ForceLayerMaterials
    /**
     * Replace meshes with instanced meshes if they have the same parent, geometry and material
     * Same as {@link Rhino3dmLoader2.ReplaceWithInstancedMesh}
     */
    @onChange(Rhino3dmLoadPlugin.prototype._refresh) @uiToggle()
        replaceWithInstancedMesh = Rhino3dmLoader2.ReplaceWithInstancedMesh
    /**
     * Hide all lines, line segments and points in the file
     * Same as {@link Rhino3dmLoader2.HideLineMesh}
     */
    @onChange(Rhino3dmLoadPlugin.prototype._refresh) @uiToggle()
        hideLineMesh = Rhino3dmLoader2.HideLineMesh

    protected _refresh() {
        Rhino3dmLoader2.ImportMaterials = this.importMaterials
        Rhino3dmLoader2.ForceLayerMaterials = this.forceLayerMaterials
        Rhino3dmLoader2.ReplaceWithInstancedMesh = this.replaceWithInstancedMesh
        Rhino3dmLoader2.HideLineMesh = this.hideLineMesh
    }

}
