import {AViewerPluginSync, createDiv, createStyles, getOrCall, ThreeViewer, uiFolderContainer} from 'threepipe'
import styles from './SamplePlugin.css?inline'
import studio from '@theatre/studio'
import {getProject, IProject, ISheet, ISheetObject, types} from '@theatre/core'
import {UiObjectConfig} from 'uiconfig.js'

@uiFolderContainer('TheatreJs', {expanded: true})
export class TheatreJsPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'TheatreJsPlugin'
    enabled = true
    dependencies = []
    project: IProject
    sheet: ISheet
    rootScene: ISheetObject<{
        // backgroundIntensity: number
    }>

    constructor() {
        super()
        studio.initialize()
        this.project = getProject('ThreeViewer')
        this.sheet = this.project.sheet('Main')
    }

    updaters: Record<any, any> = {}
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        createStyles(styles)
        // localstorage = theatre-0.4.persistent
        localStorage.setItem('theatre-0.4.persistent', '')
        this.rootScene = this.sheet.object('RootScene', {
            // backgroundIntensity: types.number(viewer.scene.backgroundIntensity),
        })
        this.rootScene.onValuesChange((values)=>{
            // viewer.scene.backgroundIntensity = values.backgroundIntensity
            Object.keys(values).forEach(key => {
                if (this.updaters['RootScene.' + key]) {
                    this.updaters['RootScene.' + key](values[key])
                } else {
                    // viewer.scene[key] = values[key]
                }
            })
        })

        const sliders = (viewer.scene.uiConfig.children?.filter(c=>(c as any)?.type === 'slider') || []) as UiObjectConfig[]
        console.log(sliders)
        for (const slider of sliders) {
            const prop = getOrCall(slider.property) // todo use uiconfigmethods
            if (!prop) continue
            const [tar, key] = prop
            if (!tar || typeof key !== 'string') continue
            const btn = createDiv({innerHTML: '◆', classList: ['theatre-anim-trigger']})
            btn.addEventListener('click', (e)=>{
                this.rootScene = this.rootScene.sheet.object('RootScene', {
                    ...this.rootScene.value,
                    [key]: types.number(tar[key], {
                        range: getOrCall(slider.bounds) as [number, number] ?? undefined,
                        label: getOrCall(slider.label) || undefined,
                    }),
                }, {reconfigure: true})
                this.updaters['RootScene.' + key] = (v: any) => {
                    if (tar[key] !== v) {
                        tar[key] = v
                    }
                }
                btn.remove()
                slider.domChildren = []
            })
            slider.domChildren = [btn]
        }
    }

}
