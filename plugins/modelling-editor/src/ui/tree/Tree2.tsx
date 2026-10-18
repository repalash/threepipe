/*
 * Copyright 2015 Palantir Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Vendored into @threepipe/plugin-modelling-editor from experiments/threepipe-blueprint-editor/src/components
 * (which vendored it from @blueprintjs/core). Changes:
 * - Added support for drag and drop
 *
 */
import classNames from "classnames";
import * as React from "react";

import type {TreeEventHandler} from "@blueprintjs/core";
import {Classes, DISPLAYNAME_PREFIX, type Props} from "@blueprintjs/core";
import {TreeNode2} from "./TreeNode2";
import {TREE_NODE} from "@blueprintjs/core/lib/esnext/common/classes";
import { TreeNodeInfo } from "./treeTypes";

// eslint-disable-next-line @typescript-eslint/ban-types
export interface TreeProps<T = {}> extends Props {
    /**
     * Whether to use a compact appearance which reduces the visual padding around node content.
     */
    compact?: boolean;

    /**
     * The data specifying the contents and appearance of the tree.
     */
    contents: ReadonlyArray<TreeNodeInfo<T>>;

    /**
     * Invoked when a node is clicked anywhere other than the caret for expanding/collapsing the node.
     */
    onNodeClick?: TreeEventHandler<T>;

    /**
     * Invoked when caret of an expanded node is clicked.
     */
    onNodeCollapse?: TreeEventHandler<T>;

    /**
     * Invoked when a node is right-clicked or the context menu button is pressed on a focused node.
     */
    onNodeContextMenu?: TreeEventHandler<T>;

    /**
     * Invoked when a node is double-clicked. Be careful when using this in combination with
     * an `onNodeClick` (single-click) handler, as the way this behaves can vary between browsers.
     * See http://stackoverflow.com/q/5497073/3124288
     */
    onNodeDoubleClick?: TreeEventHandler<T>;

    /**
     * Invoked when the caret of a collapsed node is clicked.
     */
    onNodeExpand?: TreeEventHandler<T>;

    /**
     * Invoked when the mouse is moved over a node.
     */
    onNodeMouseEnter?: TreeEventHandler<T>;

    /**
     * Invoked when the mouse is moved out of a node.
     */
    onNodeMouseLeave?: TreeEventHandler<T>;

    /**
     * Invoked when a node is dropped onto another node.
     */
    onNodeDrop?: (source: TreeNodeInfo<T>, sourcePath: number[], target: TreeNodeInfo<T>, targetPath: number[], event: React.DragEvent<HTMLElement>, index?: number) => void;

    /**
     * Invoked when a node drag starts.
     */
    onNodeDragStart?: (node: TreeNodeInfo<T>, path: number[], event: React.DragEvent<HTMLElement>) => void;

    /**
     * Invoked when a node is dragged over another node.
     */
    onNodeDragOver?: (node: TreeNodeInfo<T>, path: number[], event: React.DragEvent<HTMLElement>, index?: number) => void;

    /**
     * Invoked when a node drag ends.
     */
    onNodeDragEnd?: (node: TreeNodeInfo<T>, path: number[], event: React.DragEvent<HTMLElement>) => void;

    /**
     * Invoked when a dragged node enters another node.
     */
    onNodeDragEnter?: (node: TreeNodeInfo<T>, path: number[], event: React.DragEvent<HTMLElement>, index?: number) => void;

    /**
     * Invoked when a dragged node leaves another node.
     */
    onNodeDragLeave?: (node: TreeNodeInfo<T>, path: number[], event: React.DragEvent<HTMLElement>, index?: number) => void;

    /**
     * A function that determines whether a node can be dropped onto another node.
     * @param source
     * @param target
     */
    canDropNode?: (source: TreeNodeInfo<T>, sourcePath: number[], target: TreeNodeInfo<T>, targetPath: number[], index?: number) => boolean;
}

