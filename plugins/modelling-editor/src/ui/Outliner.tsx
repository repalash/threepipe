/**
 * The outliner: a drag-and-drop tree of the scene's objects.
 *
 * Adapted from `experiments/threepipe-blueprint-editor/src/components/BPHierarchyComponent.tsx`.
 * Changes: roots are the model root's children (no scene/camera rows), click selects through
 * `PickingPlugin`, double-click enters edit mode (plan P0.5), the object being edited is marked and
 * cannot be dragged, drops re-parent through the undo manager instead of Kite's
 * `CanvasFileDropHandler`, and the context menu comes from the operator registry.
 */

import React, {useMemo} from 'react'
import {Icon, Intent} from '@blueprintjs/core'
import {bpUiConfigIcons, UiConfigRendererContextType} from 'uiconfig-blueprint/lib/esm/lib'
import {IObject3D, PickingPlugin, UiObjectConfig} from 'threepipe'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'
import {BPTreeComponent} from './tree/BPTreeComponent'
import type {TreeNodeInfo} from './tree/treeTypes'
import {useEditor, useEngineVersion} from './EditorContext'
import {useContextMenu} from './ContextMenuProvider'
import type {EditorEngine} from '@threepipe/plugin-editor-engine'
import {IconButton} from './IconButton'

export class VisibilityToggle extends React.Component<{obj: IObject3D, engine: EditorEngine}> {
    render() {
        const {obj} = this.props
        return <Icon
            icon={obj.visible ? 'eye-open' : 'eye-off'}
            className={'me-visibility' + (obj.visible ? '' : ' me-visibility-off')}
            title={obj.visible ? 'Hide' : 'Show'}
            onClick={e => {
                e.stopPropagation()
                const next = !obj.visible
                const apply = (v: boolean) => { obj.visible = v; obj.setDirty?.({change: 'visible'} as never) }
                apply(next)
                this.props.engine.record({label: `${next ? 'Show' : 'Hide'} ${obj.name || 'object'}`, undo: () => apply(!next), redo: () => apply(next)})
                this.forceUpdate()
            }}
        />
    }
}

interface HierarchyTreeProps {
    engine: EditorEngine
    onContextMenu: (e: React.MouseEvent<HTMLElement>, obj: IObject3D) => void
}

export class HierarchyTree<T extends IObject3D = IObject3D> extends BPTreeComponent<T, IObject3D, HierarchyTreeProps> {
    declare context: UiConfigRendererContextType & {viewer?: any}

    private get _viewer() {
        return this.props.engine.viewer
    }

    protected _createNodeInfo(id: string, obj: T) {
        return Object.assign(super._createNodeInfo(id, obj), {
            secondaryLabel: <VisibilityToggle obj={obj} engine={this.props.engine} />,
            draggable: true,
            droppable: true,
            isExpanded: true,
        })
    }

    protected _getNodeId(obj: T) {
        return obj.uuid
    }

    protected _updateNodeInfo(node: TreeNodeInfo<T>, obj: T) {
        const editing = this.props.engine.viewer.getPlugin(MeshEditPlugin)?.editObject === obj
        node.label = obj.name ? obj.name : obj.type ? `(${obj.type})` : 'unnamed'
        node.className = editing ? 'me-tree-editing' : undefined
        node.childNodes = ((obj.children as T[]) || [])
            .filter(c => !(c as any).isWidget && c.assetType !== 'widget')
            .reduce<any[]>((...args) => this.buildData(...args), [])
        // the base constructor builds the first state before this class's fields exist
        node.isSelected = !!this._selectedIds?.has(node.id as string)
        node.icon = undefined
        const o = obj as any
        if (obj.isLight) {
            node.icon = o.isAmbientLight ? 'flash' : o.isPointLight ? 'lightbulb' : o.isDirectionalLight ? 'torch'
                : o.isSpotLight ? bpUiConfigIcons['shape-cone-filled-2']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
                    : o.isRectAreaLight ? 'rectangle' : 'flash'
        } else if (obj.isMesh) {
            node.icon = bpUiConfigIcons['shape-cube-transparent-filled-mono']({style: {color: 'transparent'}, className: 'bp5-tree-node-icon-svg'})
        } else if (obj.isCamera) {
            node.icon = 'camera'
        } else if (obj.isLine || o.isPoints) {
            node.icon = 'flows'
        } else {
            node.icon = 'folder-close'
        }
        node.intent = editing ? Intent.WARNING : Intent.NONE
        node.hasCaret = node.childNodes.length > 0
        node.draggable = !editing
        node.droppable = !editing && !obj.isMesh && !obj.isLight && !obj.isCamera || !!node.childNodes.length
        return node
    }

    protected _getRootNodes(): T[] {
        return (this._viewer.scene.modelRoot.children as T[]).filter(c => !(c as any).isWidget && c.assetType !== 'widget')
    }

    protected async _onNodeClick(_id: string) {
        const node = this._infoMap.get(_id)
        if (!node?.nodeData) return
        const picking = this._viewer.getPlugin(PickingPlugin)
        const obj = node.nodeData
        if (this.props.engine.mode === 'edit') {
            // Element selection lives in the viewport; the outliner only switches objects.
            if (this.props.engine.viewer.getPlugin(MeshEditPlugin)?.editObject !== obj) {
                this.props.engine.setMode('object')
                picking?.setSelectedObject(obj)
            }
            return
        }
        if (node.isSelected && picking?.getSelectedObjects().length === 1) picking.setSelectedObject(undefined)
        else picking?.setSelectedObject(obj)
    }

