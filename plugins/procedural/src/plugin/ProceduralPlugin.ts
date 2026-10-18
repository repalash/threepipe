/**
 * `ProceduralPlugin` - geometry nodes in a threepipe viewer: registers the `geometryNodes` modifier type
 * and the `nodeGroup` command on `ModellingPlugin` when (and while) it is present.
 */

import {AViewerPluginSync, ThreeViewer} from 'threepipe'
import {registerModifierType, unregisterModifierType} from '@threepipe/plugin-modelling'
import type {ModellingPlugin} from '@threepipe/plugin-modelling'
import {geometryNodesModifierType} from './geometryNodesModifier'
import {nodeGroupCommand} from './nodeGroupCommand'

export class ProceduralPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'ProceduralPlugin'
    enabled = true
    dependencies = []
    toJSON: any = undefined

    onAdded(viewer: ThreeViewer): void {
        super.onAdded(viewer)
        registerModifierType(geometryNodesModifierType, true)
        viewer.forPlugin<ModellingPlugin>('ModellingPlugin', modelling => {
            if (!modelling.commands.get(nodeGroupCommand.op)) modelling.addCommand(nodeGroupCommand)
        }, modelling => {
            modelling.commands.unregister(nodeGroupCommand.op)
        }, this)
    }

    onRemove(viewer: ThreeViewer): void {
        unregisterModifierType(geometryNodesModifierType.type)
        viewer.getPlugin<ModellingPlugin>('ModellingPlugin')?.commands.unregister(nodeGroupCommand.op)
        super.onRemove(viewer)
    }
}
