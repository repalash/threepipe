/**
 * `ProceduralPlugin` - geometry nodes in a threepipe viewer: registers the `geometryNodes` modifier type
 * and the `nodeGroup` command on `ModellingPlugin` when (and while) it is present, and draws what a
 * geometry-nodes stack makes besides the mesh (instances, points) with a {@link GeometrySetRenderer} per object.
 */

import {AViewerPluginSync, ThreeViewer} from 'threepipe'
import {registerModifierType, unregisterModifierType} from '@threepipe/plugin-modelling'
import type {ModellingDocument, ModellingEntry, ModellingPlugin} from '@threepipe/plugin-modelling'
import {GeometrySet} from '@threepipe/plugin-procedural'
import {documentScene, geometryNodesModifierType} from './geometryNodesModifier'
import {nodeGroupCommand} from './nodeGroupCommand'
import {blendAssetCommand, linkedMaterials} from './blendAsset'
import {GeometrySetRenderer, RenderStats} from './GeometrySetRenderer'

interface Display {
    renderer: GeometrySetRenderer
    geometry: GeometrySet
    entry: ModellingEntry
}

export class ProceduralPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'ProceduralPlugin'
    enabled = true
    dependencies = []
    toJSON: any = undefined

    /** Instance drawings by entry: outside the model root, so they are not picked, listed or exported as objects. */
    private readonly _displays = new Map<ModellingEntry, Display>()
    private _document?: ModellingDocument

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        registerModifierType(geometryNodesModifierType, true)
        viewer.forPlugin<ModellingPlugin>('ModellingPlugin', modelling => {
            if (!modelling.commands.get(nodeGroupCommand.op)) modelling.addCommand(nodeGroupCommand)
            if (!modelling.commands.get(blendAssetCommand.op)) modelling.addCommand(blendAssetCommand)
            modelling.addEventListener('documentChanged', this._documentChanged)
            this._sync(modelling.document)
        }, modelling => {
            modelling.commands.unregister(nodeGroupCommand.op)
            modelling.commands.unregister(blendAssetCommand.op)
            modelling.removeEventListener('documentChanged', this._documentChanged)
            this._clear()
        }, this)
        viewer.addEventListener('preFrame', this._followObjects)
    }

    onRemove(viewer: ThreeViewer): void {
        unregisterModifierType(geometryNodesModifierType.type)
        const modelling = viewer.getPlugin<ModellingPlugin>('ModellingPlugin')
        modelling?.commands.unregister(nodeGroupCommand.op)
        modelling?.commands.unregister(blendAssetCommand.op)
        modelling?.removeEventListener('documentChanged', this._documentChanged)
        viewer.removeEventListener('preFrame', this._followObjects)
        this._clear()
        super.onRemove(viewer)
    }

    /** What is drawn for an object besides its mesh (instances, points), or undefined when nothing is. */
    drawn(objectName: string): RenderStats | undefined {
        for (const d of this._displays.values()) if (d.entry.name === objectName) return {...d.renderer.stats}
        return undefined
    }

    private _documentChanged = (e: {document: ModellingDocument}) => this._sync(e.document)

    /** Draw each object's extra geometry (`evaluatedGeometry`), redrawing only the objects whose result changed. */
    private _sync(doc: ModellingDocument): void {
        if (!this._viewer) return
        if (this._document !== doc) this._clear()
        this._document = doc
        const live = new Set<ModellingEntry>()
        for (const entry of doc.entries) {
            const geometry = entry.evaluatedGeometry
            if (!(geometry instanceof GeometrySet)) continue
            live.add(entry)
            let d = this._displays.get(entry)
            if (!d) {
                const renderer = new GeometrySetRenderer({scene: documentScene(doc), materials: linkedMaterials})
                renderer.root.matrixAutoUpdate = false
                renderer.root.userData.__procedural = entry.name
                this._viewer.scene.addObject(renderer.root, {addToRoot: true})
                d = {renderer, geometry, entry}
                this._displays.set(entry, d)
                renderer.update(geometry)
            } else if (d.geometry !== geometry) {
                d.geometry = geometry
                d.renderer.update(geometry)
            }
        }
        for (const [entry, d] of this._displays) {
            if (live.has(entry)) continue
            d.renderer.root.removeFromParent()
            d.renderer.dispose()
            this._displays.delete(entry)
        }
        this._followObjects()
        this._viewer.setDirty()
    }

    /** Keep each drawing at its object's world transform (objects move without document changes while dragged). */
    private _followObjects = () => {
        for (const d of this._displays.values()) {
            const object = d.entry.object
            object.updateMatrixWorld?.()
            d.renderer.root.visible = object.visible
            if (!d.renderer.root.matrix.equals(object.matrixWorld)) {
                d.renderer.root.matrix.copy(object.matrixWorld)
                d.renderer.root.matrixWorldNeedsUpdate = true
            }
        }
    }

    private _clear(): void {
        for (const d of this._displays.values()) {
            d.renderer.root.removeFromParent()
            d.renderer.dispose()
        }
        this._displays.clear()
    }
}
