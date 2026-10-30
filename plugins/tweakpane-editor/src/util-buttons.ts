import {
    CameraViewPlugin,
    Class,
    createDiv,
    downloadBlob,
    FullScreenPlugin,
    IViewerPlugin,
    PickingPlugin,
    PivotControlsPlugin,
    PivotEditPlugin,
    ThreeViewer,
} from 'threepipe'
import {
    autoRotateCC,
    collapse,
    download,
    editorCamera,
    expand,
    focus,
    loopCamViews,
    pivotEdit,
    playIcon,
    resetSettings,
    snapshot,
    trash,
} from './icons'
import tippy, {createSingleton} from 'tippy.js'
import type {EditorCameraPlugin} from './EditorCameraPlugin'

export interface UtilButton {
    id: string
    icon: string
    tooltip: string
    /** The button shows an on state, flipped on each click (or read from {@link isOn}) */
    toggle?: boolean
    onclick: () => Promise<void>
    /** The on state of a toggle, from the state it shows: read on setup and after a click */
    isOn?: () => boolean
    /** Calls `refresh` when the state of {@link isOn} changes elsewhere (a panel, a key), so the button follows it */
    watch?: (refresh: () => void) => void
}

export function createUtilButtons(viewer: ThreeViewer, allPlugins: Class<IViewerPlugin>[]): UtilButton[] {
    // by its type name: the tool bar does not bundle the plugin
    const camera = viewer.getPlugin<EditorCameraPlugin>('EditorCameraPlugin')
    return [
        {
            id: 'reset-settings',
            icon: resetSettings,
            tooltip: 'Reset All Settings',
            onclick: async() => {
                if (!await viewer.dialog.confirm('Reset settings: Are you sure you want to reset all plugin settings?')) return
                const ps = allPlugins.map(p => viewer.getPlugin(p)!)
                for (const p of ps) {
                    await (p as any)?.resetDefaults?.() // set in TweakpaneUiPlugin
                }
            },
        },
        {
            id: 'clear-scene',
            icon: trash,
            tooltip: 'Clear Scene',
            onclick: async() => {
                if (!await viewer.dialog.confirm('Clear scene: Are you sure you want to clear the scene?')) return
                viewer.scene.disposeSceneModels()
            },
        },
        {
            id: 'fit-scene',
            icon: focus,
            tooltip: 'Fit Object/Scene',
            onclick: async() => {
                await viewer.fitToView(viewer.getPlugin(PickingPlugin)?.getSelectedObject() || undefined)
            },
        },
        // only with the EditorCameraPlugin: on in Edit (the editor camera), off in View (the start view)
        ...camera ? [{
            id: 'editor-camera',
            icon: editorCamera,
            tooltip: 'Edit camera, off: View (C)',
            toggle: true,
            isOn: () => camera.editing,
            watch: (refresh: () => void) => camera.addEventListener('editingChange', refresh),
            onclick: async() => {
                camera.editing = !camera.editing
            },
        }] : [],
        {
            id: 'loop-cam-views',
            icon: loopCamViews,
            tooltip: 'Loop Camera Views',
            toggle: true,
            onclick: async() => {
                if (!viewer.getPlugin(CameraViewPlugin)) return
                viewer.getPlugin(CameraViewPlugin)!.viewLooping = !viewer.getPlugin(CameraViewPlugin)!.viewLooping
            },
        },
        {
            id: 'play-animations',
            icon: playIcon,
            tooltip: 'Animations',
            toggle: true,
            onclick: async() => {
                if (viewer.timeline.running) {
                    viewer.timeline.reset()
                    viewer.timeline.stop()
                } else {
                    viewer.timeline.reset()
                    viewer.timeline.start()
                }
            },
        },
        {
            id: 'auto-rotate-cc',
            icon: autoRotateCC,
            tooltip: 'Auto rotate',
            toggle: true,
            onclick: async() => {
                const controls = viewer.scene.mainCamera.controls
                if (controls?.autoRotate === undefined) return
                controls.autoRotate = !controls.autoRotate
            },
        },
        {
            id: 'pivot-controls',
            icon: pivotEdit,
            tooltip: 'Pivot Controls',
            toggle: true,
            onclick: async() => {
                const pcp = viewer.getPlugin(PivotControlsPlugin)
                if (!pcp) return
                pcp.enabled = !pcp.enabled
                // Also toggle PivotEditPlugin visibility with controls
                const pep = viewer.getPlugin(PivotEditPlugin)
                if (pep) pep.enabled = pcp.enabled
            },
        },
        {
            id: 'snapshot',
            icon: snapshot,
            tooltip: 'Capture Snapshot',
            onclick: async() => {
                const image = await viewer.getScreenshotBlob({mimeType: 'image/png'})
                image && downloadBlob(image, 'screenshot.png')
                // todo use this for waitForProgressive
                // const s = viewer.getPlugin(CanvasSnipperPlugin)
                // if (!s) {
                //     viewer.console.error('CanvasSnipperPlugin not added')
                //     return
                // }
                // await s.downloadSnapshot()
            },
        },
        {
            id: 'glb-export',
            icon: download,
            tooltip: 'Export GLB',
            onclick: async() => {
                const glb = await viewer.exportScene()
                glb && downloadBlob(glb, 'scene.glb')
                // todo use this for all export settings
                // const exporter = viewer.getPlugin(AssetExporterPlugin)
                // if (!exporter) {
                //     viewer.console.error('AssetExporterPlugin not added')
                //     return
                // }
                // await exporter?.downloadSceneGlb()
            },
        },
    ]
}


