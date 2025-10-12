import {UiObjectConfig} from 'uiconfig.js'
import {AViewerPlugin, AViewerPluginSync, ThreeViewer} from '../../viewer'
import {Class} from 'ts-browser-helpers'

/**
 * A plugin that allows dynamic loading and unloading of other plugins at runtime, with support for hot module replacement (HMR) during development.
 * This plugin provides a simple UI to load and unload plugins by specifying their module paths.
 * It supports both direct path strings and module objects (imported or promises).
 * The loaded plugins are tracked and can be managed through the provided UI.
 *
 * For HMR with vite, see {@link sampleThreepipeViteHmrPlugin}
 * Note: This plugin is primarily intended for development and testing purposes.
 */
export class DynamicImportPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'DynamicImportPlugin'
    enabled = true

    constructor() {
        super()
        // for vite, see sampleThreepipeViteHmrPlugin
        if ((import.meta as any).hot) {
            (import.meta as any).hot.on('custom-tp-plugin-update', async(data: any) => {
                const base = (import.meta as any).hot.ownerPath.split('/').slice(0, -1).join('/') + '/'
                const path = this.plugins.has(data.id) ? data.id : data.url.replace(base, './')
                // console.log(base, import.meta.hot, path)
                if (this.plugins.has(path)) {
                    await this.unloadPlugin(path)
                    await this.loadPlugin(path)
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                }
                // const path = data.path.split('')
            })
        }
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
    }

    plugins = new Map<string, Class<AViewerPlugin>>

    /**
     * Loads and adds a plugin to the viewer.
     * The plugin can be specified as a path string or as a module object (imported or promise).
     * If a path string is provided, it should point to a module that exports a default class extending AViewerPlugin.
     * If a module object is provided, it should either have a default export or a named export that is a class extending AViewerPlugin.
     * The module can also have a __tpPluginPath property to identify its path.
     *
     * Usage examples:
     * ```ts
     * // Load plugin from a path
     * await DynamicImportPlugin.loadPlugin('./path/to/MyPlugin.js');
     *
     * // Load plugin from an imported module
     * import MyPluginModule from './path/to/MyPlugin.js';
     * await DynamicImportPlugin.loadPlugin(MyPluginModule);
     *
     * // Load plugin with dynamic import
     * await DynamicImportPlugin.loadPlugin(import('./path/to/MyPlugin.js'));
     * ```
     *
     * @returns The instance of the loaded plugin.
     * @param pathOrModule
     */
    async loadPlugin(pathOrModule: string | PluginModule | Promise<PluginModule>) {
        const viewer = this._viewer
        if (!viewer) throw new Error('Plugin not added to viewer.')
        if (typeof pathOrModule === 'object' && typeof pathOrModule.then === 'function') {
            pathOrModule = await pathOrModule
        }
        pathOrModule = pathOrModule as string | PluginModule
        const path: string = typeof pathOrModule === 'string' ? pathOrModule : pathOrModule.__tpPluginPath || ''
        if (path?.length && this.plugins.has(path)) throw new Error('Plugin already loaded: ' + path)
        const mod = typeof pathOrModule === 'object' ? pathOrModule : typeof path === 'string' && path ? await import(
            /* webpackIgnore: true */
            /* @vite-ignore */
            path + '?t=' + Date.now() // prevent caching during development
        ) : null
        if (!mod) throw new Error('Could not find/load module: ' + path)
        const plugin = mod.default || Object.values(mod)[0] as Class<AViewerPlugin>
        if (!plugin)
            throw new Error('No plugin found in module: ' + path)
        if (typeof plugin !== 'function')
            throw new Error('Plugin is not a class or function in module: ' + pathOrModule)
        if (!(plugin.prototype && plugin.prototype instanceof AViewerPlugin))
            throw new Error('Plugin is not a subclass of AViewerPlugin in module: ' + pathOrModule)
        const pluginType = plugin.PluginType
        console.log(pluginType)
        console.log(mod)
        if (viewer.getPlugin(pluginType))
            throw new Error('Plugin of type ' + pluginType + ' already added to viewer')
        if (path?.length) this.plugins.set(path, plugin)
        const p = await viewer.addPlugin(plugin)
        return p
    }

    /**
     * Unloads and removes a plugin from the viewer by its path.
     * The path should match the one used when loading the plugin.
     *
     * @returns A promise that resolves when the plugin is removed.
     * @param path
     */
    async unloadPlugin(path: string) {
        const viewer = this._viewer
        if (!viewer) throw new Error('Plugin not added to viewer.')
        const pluginC = this.plugins.get(path)
        if (!pluginC)
            throw new Error('Plugin not loaded: ' + path)
        const plugin = viewer.getPlugin(pluginC)
        if (!plugin)
            throw new Error('Plugin not found in viewer: ' + path)
        await viewer.removePlugin(plugin)
        this.plugins.delete(path)
    }

    private _path = './TestPlugin.ts'
    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Viewer Scripts',
        expanded: true,
        children: [
            {
                type: 'input',
                label: 'Path',
                property: [this, '_path'],
            },
            {
                type: 'button',
                label: 'Load Plugin',
                value: async() => {
                    await this.loadPlugin(this._path)
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Unload Plugin',
                value: async() => {
                    await this.unloadPlugin(this._path)
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'button',
                label: 'Refresh UI',
                value: async() => {
                    this.uiConfig.uiRefresh?.(true, 'postFrame')
                },
            },
            {
                type: 'folder',
                label: 'Loaded Plugins',
                expanded: true,
                children: [
                    () => {
                        return [...this.plugins.values()].map(v => {
                            const p = this._viewer?.getPlugin(v)
                            return p?.uiConfig
                        })
                    },
                ],
            },
        ],
    }
}

export interface PluginModule{
    __tpPluginPath: string
    default?: Class<AViewerPlugin>
    [key: string]: Class<AViewerPlugin> | any
}

// import type {HotUpdateOptions, ModuleNode} from 'vite'
export const sampleThreepipeViteHmrPlugin = {
    handleHotUpdate({server, modules, timestamp}: /* HotUpdateOptions */ any) {
        // Invalidate modules manually
        const invalidatedModules = new Set< /* ModuleNode */ any>()
        const res = []
        for (const mod of modules) {
            console.log(mod.id, mod.url)
            if (!mod.url.endsWith('.plugin.ts')) res.push(mod)
            else {
                server.moduleGraph.invalidateModule(
                    mod as any,
                    invalidatedModules,
                    timestamp,
                    true,
                )
                server.ws.send({
                    type: 'custom',
                    event: 'custom-tp-plugin-update',
                    data: {
                        url: mod.url,
                        id: mod.id,
                    },
                })
            }
        }
        return res
    },
    transform(code: string, id: string) {
        if (id.endsWith('.plugin.ts')) {
            const pathExport = `\nexport const __tpPluginPath = "${id}";\n`
            return code + pathExport
        }
    },
}
