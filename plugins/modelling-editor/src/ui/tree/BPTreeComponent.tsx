/**
 * Vendored from experiments/threepipe-blueprint-editor/src/components/BPTreeComponent.tsx: an abstract
 * uiconfig-blueprint BPComponent over the drag-and-drop Tree2, with node info map, keyboard
 * navigation and drag hooks. Subclasses implement _getRootNodes / _getNodeId / _updateNodeInfo.
 */
import {Tree2} from "./Tree2";
import {BPComponent, BPComponentProps, BPComponentState, UiConfigRendererContextType} from "uiconfig-blueprint/lib/esm/lib";
import {TreeNodeInfo} from "./treeTypes";
import React from "react";

export type BPTreeComponentState<T = {}> = BPComponentState & {
    nodes: TreeNodeInfo<T>[]
}

// https://github.com/palantir/blueprint/blob/develop/packages/docs-app/src/examples/core-examples/treeExample.tsx

type NodePath = (string|number)[];

export abstract class BPTreeComponent<T = {}, TConfigVal extends any /*|PrimitiveVal|void*/ = void, TProps = {}> extends BPComponent<TConfigVal, BPTreeComponentState<T>, BPComponentProps<TConfigVal> & {className: string} & TProps> {
    constructor(props: BPComponentProps<TConfigVal> & {className: string} & TProps, context: UiConfigRendererContextType) {
        super(props, context, {nodes: []});
    }

    protected _infoMap = new Map<string | number, TreeNodeInfo<T>>()

    protected _createNodeInfo(id: string, obj: T) {
        return {
            id,
            label: 'unnamed',
            nodeData: obj,
            childNodes: [],
            isExpanded: false,
            isSelected: false,
        }
    }

    protected abstract _getNodeId(obj: T): string

    protected abstract _updateNodeInfo(node: TreeNodeInfo<T>, obj: T): TreeNodeInfo<T>;

    protected abstract _getRootNodes(): T[]

    protected async _onNodeClick(_id: string | number) {
    }

    protected async _onNodeDoubleClick(_id: string | number) {
    }

    protected _cloneNodes(callback?: (t:TreeNodeInfo<T>)=>void, state?: TreeNodeInfo<T>[]): TreeNodeInfo<T>[] {
        return (state ?? this.state.nodes).map(n => {
            // let res: TreeNodeInfo<T> = {
            //     ...n,
            //     childNodes: n.childNodes ? this._cloneNodes(callback, n.childNodes) : undefined
            // }
            const res = n
            n.childNodes = n.childNodes ? this._cloneNodes(callback, n.childNodes) : undefined
            if(callback) callback(res)
            this._infoMap.set(n.id, res)
            return res
        })
    }

    protected _getNodePath(id: string, nodes?: TreeNodeInfo<T>[]): NodePath {
        let path1: NodePath|null = null
        this._forEachNode(nodes ?? this.state.nodes, (node, path) => {
            if (node.id === id) path1 = path
        })
        return path1 ?? []
    }

    protected _forEachNode<T>(nodes: TreeNodeInfo<T>[] | undefined, callback: (node: TreeNodeInfo<T>, path: NodePath) => void, path: NodePath = []) {
        if (nodes === undefined) {
            return nodes;
        }
        for (const node of nodes) {
            callback(node, path);
            this._forEachNode(node.childNodes, callback, [...path, node.id]);
        }
        return nodes
    }

    // protected _forNodeAtPath<T>(nodes: TreeNodeInfo<T>[], path: NodePath, callback: (node: TreeNodeInfo<T>) => void) {
    //     callback(Tree.nodeFromPath(path, nodes));
    // }

    protected async _onNodeExpandCollapse(_id: string | number, expanded?: boolean) {
        const nodes = this._cloneNodes()
        const node = this._infoMap.get(_id)
        if (!node) return
        node.isExpanded = expanded ?? !node.isExpanded
        // forNodeAtPath(nodes, _path, node => (node.isExpanded = !node.isExpanded));
        await this.setStatePromise({...this.state, nodes})
    }