export function setupFullscreenButton(viewer: ThreeViewer) {
    const fullScreenButton = createDiv({
        innerHTML: expand,
        id: 'fsToggle',
        classList: ['round-button'],
        addToBody: false,
    })
    fullScreenButton.dataset.tippyContent = 'Full-Screen'
    viewer.getPlugin(FullScreenPlugin)?.addEventListener('enter', () => {
        fullScreenButton.innerHTML = collapse
        fullScreenButton.dataset.tippyContent = 'Exit Full-Screen'
    })
    viewer.getPlugin(FullScreenPlugin)?.addEventListener('exit', () => {
        fullScreenButton.innerHTML = expand
        fullScreenButton.dataset.tippyContent = 'Full-Screen'
    })
    fullScreenButton.onclick = () => {
        viewer.getPlugin(FullScreenPlugin)?.toggle(viewer.container)
    }
    viewer.container.appendChild(fullScreenButton)
    tippy(fullScreenButton, {
        placement: 'left',
    })
}

export function setupUtilButtonsBar(viewer: ThreeViewer, allPlugins: Class<IViewerPlugin>[]) {
    const utilButtonsContainer = createDiv({
        classList: ['button-bar', 'util-buttons-container'],
        addToBody: false,
    })
    viewer.container.appendChild(utilButtonsContainer)

    const utilButtons = createUtilButtons(viewer, allPlugins)

    for (const utilButton of utilButtons) {
        const button = createDiv({
            innerHTML: utilButton.icon,
            id: utilButton.id,
            classList: ['button-bar-button', 'util-button'],
            addToBody: false,
        })
        button.dataset.tippyContent = utilButton.tooltip
        const isOn = utilButton.isOn
        const refresh = () => isOn && button.classList.toggle('button-bar-selected-box', isOn())
        refresh()
        utilButton.watch?.(refresh)
        button.onclick = async() => {
            if (utilButton.toggle && !isOn) {
                button.classList.toggle('button-bar-selected-box')
            }
            await utilButton.onclick()
            refresh()
        }
        utilButtonsContainer.appendChild(button)
    }
    createSingleton(tippy('.util-button'), {
        moveTransition: 'transform 0.2s ease-out',
        placement: 'top',
    })
}