/**
 * Tree component.
 *
 * @see https://blueprintjs.com/docs/#core/components/tree
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export class Tree2<T = {}> extends React.Component<TreeProps<T>> {
    public static displayName = `${DISPLAYNAME_PREFIX}.Tree`;

    public static ofType<U>() {
        return Tree2 as new (props: TreeProps<U>) => Tree2<U>;
    }

    public static nodeFromPath<U>(
        path: readonly number[],
        treeNodes?: ReadonlyArray<TreeNodeInfo<U>>,
    ): TreeNodeInfo<U> {
        if (path.length === 1) {
            return treeNodes![path[0]];
        } else {
            return Tree2.nodeFromPath(path.slice(1), treeNodes![path[0]].childNodes);
        }
    }

    private nodeRefs: { [nodeId: string]: HTMLElement } = {};
    private dragSource: { node: TreeNodeInfo<T>; path: number[] } | null = null;
    private draggingNode?: { node: TreeNodeInfo<T>; path: number[] };
    private dragOverNode?: { node: TreeNodeInfo<T>; path: number[]; currentTarget?: HTMLElement };
    private rootRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();

    public render() {
        return (
            <div
                className={classNames(Classes.TREE, this.props.className, {
                    [Classes.COMPACT]: this.props.compact,
                })}
                ref={this.rootRef}
            >
                {this.renderNodes(this.props.contents, [], Classes.TREE_ROOT)}
            </div>
        );
    }

    /**
     * Returns the underlying HTML element of the `Tree` node with an id of `nodeId`.
     * This element does not contain the children of the node, only its label and controls.
     * If the node is not currently mounted, `undefined` is returned.
     */
    public getNodeContentElement(nodeId: string | number): HTMLElement | undefined {
        return this.nodeRefs[nodeId];
    }
    private renderNodeSpacer = (node: TreeNodeInfo<T>, path: number[], i: number)=> {
        return <li className={Classes.TREE + "-drop-spacer"}
                   key={"drop-" + node.id + "-" + i}
        >
            <div
                onDragOver={(e) => this.handleNodeDragOver(node, path, e, i)}
                onDrop={(e) => this.handleNodeDrop(node, path, e, i)}
                onDragEnter={(e) => this.handleNodeDragEnter(node, path, e, i)}
                onDragLeave={(e) => this.handleNodeDragLeave(node, path, e, i)}
            ></div>
        </li>
    }

    private renderNodes(
        treeNodes: ReadonlyArray<TreeNodeInfo<T>> | undefined,
        currentPath?: number[],
        className?: string,
        parentNode?: TreeNodeInfo<T>,
    ) {
        if (treeNodes == null) {
            return null;
        }

        const nodeItems = treeNodes.map((node, i) => {
            const elementPath = currentPath!.concat(i);
            const draggable = !!node.draggable;
            const droppable = !!node.droppable;
            const parentDroppable = !!(parentNode && parentNode.droppable);
            return (<React.Fragment key={'wr-'+node.id}>
                {parentDroppable && i === 0 && this.renderNodeSpacer(parentNode, elementPath, i)}
                <TreeNode2<T>
                        {...node}
                        key={'node-'+node.id}
                        contentRef={this.handleContentRef}
                        depth={elementPath.length - 1}
                        onClick={this.handleNodeClick}
                        onContextMenu={this.handleNodeContextMenu}
                        onCollapse={this.handleNodeCollapse}
                        onDoubleClick={this.handleNodeDoubleClick}
                        onExpand={this.handleNodeExpand}
                        onMouseEnter={this.handleNodeMouseEnter}
                        onMouseLeave={this.handleNodeMouseLeave}
                        path={elementPath}
                        draggable={draggable}
                        onDragStart={draggable ? this.handleNodeDragStart : undefined}
                        onDragEnd={draggable ? this.handleNodeDragEnd : undefined}
                        onDragOver={droppable ? this.handleNodeDragOver : undefined}
                        onDrop={droppable ? this.handleNodeDrop : undefined}
                        onDragEnter={droppable ? this.handleNodeDragEnter : undefined}
                        onDragLeave={droppable ? this.handleNodeDragLeave : undefined}
                >
                    {this.renderNodes(node.childNodes, elementPath, undefined, node)}
                </TreeNode2>
                {parentDroppable && i >= 0 && this.renderNodeSpacer(parentNode, elementPath, i + 1)}
            </React.Fragment>)
        });

        return <ul className={classNames(Classes.TREE_NODE_LIST, className)}>{nodeItems}</ul>;
    }

    private handleContentRef = (node: TreeNodeInfo<T>, element: HTMLElement | null) => {
        if (element != null) {
            this.nodeRefs[node.id] = element;
        } else {
            // don't want our object to get bloated with old keys
            delete this.nodeRefs[node.id];
        }
    };

    private handleNodeCollapse = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeCollapse?.(node, path, e);
    };

    private handleNodeClick = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeClick?.(node, path, e);
    };

    private handleNodeContextMenu = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeContextMenu?.(node, path, e);
    };

    private handleNodeDoubleClick = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeDoubleClick?.(node, path, e);
    };

    private handleNodeExpand = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeExpand?.(node, path, e);
    };

    private handleNodeMouseEnter = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeMouseEnter?.(node, path, e);
    };

    private handleNodeMouseLeave = (node: TreeNodeInfo<T>, path: number[], e: React.MouseEvent<HTMLElement>) => {
        this.props.onNodeMouseLeave?.(node, path, e);
    };

    // Drag and drop handlers
    private handleNodeDragStart = (node: TreeNodeInfo<T>, path: number[], e: React.DragEvent<HTMLElement>) => {
        this.dragSource = { node, path };
        this.draggingNode = { node, path };
        this.rootRef?.current?.classList.add(Classes.TREE + "-dragging-node");
        this.addNodeClass(node, TREE_NODE + "-dragging");
        try {
            e.dataTransfer.clearData();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/json", JSON.stringify({ nodeId: node.id, path }));
        } catch {
            // ignore
        }
        this.props.onNodeDragStart?.(node, path, e);
    };

    private handleNodeDragOver = (node: TreeNodeInfo<T>, path: number[], e: React.DragEvent<HTMLElement>, index?: number) => {
        if (this.dragSource && this.props.canDropNode) {
            const canDrop = this.props.canDropNode(this.dragSource.node, this.dragSource.path, node, path, index);
            if (!canDrop) {
                e.dataTransfer.dropEffect = "none";
                e.preventDefault();
                return;
            }
        }
        const currentTarget = e.currentTarget as HTMLElement;
        if ((this.dragOverNode?.node.id !== node.id || this.dragOverNode?.currentTarget !== currentTarget) && this.draggingNode?.node.id !== node.id) {
            if (this.dragOverNode) this.removeNodeClass(this.dragOverNode.node, TREE_NODE + "-dragover", this.dragOverNode.currentTarget);
            this.dragOverNode = { node, path, currentTarget };
            this.addNodeClass(this.dragOverNode.node, TREE_NODE + "-dragover", this.dragOverNode.currentTarget);
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        this.props.onNodeDragOver?.(node, path, e, index);
    };

    private handleNodeDrop = (targetNode: TreeNodeInfo<T>, targetPath: number[], e: React.DragEvent<HTMLElement>, index?: number) => {
        e.preventDefault();
        const source = this.dragSource
        const canDrop = !source ? false : (this.props.canDropNode ? this.props.canDropNode(source.node, source.path, targetNode, targetPath, index) : true);
        if (this.dragOverNode) this.removeNodeClass(this.dragOverNode.node, TREE_NODE + "-dragover", this.dragOverNode.currentTarget);
        if (this.draggingNode) this.removeNodeClass(this.draggingNode.node, TREE_NODE + "-dragging");
        this.dragSource = null;
        this.draggingNode = undefined;
        this.rootRef?.current?.classList.remove(Classes.TREE + "-dragging-node");
        this.dragOverNode = undefined;
        if (canDrop && source && this.props.onNodeDrop) {
            this.props.onNodeDrop(source.node, source.path, targetNode, targetPath, e, index);
        }
    };

    private handleNodeDragEnd = (node: TreeNodeInfo<T>, path: number[], e: React.DragEvent<HTMLElement>, _index?: number) => {
        if (this.draggingNode) this.removeNodeClass(this.draggingNode.node, TREE_NODE + "-dragging");
        if (this.dragOverNode) this.removeNodeClass(this.dragOverNode.node, TREE_NODE + "-dragover", this.dragOverNode.currentTarget);
        this.dragSource = null;
        this.draggingNode = undefined;
        this.rootRef?.current?.classList.remove(Classes.TREE + "-dragging-node");
        this.dragOverNode = undefined;
        this.props.onNodeDragEnd?.(node, path, e);
    };

    private handleNodeDragEnter = (node: TreeNodeInfo<T>, path: number[], e: React.DragEvent<HTMLElement>, index?: number) => {
        this.props.onNodeDragEnter?.(node, path, e, index);
    };

    private handleNodeDragLeave = (node: TreeNodeInfo<T>, path: number[], e: React.DragEvent<HTMLElement>, index?: number) => {
        if (this.dragOverNode) this.removeNodeClass(this.dragOverNode.node, TREE_NODE + "-dragover", this.dragOverNode.currentTarget);
        this.dragOverNode = undefined;
        this.props.onNodeDragLeave?.(node, path, e, index);
    };

    private addNodeClass = (node: TreeNodeInfo<T>|number[], className: string, currentTarget?: HTMLElement) => {
        const el = this.nodeRefs[!Array.isArray(node) ? node.id : Tree2.nodeFromPath(node, this.props.contents).id];
        if (el) el.classList.add(className);
        if(currentTarget) currentTarget.classList.add(className);
    }
    private removeNodeClass = (node: TreeNodeInfo<T>|number[], className: string, currentTarget?: HTMLElement) => {
        const el = this.nodeRefs[!Array.isArray(node) ? node.id : Tree2.nodeFromPath(node, this.props.contents).id];
        if (el) el.classList.remove(className);
        if(currentTarget) currentTarget.classList.remove(className);
    }
}
