import {AViewerPluginSync, GeometryGeneratorPlugin, type Object3DGeneratorPlugin, ThreeViewer} from 'threepipe'
import {TextGeometryGenerator} from './primitives/TextGeometryGenerator'
import {LineGeometryGenerator} from './primitives/LineGeometryGenerator'

/**
 * GeometryGeneratorExtrasPlugin
 *
 * Addon plugin that registers TextGeometryGenerator and LineGeometryGenerator
 * with the core GeometryGeneratorPlugin.
 *
 * @category Plugins
 */
export class GeometryGeneratorExtrasPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'GeometryGeneratorExtrasPlugin'
    dependencies = [GeometryGeneratorPlugin]
    enabled = true
    toJSON: any = undefined

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        const gen = viewer.getPluginByType<GeometryGeneratorPlugin>('GeometryGeneratorPlugin')
        if (gen) {
            gen.generators.text = new TextGeometryGenerator('text')
            gen.generators.line = new LineGeometryGenerator('line')
        }
        // Register with Object3DGeneratorPlugin using a different prefix ('geometry-extra-')
        // because addObject3DGenerators first removes all keys with the given prefix,
        // so using 'geometry-' would delete the core's 6 basic generators
        viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', (plugin) => {
            plugin.addObject3DGenerators('geometry-extra-', {
                text: (params: any) => { const obj = gen!.generateObject('text', params); obj.name = 'text'; return obj },
                line: (params: any) => { const obj = gen!.generateObject('line', params); obj.name = 'line'; return obj },
            })
        }, (plugin) => {
            plugin.removeObject3DGenerators('geometry-extra-')
        }, this)
    }

    onRemove(viewer: ThreeViewer) {
        const gen = viewer.getPluginByType<GeometryGeneratorPlugin>('GeometryGeneratorPlugin')
        if (gen) {
            delete gen.generators.text
            delete gen.generators.line
        }
        super.onRemove(viewer)
    }
}