    protected async _onNodeDoubleClick(_id: string) {
        const node = this._infoMap.get(_id)
        if (!node?.nodeData) return
        const obj = node.nodeData
        this._viewer.getPlugin(PickingPlugin)?.setSelectedObject(obj)
        if (obj.geometry) this.props.engine.setMode('edit')
        else this.props.engine.run('view.frame_selected')
    }

    protected async _onNodeContextMenu(_id: string, e: React.MouseEvent<HTMLElement>) {
        e.preventDefault()
        e.stopPropagation()
        const node = this._infoMap.get(_id)
        if (!node?.nodeData) return
        if (!node.isSelected) await this._onNodeClick(_id)
        this.props.onContextMenu(e, node.nodeData)
    }

    protected _canDropNode(sourceNode: TreeNodeInfo<T>, _sp: number[], targetNode: TreeNodeInfo<T>, _tp: number[]) {
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if (!source || !target || source === target) return false
        let p: IObject3D | null = target
        while (p) {
            if (p === source) return false // no cycles
            p = p.parent as IObject3D | null
        }
        return true
    }

    protected _onDropNode(sourceNode: TreeNodeInfo<T>, _sp: number[], targetNode: TreeNodeInfo<T>, _tp: number[], _e?: React.DragEvent, index?: number) {
        const source = sourceNode.nodeData
        const target = targetNode.nodeData
        if (!source || !target || !this._canDropNode(sourceNode, _sp, targetNode, _tp)) return
        const oldParent = source.parent as IObject3D
        const oldIndex = oldParent.children.indexOf(source)
        // index given: drop between siblings of target's parent; otherwise drop into target.
        const newParent = index !== undefined ? target.parent as IObject3D : target
        const move = (parent: IObject3D, at: number | undefined) => {
            source.removeFromParent()
            if (at !== undefined && at >= 0 && at <= parent.children.length) {
                parent.children.splice(at, 0, source)
                source.parent = parent
                source.dispatchEvent({type: 'added'} as never)
            } else {
                parent.add(source)
            }
            source.setDirty?.({change: 'addedToParent', bubbleToParent: true} as never)
            this._viewer.scene.setDirty({refreshScene: true})
            this.refreshConfigState()
        }
        const newIndex = index !== undefined ? index - (oldParent === newParent && oldIndex < index ? 1 : 0) : undefined
        move(newParent, newIndex)
        this.props.engine.record({
            label: `Move ${source.name || 'object'}`,
            undo: () => move(oldParent, oldIndex),
            redo: () => move(newParent, newIndex),
        })
    }

    private _selectedIds: Set<string> | undefined
    private _refresh = () => {
        const picking = this._viewer.getPlugin(PickingPlugin)
        this._selectedIds = new Set(picking?.getSelectedObjects<IObject3D>().map(o => o?.uuid).filter(u => !!u) as string[])
        const edit = this._viewer.getPlugin(MeshEditPlugin)?.editObject
        if (edit) this._selectedIds.add(edit.uuid)
        this.refreshConfigState()
    }

    componentDidMount() {
        super.componentDidMount()
        const engine = this.props.engine
        engine.addEventListener('selectionChanged', this._refresh)
        engine.addEventListener('sceneChanged', this._refresh)
        engine.addEventListener('modeChanged', this._refresh)
        this._refresh()
    }

    componentWillUnmount() {
        const engine = this.props.engine
        engine.removeEventListener('selectionChanged', this._refresh)
        engine.removeEventListener('sceneChanged', this._refresh)
        engine.removeEventListener('modeChanged', this._refresh)
        super.componentWillUnmount()
    }
}

const outlinerConfig: UiObjectConfig = {type: 'hierarchy', label: 'Outliner', uuid: 'me-outliner'}

export function Outliner() {
    const {engine} = useEditor()
    const contextMenu = useContextMenu()
    const version = useEngineVersion('sceneChanged', 'selectionChanged')
    const stats = useMemo(() => engine.stats(), [engine, version])

    return <div className="me-panel me-outliner">
        <div className="me-panel-header">
            <span className="me-panel-title">Outliner</span>
            <span className="me-panel-sub">{stats.objects} object{stats.objects === 1 ? '' : 's'}</span>
            <span className="me-spacer" />
            <IconButton icon="plus" size="small" label="Add" description="Add a primitive at the origin" onClick={e => {
                const ctx = engine.context()
                const ops = engine.operators.list(op => op.category === 'Add' && (!op.modes || op.modes.includes(ctx.mode)))
                contextMenu.show(e, <div className="bp5-menu me-context-menu">{ops.map(op =>
                    <a key={op.id} className="bp5-menu-item" onClick={() => { engine.run(op.id); contextMenu.hide() }}>
                        <Icon icon={op.icon as never} /><span className="bp5-fill bp5-text-overflow-ellipsis">{op.label}</span>
                    </a>)}</div>)
            }} />
        </div>
        <div className="me-panel-body me-outliner-body">
            <HierarchyTree
                config={outlinerConfig}
                className="me-tree"
                engine={engine}
                onContextMenu={(e, obj) => contextMenu.showOperators(e, 'object', undefined, obj.name || 'Object')}
            />
            {stats.objects === 0 && <div className="me-empty">
                <div>The scene is empty.</div>
                <div className="me-empty-hint">Use <b>Add</b> above, or File &gt; Open.</div>
            </div>}
        </div>
    </div>
}