    protected async _onNodeContextMenu(_id: string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>) {
    }

    protected async _onNodeMouseEnter(_id: string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>) {
    }

    protected async _onNodeMouseLeave(_id: string | number, _e: React.MouseEvent<HTMLElement, MouseEvent>) {
    }

    protected buildData(data: TreeNodeInfo<T>[], obj: T, _?: any, _2?: any): TreeNodeInfo<T>[] {
        if (!obj) return data
        const id = this._getNodeId(obj)
        if (!this._infoMap.has(id)) this._infoMap.set(id, this._createNodeInfo(id, obj))
        const node = this._infoMap.get(id)!
        const node2 = this._updateNodeInfo(node, obj)
        if (node2 !== node) this._infoMap.set(id, node2)
        this.nSet?.add(id)
        data.push(node2)
        return data
    }

    nSet?: Set<string|number>
    getUpdatedState(_state: BPTreeComponentState<T>): BPTreeComponentState<T> {
        if (!this._infoMap) this._infoMap = new Map()
        // else this._infoMap.clear()
        const children = this._getRootNodes()
        if(!this.nSet) this.nSet = new Set()
        this.nSet.clear()
        const nodes = children.map(c => {
            return this.buildData([], c, undefined, undefined)[0]
        }).filter(v => v)
        // remove old nodes
        for (const key of [...this._infoMap.keys()]) {
            if (!this.nSet.has(key)) this._infoMap.delete(key)
        }
        this.nSet.clear()
        return super.getUpdatedState({nodes})
    }

    deselectAll() {
        const nodes = this._cloneNodes(n => n.isSelected = false)
        return this.setStatePromise({...this.state, nodes})
    }

    async setSelected(id?: string|string[], expand = false) {
        const nodes =
            Array.isArray(id) ?
            this._cloneNodes(n => n.isSelected = id.includes(n.id as any)) :
            this._cloneNodes(n => n.isSelected = n.id === id)
        if(expand && id!==undefined){
            const ids = Array.isArray(id) ? id : [id]
            for (const id1 of ids) {
                const parents = this._getNodePath(id1, nodes)
                for (let i = 0; i < parents.length; i++) {
                    const node = this._infoMap.get(parents[i])
                    if(node) node.isExpanded = true
                }
            }
        }
        return this.setStatePromise({...this.state, nodes})
    }

    componentDidMount() {
        super.componentDidMount();
    }

    componentWillUnmount() {
        super.componentWillUnmount();
    }

    findSelectedNode(nodes?: TreeNodeInfo<T>[]): TreeNodeInfo<T> | undefined {
        if (!nodes) nodes = this.state.nodes
        for (const node of nodes) {
            if (node.isSelected) return node
            if (node.childNodes) {
                const res = this.findSelectedNode(node.childNodes)
                if (res) return res
            }
        }
    }
    getFlatNodes(onlyVisible = false, nodes?: TreeNodeInfo<T>[], res: TreeNodeInfo<T>[] = []): TreeNodeInfo<T>[] {
        if (!nodes) nodes = this.state.nodes
        for (const node of nodes) {
            res.push(node)
            if (node.childNodes && (!onlyVisible || node.isExpanded)) this.getFlatNodes(onlyVisible, node.childNodes, res)
        }
        return res
    }

