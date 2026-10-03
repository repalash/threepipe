/**
 * `createModellingEditor` - one call that builds the viewer with the plugins the editor needs,
 * adds the interaction engine (`@threepipe/plugin-editor-engine`) and mounts the React shell into
 * a container.
 */

import {createRoot, Root} from 'react-dom/client'
import {
    EditorViewWidgetPlugin,
    IViewerPlugin,
    PickingPlugin,
    ThreeViewer,
    ThreeViewerOptions,
    TransformControlsPlugin,
    UndoManagerPlugin,
} from 'threepipe'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {EditorEngine, EditorEngineOptions, EditorEnginePlugin} from '@threepipe/plugin-editor-engine'
import {EditorViewportPlugin} from './EditorViewportPlugin'
import {EditorUiPlugin} from './ui/EditorUiPlugin'
import {ModellingEditorApp} from './ui/ModellingEditorApp'
import {registerViewOperators} from './ops/viewOps'
import editorCss from './styles/editor.scss?inline'

export interface ModellingEditorOptions {
    /** Where the editor mounts. It fills this element. */
    container: HTMLElement
    /** Passed to `ThreeViewer`; `container`/`canvas` are managed here. */
    viewer?: Omit<ThreeViewerOptions, 'container' | 'canvas'>
    /** Extra plugins added before the engine is created. */
    plugins?: IViewerPlugin[]
    /** Options for the engine: the keymap preset to start with, persistence. */
    engine?: EditorEngineOptions
    /** Supply an engine of your own instead of `EditorEnginePlugin`. */
    createEngine?: (viewer: ThreeViewer) => EditorEngine
    /** Name shown in the header. */
    title?: string
    /** Environment map URL, loaded after setup. */
    environment?: string | null
}

export interface ModellingEditor {
    viewer: ThreeViewer
    engine: EditorEngine
    ui: EditorUiPlugin
    root: Root
    dispose(): void
}

let cssInjected = false

export function createModellingEditor(options: ModellingEditorOptions): ModellingEditor {
    if (!cssInjected) {
        const style = document.createElement('style')
        style.id = 'modelling-editor-styles'
        style.textContent = editorCss
        document.head.appendChild(style)
        cssInjected = true
    }

    // The viewer owns a detached container that the Viewport component adopts on mount.
    const viewerContainer = document.createElement('div')
    viewerContainer.className = 'me-viewer-container'
    const viewer = new ThreeViewer({
        msaa: true,
        rgbm: false,
        zPrepass: false,
        renderScale: 'auto',
        dropzone: {addOptions: {autoCenter: false, autoScale: false}},
        ...options.viewer,
        container: viewerContainer,
        plugins: [
            UndoManagerPlugin,
            new PickingPlugin(undefined, false),
            new TransformControlsPlugin(true),
            new EditorViewWidgetPlugin('bottom-right', 96),
            ModellingPlugin,
            MeshEditPlugin,
            EditorViewportPlugin,
            ...(options.viewer?.plugins ?? []),
        ],
    })
    for (const p of options.plugins ?? []) viewer.addPluginSync(p)

    const ui = viewer.addPluginSync(new EditorUiPlugin())
    const engine = options.createEngine ? options.createEngine(viewer) : viewer.addPluginSync(new EditorEnginePlugin(options.engine))
    const unregisterViewOps = registerViewOperators(engine, viewer.getPlugin(EditorViewportPlugin))
    const picking = viewer.getPlugin(PickingPlugin)!
    picking.widgetEnabled = true
    // The gizmo is driven by the toolbar's tool; start with it hidden (Select tool).
    viewer.getPlugin(TransformControlsPlugin)?.disable('modelling-editor-tool')

    if (options.environment !== null) {
        viewer.setEnvironmentMap(options.environment ?? 'https://samples.threepipe.org/minimal/venice_sunset_1k.hdr')
            .catch(e => engine.message('warning', 'Environment map failed to load: ' + (e?.message ?? e)))
    }
    viewer.scene.setBackgroundColor('#2b2b30')
    // A three-quarter view to start, as Blender's default scene, rather than straight down an axis.
    const cam = viewer.scene.mainCamera
    cam.position.set(4.2, 3.1, 5.4)
    cam.target.set(0, 0, 0)
    cam.setDirty({change: 'transform'} as never)

    options.container.classList.add('me-host')
    const root = createRoot(options.container)
    root.render(<ModellingEditorApp value={{viewer, engine, ui}} title={options.title} />)

    return {
        viewer, engine, ui, root,
        dispose() {
            root.unmount()
            unregisterViewOps()
            engine.dispose()
            viewer.dispose()
        },
    }
}
