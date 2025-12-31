import {AViewerPluginSync, ThreeViewer} from '../../viewer'
import {uiFolderContainer} from 'uiconfig.js'

/**
 * TailwindCSSCDNPlugin
 *
 * A plugin that dynamically loads Tailwind CSS from a CDN to enable rapid UI development with utility classes.
 * This allows you to use Tailwind CSS classes in your HTML elements without needing a build step.
 *
 * The plugin automatically injects the Tailwind CSS script tag when added to the viewer and removes it when the plugin is removed.
 *
 * @category Plugins
 * @example
 * ```typescript
 * import {ThreeViewer, TailwindCSSCDNPlugin} from 'threepipe'
 *
 * const viewer = new ThreeViewer({canvas: document.getElementById('canvas')})
 * const tailwindPlugin = viewer.addPluginSync(new TailwindCSSCDNPlugin())
 *
 * // Now you can use Tailwind CSS classes in your HTML elements
 * const button = document.createElement('button')
 * button.className = 'absolute top-4 right-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded'
 * button.textContent = 'Click me'
 * viewer.container.appendChild(button)
 * ```
 */
@uiFolderContainer('Tailwind CSS')
export class TailwindCSSCDNPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'TailwindCDNPlugin'
    enabled = true
    private _tailwindScript: HTMLScriptElement | null = null

    /**
     * The CDN URL for Tailwind CSS
     * @default 'https://cdn.tailwindcss.com'
     */
    static CDN_URL = 'https://cdn.tailwindcss.com'
    toJSON: any = null // do not save plugin state

    async onAdded(viewer: ThreeViewer): Promise<void> {
        super.onAdded(viewer)

        // Add Tailwind CSS CDN script to head
        this._tailwindScript = document.createElement('script')
        this._tailwindScript.src = TailwindCSSCDNPlugin.CDN_URL
        this._tailwindScript.type = 'text/javascript'
        document.head.appendChild(this._tailwindScript)
    }

    onRemove(viewer: ThreeViewer): void {
        // Remove Tailwind CSS script from head
        if (this._tailwindScript && this._tailwindScript.parentNode) {
            this._tailwindScript.parentNode.removeChild(this._tailwindScript)
            this._tailwindScript = null
        }
        super.onRemove(viewer)
    }
}
