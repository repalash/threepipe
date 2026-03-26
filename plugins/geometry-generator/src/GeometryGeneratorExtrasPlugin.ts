import {
    AViewerPluginSync,
    GeometryGeneratorPlugin as _GeometryGeneratorPlugin,
    type Object3DGeneratorPlugin,
    ThreeViewer,
} from 'threepipe'
import {TextGeometryGenerator} from './primitives/TextGeometryGenerator'

/**
 * GeometryGeneratorExtrasPlugin
 *
 * Addon plugin that registers TextGeometryGenerator
 * with the core GeometryGeneratorPlugin.
 *
 * @category Plugins
 */
export class GeometryGeneratorExtrasPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'GeometryGeneratorExtrasPlugin'
    dependencies = [_GeometryGeneratorPlugin]
    enabled = true
    toJSON: any = undefined

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        const gen = viewer.getPlugin(_GeometryGeneratorPlugin)
        if (gen) {
            gen.generators.text = new TextGeometryGenerator('text')
        }
        viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', (plugin) => {
            plugin.addObject3DGenerator('geometry-text', (params: any) => {
                const obj = gen!.generateObject('text', params)
                obj.name = 'text'
                return obj
            })
        }, (plugin) => {
            plugin.removeObject3DGenerator('geometry-text')
        }, this)
    }

    onRemove(viewer: ThreeViewer) {
        const gen = viewer.getPlugin(_GeometryGeneratorPlugin)
        if (gen) {
            // @ts-expect-error ts issue
            delete gen.generators.text
        }
        super.onRemove(viewer)
    }
}

/**
 * @deprecated Basic generators and line generator have moved to core threepipe. Import GeometryGeneratorPlugin
 * from 'threepipe' for the core plugin. Use GeometryGeneratorExtrasPlugin from this package to add the text
 * generator. This class is a compatibility shim that works like GeometryGeneratorExtrasPlugin with a deprecation warning.
 */
export class GeometryGeneratorPlugin extends GeometryGeneratorExtrasPlugin {
    constructor() {
        super()
        console.warn(
            '[@threepipe/plugin-geometry-generator] GeometryGeneratorPlugin is deprecated.\n'
            + '  - All generators except text are now in core: import {GeometryGeneratorPlugin} from \'threepipe\'\n'
            + '  - For text generator, use: import {GeometryGeneratorExtrasPlugin} from \'@threepipe/plugin-geometry-generator\'\n'
            + '  This shim registers the text generator but will be removed in a future version.',
        )
    }
}
