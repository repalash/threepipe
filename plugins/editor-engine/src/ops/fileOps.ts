/**
 * File operators: new, open, save, export (glb / obj / stl).
 *
 * Save writes a `.glb` with the viewer config embedded (threepipe's scene format); export writes
 * plain geometry files through three's exporters. `ModellingPlugin`'s glTF topology extension is
 * registered on the asset manager, so a saved file keeps editable n-gon topology.
 */

import {downloadBlob, IObject3D, uploadFile} from 'threepipe'
import {OBJExporter} from 'three/examples/jsm/exporters/OBJExporter.js'
import {STLExporter} from 'three/examples/jsm/exporters/STLExporter.js'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor} from '../registry'

export function registerFileOperators(engine: EditorEnginePlugin): void {
    const viewer = engine.viewer
    const hasObjects = () => engine.modelObjects().length > 0 || 'Nothing to export'
    const ops: OperatorDescriptor[] = [
        {
            id: 'file.new',
            label: 'New',
            description: 'Clear the scene and start again.',
            icon: 'document',
            category: 'File',
            async exec() {
                if (engine.modelObjects().length) {
                    const ok = await viewer.dialog.confirm('Start a new scene? Unsaved changes are lost.')
                    if (!ok) return {ok: true}
                }
                if (engine.mode === 'edit') engine.meshEdit.exit(false)
                engine.picking.clearSelection()
                for (const child of engine.modelObjects()) child.dispose ? child.dispose(true) : child.removeFromParent()
                engine.modelling?.document.clear()
                engine.modelling?.history.clear()
                engine.history.manager?.reset()
                engine.setLastOperation(null)
                viewer.setDirty()
                return {ok: true}
            },
        },
        {
            id: 'file.open',
            label: 'Open…',
            description: 'Import a glTF/GLB, OBJ, FBX or other model file into the scene.',
            icon: 'folder-open',
            category: 'File',
            async exec() {
                const files = await uploadFile(true, false, '.glb,.gltf,.obj,.fbx,.stl,.ply,.drc,.3dm,.usdz,.zip')
                if (!files.length) return {ok: true}
                const loaded: IObject3D[] = []
                for (const file of files) {
                    const res = await viewer.load<IObject3D>(file, {autoCenter: false, autoScale: false})
                    if (res) loaded.push(res)
                }
                if (!loaded.length) return {ok: false, error: 'Nothing could be loaded from the selected files.'}
                engine.picking.setSelectedObject(loaded[loaded.length - 1])
                return {ok: true, data: {objects: loaded.map(o => o.name)}}
            },
        },
        {
            id: 'file.save',
            label: 'Save',
            description: 'Download the scene as a .glb with the viewer settings embedded.',
            icon: 'floppy-disk',
            category: 'File',
            async exec() {
                if (engine.mode === 'edit') engine.meshEdit.applyToObject()
                const blob = await viewer.exportScene({binary: true, viewerConfig: true, preserveUUIDs: true})
                if (!blob) return {ok: false, error: 'Export failed.'}
                downloadBlob(blob, 'scene.glb')
                return {ok: true}
            },
        },
        {
            id: 'file.export_glb',
            label: 'Export GLB',
            description: 'Download the model as a plain .glb, without viewer settings.',
            icon: 'export',
            category: 'File',
            poll: hasObjects,
            async exec() {
                if (engine.mode === 'edit') engine.meshEdit.applyToObject()
                const blob = await viewer.exportScene({binary: true, viewerConfig: false})
                if (!blob) return {ok: false, error: 'Export failed.'}
                downloadBlob(blob, 'model.glb')
                return {ok: true}
            },
        },
        {
            id: 'file.export_obj',
            label: 'Export OBJ',
            description: 'Download the model as Wavefront .obj.',
            icon: 'export',
            category: 'File',
            poll: hasObjects,
            async exec() {
                if (engine.mode === 'edit') engine.meshEdit.applyToObject()
                const text = new OBJExporter().parse(viewer.scene.modelRoot as never)
                downloadBlob(new Blob([text], {type: 'text/plain'}), 'model.obj')
                return {ok: true}
            },
        },
        {
            id: 'file.export_stl',
            label: 'Export STL',
            description: 'Download the model as binary .stl, for 3D printing.',
            icon: 'export',
            category: 'File',
            poll: hasObjects,
            async exec() {
                if (engine.mode === 'edit') engine.meshEdit.applyToObject()
                const data = new STLExporter().parse(viewer.scene.modelRoot as never, {binary: true}) as DataView
                downloadBlob(new Blob([data.buffer as ArrayBuffer], {type: 'model/stl'}), 'model.stl')
                return {ok: true}
            },
        },
    ]
    for (const op of ops) engine.operators.register(op)
}
