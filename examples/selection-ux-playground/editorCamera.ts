import {ICamera, ThreeViewer} from 'threepipe'
import {EditorCameraPlugin} from '@threepipe/plugin-tweakpane-editor'

/** The editor's own camera while EditorCameraPlugin is on: the camera the editor goes back to. Undefined without it. */
export function editorCamera(viewer: ThreeViewer): ICamera | undefined {
    const plugin = viewer.getPlugin(EditorCameraPlugin)
    return plugin && !plugin.isDisabled() ? plugin.camera : undefined
}
