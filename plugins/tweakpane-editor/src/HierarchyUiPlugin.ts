import {createDiv, createStyles, css} from 'ts-browser-helpers'
import Tree from 'treejs'
import {
    AViewerPluginSync,
    IObject3D,
    ISceneEventMap,
    Object3D,
    PickingPlugin,
    ThreeViewer,
    type UndoManagerPlugin, Event2,
} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'

export class HierarchyUiPlugin extends AViewerPluginSync {
    enabled = true
    public static readonly PluginType = 'HierarchyUiPlugin'

    toJSON: any = undefined

    treeView?: Tree = undefined

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
.treejs .treejs-switcher,.treejs-label,.treejs-checkbox {
    pointer-events: auto;
}

.treejs .treejs-node {
    pointer-events: none;
    position: relative;
}

.treejs .treejs-node.treejs-placeholder {
    padding-left: 20px !important;
}

.treejs .treejs-label {
    position: absolute;
    height: 16px;
    line-height: 16px;
    text-overflow: ellipsis;
    overflow: hidden;
    width: calc(100% - 50px);
    padding: 1px 4px;
    margin: 1px 0px;
    border-radius: 2px;
    box-sizing: content-box;
}

.treejs .treejs-node-selected .treejs-label {
    outline-offset: -1px;
    outline: solid 1px #1890ff;
}

.treejs .treejs-node-selected > .treejs-label {
    background-color: #067ce9;
    color: #eee;
    outline: none;
}
`)

    }

    reset(e?: Event2<'sceneUpdate', ISceneEventMap, IObject3D>) {
        if (e?.source === HierarchyUiPlugin.PluginType) return // for infinite loop

        // visible changed from outside
        if (e && e.object && e.change === 'visible' && this.treeView) {
            const nodeId = e.object.uuid
            // @ts-expect-error no type
            const node = this.treeView.nodesById[nodeId] as TNode
            if (node && !!node.status !== e.object.visible) {
                this.treeView.setValue(nodeId)
                this.treeView.updateLiElements()
            }
            // this.treeView.values = obj.children.reduce(this._findVisible, [])
            // console.log(this.treeView.values)
        }

        if (!e?.hierarchyChanged) return
        this._needsReset = true
    }

    protected async _reset() {
        this._needsReset = false

        while (this.hierarchyDiv.firstChild) this.hierarchyDiv.firstChild.remove()

        const obj = this._viewer?.scene.modelRoot
        if (!obj) return

        const data = obj.children.reduce(this._buildData, [])
        let firstChange = false

        return new Promise<void>((resolve, _reject) => {
            this.treeView = new Tree(this.hierarchyDiv, {
                closeDepth: 1,
                data,
                // values: visible, // uuids of visible nodes
                loaded: function() {
                    this.values = []
                    resolve()
                },
                onChange: () => {
                    if (!firstChange) { // first time called when loaded
                        firstChange = true
                        return
                    }
                    // timeout(200).then(() => { // wait for the UI to update
                    this._setVisible()
                    // })
                },
                onItemLabelClick: (item: any) => {
                    const obj1 = this._viewer?.scene.modelRoot.getObjectByProperty('uuid', item)
                    if (!obj1 || !obj.visible) return
                    obj1.dispatchEvent({type: 'select', value: obj1, object: obj1, ui: true})
                },
            })
        }).then(()=>{
            this._refreshVisible()
            this._selectedObjectChanged()
        })
    }

    private _refreshVisible() {
        const obj = this._viewer?.scene.modelRoot as Object3D
        if (!obj) return
        const visible = obj.children.reduce(this._findVisible, [])
        this.treeView?.emptyNodesCheckStatus()
        this.treeView?.treeNodes.map(n=>refreshVisible(n, visible, this.treeView!))
        this.treeView?.updateLiElements()
    }

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.scene.addEventListener('sceneUpdate', this.reset)
        viewer.addEventListener('postFrame', this._postFrame)

        viewer.forPlugin<PickingPlugin>('PickingPlugin', (pi)=>{
            pi.addEventListener('selectedObjectChanged', this._selectedObjectChanged)
        }, (pi)=>{
            pi.removeEventListener('selectedObjectChanged', this._selectedObjectChanged)
        }, this)
        viewer.forPlugin<UndoManagerPlugin>('UndoManagerPlugin', (um)=>{
            this.undoManager = um.undoManager
        }, ()=>{
            this.undoManager = undefined
        }, this)

        this.reset()
    }

    undoManager?: UndoManagerPlugin['undoManager'] = undefined

    private _selectedObjectChanged = ()=>{
        const picking = this._viewer?.getPlugin(PickingPlugin)
        if (!picking || !this.treeView) return
        const liElem = this.treeView.liElementsById as Record<string, HTMLLIElement>
        const elems = Object.values(liElem)
        for (const li of elems) {
            li.classList.remove('treejs-node-selected')
        }
        const selected = picking.getSelectedObject() as Object3D|undefined
        if (selected?.uuid) {
            const li = liElem[selected?.uuid]
            if (li) {
                li.classList.add('treejs-node-selected')
                li.scrollIntoView({block: 'nearest', inline: 'nearest'})
            }
        }
    }

    onRemove(viewer: ThreeViewer) {
        // todo: remove UI element.
        viewer.scene.removeEventListener('sceneUpdate', this.reset)
        viewer.removeEventListener('postFrame', this._postFrame)
        viewer.getPlugin(PickingPlugin)?.removeEventListener('selectedObjectChanged', this._selectedObjectChanged)
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
        data.push(obj.uuid)
        data.push(...obj.children.reduce(this._findVisible, []))
        return data
    }
    private _setVisible = (): void => {
        this._viewer?.doOnce('postFrame', () => {
            const obj = this._viewer?.scene.modelRoot
            if (!obj || !this.treeView) return
            const changeMap: Map<Object3D, [boolean, boolean]> = new Map()
            function cAdd(o: Object3D, v: boolean) {
                const c = changeMap.get(o)?.[0] ?? o.visible
                if (v !== c) changeMap.set(o, [v, o.visible])
            }
            obj.traverse((o)=>{
                if (o === obj) return
                // @ts-expect-error no type
                const node = this.treeView.nodesById[o.uuid] as TNode|undefined
                if (node) {
                    cAdd(o, !!node.status)
                    if (o.visible) o.traverseAncestors(p => cAdd(p, true))
                }
            })
            const cmd = {
                redo: (refresh = true)=>{
                    let changed = false
                    changeMap.entries().forEach(([o, v])=> {
                        if (o.visible === v[0]) return
                        o.visible = v[0]
                        changed = true
                    })
                    if (!changed) return
                    this._viewer?.scene?.setDirty({refreshScene: true, source: HierarchyUiPlugin.PluginType, updateGround: false})
                    refresh && this._refreshVisible()
                },
                undo: ()=>{
                    let changed = false
                    changeMap.entries().forEach(([o, v])=> {
                        if (o.visible === v[1]) return
                        o.visible = v[1]
                        changed = true
                    })
                    if (!changed) return
                    this._viewer?.scene?.setDirty({refreshScene: true, source: HierarchyUiPlugin.PluginType, updateGround: false})
                    this._refreshVisible()
                },
            }
            cmd.redo(false)
            this.undoManager?.record(cmd)
        })
    }
}

interface TNode {id: string, status: 0|1|2, text: string, children: TNode[]}
// this is required because setValues in Treejs toggles it, not sets it
function refreshVisible(node: TNode, visibles: string[], tree: Tree) {
    const v = visibles.includes(node.id)
    const last = node.status
    if (node.children.length) {
        let allVisible = true
        for (const child of node.children) {
            const res = refreshVisible(child, visibles, tree)
            if (!res) allVisible = false
        }
        node.status = v ? allVisible ? 2 : 1 : 0
    } else {
        node.status = v ? 2 : 0
    }
    if (last !== node.status) {
        // @ts-expect-error no type
        tree.willUpdateNodesById[node.id] = node
    }
    return node.status
}
