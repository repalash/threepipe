/**
 * The properties pane: Object / Mesh data / Modifiers / Material tabs for the active object.
 *
 * Object and Material render the objects' `uiConfig` through uiconfig-blueprint's `ConfigObject`
 * (the pattern from `experiments/threepipe-blueprint-editor/src/components/InspectorPanelComponent.tsx`
 * and `ObjectInspectorUI.tsx`, minus the asset-instance gates). Mesh data shows topology counts and
 * the geometry's `uiConfig`; Modifiers lists the `ModellingPlugin` document entry's stack.
 */

import React, {useEffect, useMemo, useState} from 'react'
import {Button, Divider, Tab, Tabs} from '@blueprintjs/core'
import {ConfigObject, UiConfigRendererContext} from 'uiconfig-blueprint/lib/esm/lib'
import {IMaterial, IObject3D, UiObjectConfig} from 'threepipe'
import {ModellingPlugin} from '@threepipe/plugin-modelling'
import {MeshEditPlugin} from '@threepipe/plugin-mesh-edit'
import {useEditor, useEngineVersion} from './EditorContext'

function activeObject(engine: ReturnType<typeof useEditor>['engine']): IObject3D | null {
    const ctx = engine.context()
    return ctx.editObject ?? ctx.selectedObjects[ctx.selectedObjects.length - 1] ?? null
}

function useObjectVersion(object: IObject3D | null): number {
    const [v, setV] = useState(0)
    useEffect(() => {
        if (!object) return
        const l = () => setV(x => x + 1)
        object.addEventListener('objectUpdate', l)
        object.addEventListener('materialChanged', l)
        object.addEventListener('geometryChanged', l)
        return () => {
            object.removeEventListener('objectUpdate', l)
            object.removeEventListener('materialChanged', l)
            object.removeEventListener('geometryChanged', l)
        }
    }, [object])
    return v
}

function Config({config, filter}: {config: UiObjectConfig | undefined, filter?: (c: UiObjectConfig) => boolean}) {
    if (!config) return <div className="me-empty">No settings.</div>
    config.expanded = true
    return <ConfigObject config={config} openPanel={() => {}} closePanel={() => {}} filter={filter as never} />
}

function ObjectTab({object}: {object: IObject3D}) {
    return <div className="me-props-scroll"><Config config={object.uiConfig} /></div>
}

