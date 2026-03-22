/**
 * ProceduralGeneratorPlugin
 *
 * Manages procedural generators: registry, UI, lifecycle, serialization.
 * Follows the same pattern as GeometryGeneratorPlugin.
 *
 * Regeneration uses a dirty-flag + frame-loop pattern (same as threepipe's RenderManager):
 * - On param change: mark the object as needing regeneration
 * - On postFrame: process all dirty objects once per frame
 * This coalesces rapid changes (e.g., slider dragging) naturally — no debounce/throttle hacks.
 */

import {
    AViewerPluginSync,
    type IObject3D,
    type Object3DGeneratorPlugin,
    ThreeViewer,
    type UiObjectConfig,
} from 'threepipe'
import {AProceduralGenerator} from './AProceduralGenerator'
import {SeededRandom} from './utils/SeededRandom'

function injectUiFolder(target: IObject3D, childrenUi: () => UiObjectConfig[], onChange?: () => void) {
    const uiConfig = (target as any).uiConfig as UiObjectConfig
    if (!uiConfig) return
    let folder = uiConfig.children?.find((c) => typeof c === 'object' && (c as UiObjectConfig).tags?.includes('proceduralGeneration')) as UiObjectConfig | undefined
    if (!folder) {
        folder = {
            type: 'folder',
            label: 'Generation Params',
            expanded: true,
            tags: ['proceduralGeneration'],
            children: [],
        }
        if (uiConfig.children) {
            uiConfig.children.unshift(folder)
        } else {
            uiConfig.children = [folder]
        }
    }
    folder.children = childrenUi()
    if (onChange) folder.onChange = onChange
    folder.uiRefresh?.(true, 'postFrame')
}

function removeUiFolder(object: IObject3D) {
    const uiConfig = (object as any).uiConfig as UiObjectConfig
    if (!uiConfig) return
    const index = uiConfig.children?.findIndex((c) => typeof c === 'object' && (c as UiObjectConfig).tags?.includes('proceduralGeneration')) ?? -1
    if (index >= 0) {
        uiConfig.children?.splice(index, 1)
        uiConfig.uiRefresh?.(true, 'postFrame')
    }
}

export class ProceduralGeneratorPlugin extends AViewerPluginSync {
    public static readonly PluginType = 'ProceduralGeneratorPlugin'
    enabled = true
    toJSON: any = undefined

    generators: Record<string, AProceduralGenerator> = {}

    /**
     * Set of objects that need regeneration. Processed once per frame in _postFrame.
     * Using a Set ensures each object is regenerated at most once per frame,
     * even if multiple params change in the same frame (e.g., slider dragging).
     */
    private _dirtyObjects: Set<IObject3D> = new Set()

    /**
     * Generate a procedural object of the given type.
     * If addToScene is true, adds the object to the scene and sets up UI.
     * Returns the generated root object.
     */
    generateObject(type: string, params?: any, seed?: number, addToScene = false): IObject3D {
        const generator = this.generators[type]
        if (!generator) throw new Error('Unknown procedural generator type: ' + type)

        const mergedParams = {
            ...generator.defaultParams,
            ...params,
            type,
        }
        if (seed !== undefined) mergedParams.seed = seed
        const rng = new SeededRandom(mergedParams.seed ?? 42)

        const output = generator.generate(mergedParams, rng)
        output.name = output.name || type
        output.userData.generationParams = {...mergedParams}

        if (addToScene && this._viewer) {
            this._viewer.scene.addObject(output)
            this._setupObjectUi(output)
        }

        return output
    }

    /**
     * Add a previously generated procedural object to the scene and set up its UI.
     */
    addToScene(object: IObject3D): void {
        if (!this._viewer) throw new Error('Plugin not added to viewer')
        this._viewer.scene.addObject(object)
        this._setupObjectUi(object)
    }

    /**
     * Create a UiObjectConfig for a generated object's params.
     * Add this to TweakpaneUiPlugin via ui.appendChild() to show generation params in the panel.
     * Changes to params are coalesced and applied once per frame.
     */
    createUiConfig(object: IObject3D): UiObjectConfig | undefined {
        const params = object.userData?.generationParams
        if (!params?.type) return undefined
        const generator = this.generators[params.type]
        if (!generator) return undefined

        return {
            type: 'folder',
            label: (object.name || params.type) + ' Params',
            expanded: true,
            onChange: () => this._markDirty(object),
            children: generator.createUiConfig(object),
        }
    }

