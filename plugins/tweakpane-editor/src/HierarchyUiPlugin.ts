import {createDiv, createStyles, css, timeout} from 'ts-browser-helpers'
import Tree from 'treejs'
import {AViewerPluginSync, IObject3D, Object3D, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'

export class HierarchyUiPlugin extends AViewerPluginSync {
    enabled = true
    public static readonly PluginType = 'HierarchyUiPlugin'

    toJSON: any = undefined

    treeView: any = undefined

    hierarchyDiv = createDiv({
        innerHTML: '',
        id: 'tpHierarchyContainer',
        addToBody: false,
    })

    constructor(enabled = true) {
        super()
        this.enabled = enabled
        this.reset = this.reset.bind(this)
        this._postFrame = this._postFrame.bind(this)
        this.uiConfig.domChildren = [this.hierarchyDiv]
        createStyles(css`
#tpHierarchyContainer{
    width: 100%;
    height: auto;
    background-color: transparent;
    color: var(--tp-container-foreground-color, hsl(230, 7%, 75%));
    margin-top: 0;
}
.treejs .treejs-switcher:before {
    border-top: 6px solid var(--tp-container-foreground-color, hsl(230, 7%, 75%)) !important;
}
`)

    }

    reset(e?: any) {
        if (e?.source !== HierarchyUiPlugin.PluginType) return // for infinite loop
        if (!e?.hierarchyChanged) return
        this._needsReset = true
    }
    protected async _reset() {
        this._needsReset = false

        while (this.hierarchyDiv.firstChild) this.hierarchyDiv.firstChild.remove()

        const obj = this._viewer?.scene.modelRoot
        if (!obj) return

        const data = obj.children.reduce(this._buildData, [])
        const visible = obj.children.reduce(this._findVisible, [])
        let firstChange = false
        return new Promise<void>((resolve) => {
            this.treeView = new Tree(this.hierarchyDiv, {
                closeDepth: 1,
                data,
                // values: visible, // uuids of visible nodes
                loaded: function() {
                    this.values = visible
                    resolve()
                },
                onChange: () => {
                    if (!firstChange) { // first time called when loaded
                        firstChange = true
                        return
                    }
                    timeout(200).then(() => { // wait for the UI to update
                        if (this.treeView)
                            this._setVisible(this.treeView.values)
                    })
                },
                onItemLabelClick: (item: any) => {
                    const obj1 = this._viewer?.scene.modelRoot.getObjectByProperty('uuid', item)
                    if (!obj1 || !obj.visible) return
                    obj1.dispatchEvent({type: 'select', value: obj1, object: obj1, ui: true})
                },
            })
        })
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        this.reset()
        viewer.scene.addEventListener('sceneUpdate', this.reset)
        viewer.addEventListener('postFrame', this._postFrame)
    }

    onRemove(viewer: ThreeViewer) {
        // todo: remove UI element.
        viewer.scene.removeEventListener('sceneUpdate', this.reset)
        viewer.removeEventListener('postFrame', this._postFrame)
        return super.onRemove(viewer)
    }

    protected _needsReset = false
    protected _postFrame() {
        if (this._needsReset) this._reset()
    }

    dispose() {
        // todo destroy UI element.
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'Hierarchy',
        children: [],
    }

    private _buildData = (data: any[], obj: IObject3D): any[] => {
        data.push({
            text: obj.name || 'unnamed',
            id: obj.uuid,
            children: obj.children.reduce(this._buildData, []),
        })
        return data
    }
    private _findVisible = (data: any[], obj: Object3D): any[] => { // only leaf.
        if (!obj.visible) return data
        if (obj.children.length < 1) data.push(obj.uuid)
        else data.push(...obj.children.reduce(this._findVisible, []))
        return data
    }
    private _setVisible = (values: string[]): void => {
        this._viewer?.doOnce('postFrame', () => {
            const obj = this._viewer?.scene.modelRoot
            if (!obj || values === undefined || values === null) return
            const ancestorSet: Set<Object3D> = new Set()
            obj.traverse((o)=>{
                if (o === obj) return
                o.visible = values.includes(o.uuid)
                if (o.visible) o.traverseAncestors(p=>ancestorSet.add(p))
            })
            ancestorSet.forEach(o=> o.visible = true)
            this._viewer?.scene?.setDirty({refreshScene: true, source: HierarchyUiPlugin.PluginType, updateGround: false})
        })
    }
}