function MeshTab({object}: {object: IObject3D}) {
    const {engine} = useEditor()
    useEngineVersion('sceneChanged', 'selectionChanged')
    const geometry = object.geometry
    const modelling = engine.viewer.getPlugin(ModellingPlugin)
    const entry = modelling?.document.find(object.uuid)
    const meshEdit = engine.viewer.getPlugin(MeshEditPlugin)
    const bm = meshEdit?.editObject === object ? meshEdit.state?.bm : null
    const pos = geometry?.getAttribute('position')
    const idx = geometry?.getIndex()
    const rows: [string, string][] = bm
        ? [['Vertices', String(bm.totvert)], ['Edges', String(bm.totedge)], ['Faces', String(bm.totface)], ['Source', 'edit session']]
        : entry
            ? [['Vertices', String(entry.mesh.vertsNum)], ['Edges', String(entry.mesh.edgesNum)], ['Faces', String(entry.mesh.facesNum)], ['Modifiers', String(entry.modifiers.length)], ['Source', 'modelling document']]
            : [['Vertices', String(pos?.count ?? 0)], ['Triangles', String(Math.floor((idx ? idx.count : pos?.count ?? 0) / 3))], ['Source', 'triangle buffer (not in the document yet)']]
    return <div className="me-props-scroll">
        <table className="me-kv"><tbody>
            {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
        <Divider />
        {geometry ? <Config config={geometry.uiConfig} /> : <div className="me-empty">No geometry.</div>}
    </div>
}

function ModifiersTab({object}: {object: IObject3D}) {
    const {engine} = useEditor()
    useEngineVersion('sceneChanged', 'historyChanged')
    const modelling = engine.viewer.getPlugin(ModellingPlugin)
    const entry = modelling?.document.find(object.uuid)
    if (!modelling) return <div className="me-empty">ModellingPlugin is not loaded.</div>
    if (!entry) return <div className="me-empty">Only objects created with Add (document objects) carry a modifier stack. Imported meshes join the document in a later phase.</div>
    const run = (cmd: Record<string, unknown>) => modelling.run({op: 'modifier', object: entry.name, ...cmd} as never)
    return <div className="me-props-scroll me-modifiers">
        {entry.modifiers.length === 0 && <div className="me-empty">No modifiers.</div>}
        {entry.modifiers.map((m, i) => <div className="me-modifier" key={i}>
            <div className="me-modifier-head">
                <span className="me-modifier-type">{m.type}</span>
                <span className="me-spacer" />
                <Button variant="minimal" size="small" icon="arrow-up" disabled={i === 0} title="Move up" onClick={() => run({index: i, move: i - 1})} />
                <Button variant="minimal" size="small" icon="arrow-down" disabled={i === entry.modifiers.length - 1} title="Move down" onClick={() => run({index: i, move: i + 1})} />
                <Button variant="minimal" size="small" icon="trash" title="Remove" onClick={() => run({index: i, remove: true})} />
            </div>
            <table className="me-kv"><tbody>
                {Object.entries(m).filter(([k]) => k !== 'type').map(([k, v]) => <tr key={k}><td>{k}</td><td>{JSON.stringify(v)}</td></tr>)}
            </tbody></table>
        </div>)}
        <div className="me-modifier-add">
            <Button size="small" icon="plus" text="Array" onClick={() => run({add: {type: 'array', mode: 'linear', count: 2, step: [1.5, 0, 0]}})} />
            <Button size="small" icon="plus" text="Mirror" onClick={() => run({add: {type: 'mirror', axis: 'x'}})} />
            <Button size="small" icon="tick" text="Apply all" disabled={!entry.modifiers.length} onClick={() => run({apply: true})} />
        </div>
    </div>
}

function MaterialTab({object}: {object: IObject3D}) {
    const materials = (Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) as IMaterial[]
    if (!materials.length) return <div className="me-empty">No material.</div>
    return <div className="me-props-scroll">
        {materials.map((m, i) => <React.Fragment key={m.uuid ?? i}>
            {materials.length > 1 && <div className="me-panel-sub">Slot {i + 1}</div>}
            <Config config={m.uiConfig} />
        </React.Fragment>)}
    </div>
}

export function Properties() {
    const {engine, ui} = useEditor()
    useEngineVersion('selectionChanged', 'modeChanged')
    const object = activeObject(engine)
    useObjectVersion(object)
    const [tab, setTab] = useState<string>('object')
    const title = useMemo(() => object ? object.name || `(${object.type})` : 'Nothing selected', [object, object?.name])

    return <UiConfigRendererContext.Provider value={ui as never}>
        <div className="me-panel me-properties" data-properties>
            <div className="me-panel-header">
                <span className="me-panel-title">Properties</span>
                <span className="me-panel-sub me-ellipsis" title={title}>{title}</span>
            </div>
            {!object
                ? <div className="me-empty">
                    <div>Select an object to see its properties.</div>
                    <div className="me-empty-hint">Click one in the viewport or the outliner.</div>
                </div>
                : <Tabs id="me-properties-tabs" selectedTabId={tab} onChange={id => setTab(String(id))} className="me-tabs" animate={false} renderActiveTabPanelOnly>
                    <Tab id="object" title="Object" panel={<ObjectTab object={object} />} />
                    <Tab id="mesh" title="Mesh" panel={<MeshTab object={object} />} />
                    <Tab id="modifiers" title="Modifiers" panel={<ModifiersTab object={object} />} />
                    <Tab id="material" title="Material" panel={<MaterialTab object={object} />} />
                </Tabs>}
        </div>
    </UiConfigRendererContext.Provider>
}