    /**
     * Mark an object for regeneration on the next frame.
     * Multiple calls in the same frame are coalesced — the object is only regenerated once.
     */
    private _markDirty(object: IObject3D): void {
        this._dirtyObjects.add(object)
        this._viewer?.setDirty() // ensure the frame loop runs
    }

    /**
     * Regenerate an existing procedural object in-place.
     * Keeps the same root object alive (preserving UI references)
     * and replaces its children with freshly generated content.
     */
    regenerateObject(object: IObject3D): void {
        const params = object.userData?.generationParams
        if (!params?.type) return
        const generator = this.generators[params.type]
        if (!generator) return

        const rng = new SeededRandom(params.seed ?? 42)

        // Generate new content into a temporary group
        const newOutput = generator.generate(params, rng)

        // Dispose all old children of the root
        for (const child of [...object.children]) {
            child.dispose?.(true)
        }

        // Move new children into the existing root (preserves identity, position, UI)
        for (const child of [...newOutput.children]) {
            child.removeFromParent()
            object.add(child)
        }

        object.setDirty?.()
    }

    /**
     * Frame callback — processes all dirty objects.
     * Runs after rendering so UI updates are visible before the next regeneration.
     */
    private _postFrame = () => {
        if (this._dirtyObjects.size === 0) return
        const objects = [...this._dirtyObjects]
        this._dirtyObjects.clear()
        for (const obj of objects) {
            // Only regenerate if the object is still in the scene
            if (obj.parent) {
                this.regenerateObject(obj)
            }
        }
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)

        viewer.addEventListener('postFrame', this._postFrame)

        // Register with Object3DGeneratorPlugin for the "Generate" dropdown
        viewer.forPlugin<Object3DGeneratorPlugin>('Object3DGeneratorPlugin', (plugin) => {
            plugin.addObject3DGenerators('procedural-', Object.fromEntries(Object.keys(this.generators).map(key =>
                [key, (params: any) => {
                    const obj = this.generateObject(key, params)
                    return obj
                }]
            )))
        }, (plugin) => {
            plugin.removeObject3DGenerators('procedural-')
        }, this)

        // Set up UI for existing procedural objects
        viewer.object3dManager.getObjects().forEach(object => this._objectAdd({object}))
        viewer.object3dManager.addEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.addEventListener('objectRemove', this._objectRemove)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.removeEventListener('postFrame', this._postFrame)
        viewer.object3dManager.removeEventListener('objectAdd', this._objectAdd)
        viewer.object3dManager.removeEventListener('objectRemove', this._objectRemove)
        viewer.object3dManager.getObjects().forEach(object => this._objectRemove({object}))
        this._dirtyObjects.clear()
        super.onRemove(viewer)
    }

    private _objectAdd = (e: {object?: IObject3D}) => {
        const obj = e.object
        if (!obj?.userData?.generationParams?.type) return
        const type = obj.userData.generationParams.type
        if (this.generators[type]) {
            this._setupObjectUi(obj)
        }
    }

    private _objectRemove = (e: {object?: IObject3D}) => {
        const obj = e.object
        if (!obj?.userData?.generationParams?.type) return
        this._dirtyObjects.delete(obj) // don't regenerate removed objects
        removeUiFolder(obj)
    }

    private _setupObjectUi(root: IObject3D) {
        const type = root.userData?.generationParams?.type
        if (!type || !this.generators[type]) return
        const generator = this.generators[type]

        injectUiFolder(root, () => {
            const params = root.userData?.generationParams
            if (!params) return []
            return generator.createUiConfig(root)
        }, () => this._markDirty(root))
    }

    uiConfig = {
        type: 'folder' as const,
        label: 'Generate Procedural',
        children:
            [() => Object.keys(this.generators).map((v) => ({
                type: 'button' as const,
                uuid: 'procedural_generate_' + v,
                label: 'Generate ' + v,
                value: () => {
                    this.generateObject(v, undefined, undefined, true)
                },
            }))],
    }
}
