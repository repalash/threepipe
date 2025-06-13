import {AViewerPluginSync, createStyles, ThreeViewer,} from 'threepipe'
import {TweakpaneUiPlugin} from '@threepipe/plugin-tweakpane'
import styles from './SamplePlugin.css?inline'

console.log(TweakpaneUiPlugin)

export class SamplePlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'SamplePlugin'
    enabled = true
    dependencies = []

    constructor() {
        super()
    }
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        createStyles(styles)
    }
}
