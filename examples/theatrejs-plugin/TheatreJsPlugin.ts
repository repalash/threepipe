import {AViewerPluginSync, createDiv, createStyles, getOrCall, ThreeViewer, uiFolderContainer, UiObjectConfig} from 'threepipe'
import 'https://unpkg.com/@theatre/browser-bundles@0.7.2/dist/core-and-studio.js'

// @ts-expect-error no types
const {core, studio} = Theatre
const {getProject, types /* , IProject, ISheet, ISheetObject*/} = core

// @ts-expect-error required for theatre.js to work in browser
window.process = {env: {}}

@uiFolderContainer('TheatreJs', {expanded: true})
export class TheatreJsPlugin extends AViewerPluginSync {
    public static readonly PluginType: string = 'TheatreJsPlugin'
    enabled = true
    dependencies = []
    project/* : IProject*/
    sheet/* : ISheet*/
    rootScene: any /* :ISheetObject<{}>*/

    constructor() {
        super()
        studio.initialize()
        this.project = getProject('ThreeViewer')
        this.sheet = this.project.sheet('Main')
    }

    updaters: Record<any, any> = {}
    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        createStyles(`
        .theatre-anim-trigger{
            padding: 4px;
            margin-top: -4px;
            cursor: pointer;
            color: var(--tp-label-foreground-color, #777);
        }
        `)
        localStorage.setItem('theatre-0.4.persistent', '') // todo this doesnt work?
        this.rootScene = this.sheet.object('RootScene', {})
        this.rootScene.onValuesChange((values: any)=>{
            Object.keys(values).forEach(key => {
                if (this.updaters['RootScene.' + key]) {
                    this.updaters['RootScene.' + key](values[key])
                } else {
                    // viewer.scene[key] = values[key]
                }
            })
        })

        const sliders = (viewer.scene.uiConfig.children?.filter(c=>(c as any)?.type === 'slider') || []) as UiObjectConfig[]
        for (const slider of sliders) {
            const prop = getOrCall(slider.property) // todo use uiconfigmethods
            if (!prop) continue
            const [tar, key] = prop
            if (!tar || typeof key !== 'string') continue
            const btn = createDiv({innerHTML: '◆', classList: ['theatre-anim-trigger']})
            btn.addEventListener('click', ()=>{
                this.rootScene = this.rootScene.sheet.object('RootScene', {
                    ...this.rootScene.value,
                    [key]: types.number(tar[key], {
                        range: getOrCall(slider.bounds) as [number, number] ?? undefined,
                        label: getOrCall(slider.label) || undefined,
                    }),
                }, {reconfigure: true})
                this.updaters['RootScene.' + key] = (v: any) => {
                    if (tar[key] !== v) tar[key] = v
                }
                btn.remove()
                slider.domChildren = []
            })
            slider.domChildren = [btn]
        }
    }

}