    protected _handleKeyDown(e: React.KeyboardEvent) {
        const nodes = this.getFlatNodes(true)
        let current, next, previous;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i]
            if (node.isSelected) {
                current = node
                next = i < nodes.length - 1 ? nodes[i + 1] : undefined
                previous = i > 0 ? nodes[i - 1] : undefined
                break
            }
        }
        switch (e.key) {
            case "ArrowUp":
                if (previous) this._onNodeClick(previous.id)
                break
            case "ArrowDown":
                if (next) this._onNodeClick(next.id)
                break
            case "ArrowRight":
                if (current) this._onNodeExpandCollapse(current.id, true)
                break
            case "ArrowLeft":
                if (current) this._onNodeExpandCollapse(current.id, false)
                break
            case "Escape":
                if (current) this._onNodeClick(current.id)
                break
            case "Enter":
                if (current) this._onNodeDoubleClick(current.id)
                break
            default:
                return
        }
        e.preventDefault()
        e.stopPropagation()
    }

    protected _canDropNode(_sourceNode: TreeNodeInfo<T>, _sourcePath: NodePath, _targetNode: TreeNodeInfo<T>, _targetPath: NodePath, _index?: number) {
        return true
    }
    protected _onDropNode(_sourceNode: TreeNodeInfo<T>, _sourcePath: NodePath, _targetNode: TreeNodeInfo<T>, _targetPath: NodePath, _e?: React.DragEvent, _index?: number) {
        return
    }

    protected _onNodeDragStart(_node: TreeNodeInfo<T>, _path: NodePath, _e: React.DragEvent<HTMLElement>) {
    }

    protected _onNodeDragOver(_node: TreeNodeInfo<T>, _path: NodePath, _e: React.DragEvent<HTMLElement>, _index?: number) {
    }

    protected _onNodeDragEnd(_node: TreeNodeInfo<T>, _path: NodePath, _e: React.DragEvent<HTMLElement>) {
    }

    protected _onNodeDragEnter(_node: TreeNodeInfo<T>, _path: NodePath, _e: React.DragEvent<HTMLElement>, _index?: number) {
    }

    protected _onNodeDragLeave(_node: TreeNodeInfo<T>, _path: NodePath, _e: React.DragEvent<HTMLElement>, _index?: number) {
    }

    render() {
        const TreeT = Tree2.ofType<T>()
        return !this.state.hidden ? (
            <div
                style={{width: "100%", height: "100%"}}
                onKeyDown={e => this._handleKeyDown(e)}
                tabIndex={0}
                onContextMenu={e=>{
                    e.preventDefault()
                    e.stopPropagation()
                }}
            >
            <TreeT
                contents={this.state.nodes}
                className={"folderContent " + (this.props.className||'')}
                canDropNode={(node, path, targetNode, targetPath, index) => {
                    return this._canDropNode(node, path, targetNode, targetPath, index)
                }}
                onNodeDrop={(node, path, targetNode, targetPath, e, index) => {
                    // console.log(node, path, targetNode, targetPath, e);
                    this._onDropNode(node, path, targetNode, targetPath, e, index)
                }}
                onNodeExpand={(node, _path, _e) => {
                    this._onNodeExpandCollapse(node.id)
                }}
                onNodeCollapse={(node, _path, _e) => {
                    this._onNodeExpandCollapse(node.id)
                }}
                onNodeClick={(node, _path, _e) => {
                    this._onNodeClick(node.id)
                }}
                onNodeDoubleClick={(node, _path, _e) => {
                    this._onNodeDoubleClick(node.id)
                }}
                onNodeContextMenu={(node, _path, _e) => {
                    this._onNodeContextMenu(node.id, _e)
                }}
                onNodeMouseEnter={(node, _path, e) => {
                    this._onNodeMouseEnter(node.id, e)
                }}
                onNodeMouseLeave={(node, _path, e) => {
                    this._onNodeMouseLeave(node.id, e)
                }}
                onNodeDragStart={(node, path, e) => {
                    this._onNodeDragStart(node, path, e)
                }}
                onNodeDragOver={(node, path, e, index) => {
                    this._onNodeDragOver(node, path, e, index)
                }}
                onNodeDragEnd={(node, path, e) => {
                    this._onNodeDragEnd(node, path, e)
                }}
                onNodeDragEnter={(node, path, e, index) => {
                    this._onNodeDragEnter(node, path, e, index)
                }}
                onNodeDragLeave={(node, path, e, index) => {
                    this._onNodeDragLeave(node, path, e, index)
                }}
            /></div>
        ) : null
    }
}
