/**
 * File operators: new, open (replaces the scene), import (adds to it), save, save as, export
 * (glb / obj / stl), and the drag-and-drop path.
 *
 * Save writes a `.glb` with the viewer config embedded (threepipe's scene format) through the asset
 * exporter, which runs every registered glTF extension - `ModellingPlugin`'s
 * `THREEPIPE_mesh_topology` among them - so a saved model re-opens with its n-gon topology and
 * modifier stack intact. Export writes plain geometry files through three's exporters.
 *
 * A browser cannot overwrite the file it opened, so Save downloads `<name>.glb` (Save As asks for the
 * name) and the document name plus a dirty flag live in {@link EditorFile}. The File System Access
 * API (Chromium) could make Save write in place; not used yet so the behaviour is the same in every
 * browser.
 */

import {downloadBlob, DropzonePlugin, IObject3D, uploadFile} from 'threepipe'
import {OBJExporter} from 'three/examples/jsm/exporters/OBJExporter.js'
import {STLExporter} from 'three/examples/jsm/exporters/STLExporter.js'
import type {EditorEnginePlugin} from '../EditorEnginePlugin'
import type {OperatorDescriptor, OperatorResult} from '../registry'
import {baseName} from '../files/EditorFile'

const OPEN_ACCEPT = '.glb,.gltf,.obj,.fbx,.stl,.ply,.drc,.3dm,.usdz,.zip'

export function registerFileOperators(engine: EditorEnginePlugin): void {
    const viewer = engine.viewer
    const file = engine.file
    const hasObjects = () => engine.modelObjects().length > 0 || `Nothing to export yet: add a shape first (Add menu${engine.keyHint('add.menu')})`

    /** Everything out of the scene and the histories, as File > New does. */
    const clearScene = () => {
        if (engine.mode === 'edit') engine.meshEdit.exit(false)
        engine.picking.clearSelection()
        for (const child of engine.modelObjects()) child.dispose ? child.dispose(true) : child.removeFromParent()
        engine.modelling?.document.clear()
        engine.modelling?.history.clear()
        engine.history.manager?.reset()
        engine.setLastOperation(null)
        viewer.setDirty()
    }

    /** Ask before throwing away unsaved work. */
    const confirmDiscard = async(what: string): Promise<boolean> => {
        if (!file.dirty || !engine.modelObjects().length) return true
        return viewer.dialog.confirm(`${what}? Unsaved changes are lost. Save first with File > Save${engine.keyHint('file.save')}.`)
    }

    /**
     * Load files into the scene and select what arrived. What arrived is read off the scene, not the
     * loader's return value: a threepipe .glb (viewer config embedded) hands back its glTF scene root
     * after moving that root's children into the model root, so the returned object is not in the scene.
     */
    const loadFiles = async(files: File[]): Promise<IObject3D[]> => {
        const before = new Set(engine.modelObjects())
        for (const f of files) {
            await viewer.load<IObject3D>(f, {autoCenter: false, autoScale: false})
            file.addRecent(f)
        }
        const loaded = engine.modelObjects().filter(o => !before.has(o))
        if (loaded.length) engine.picking.setSelectedObject(loaded[loaded.length - 1], false, false)
        return loaded
    }

    /** Is an object in the scene (its parents reach the scene)? */
    const inScene = (o: IObject3D) => {
        let p: IObject3D | null = o
        while (p && p !== viewer.scene) p = p.parent as IObject3D | null
        return !!p
    }

    /** The scene as a .glb, with the modelling topology extension, viewer config optional. */
    const exportGlb = async(viewerConfig: boolean) => {
        if (engine.mode === 'edit') engine.meshEdit.applyToObject()
        return viewer.exportScene({binary: true, viewerConfig, preserveUUIDs: true})
    }

    const exportName = (ext: string) => `${file.name ?? 'model'}.${ext}`

    const saveAs = async(name: string | null): Promise<OperatorResult> => {
        let n = name
        if (!n) {
            const answer = await viewer.dialog.prompt('Save as (file name, without .glb)', file.name ?? 'model', true)
            if (answer === null) return {ok: true}
            n = baseName(answer.trim()) || 'model'
        }
        const blob = await exportGlb(true)
        if (!blob) return {ok: false, error: 'Export failed: the scene could not be written as glTF. Check the browser console for the cause.'}
        file.setName(n)
        downloadBlob(blob, `${n}.glb`)
        file.markClean()
        engine.message('info', `Saved ${n}.glb to your downloads. It re-opens editable with File > Open${engine.keyHint('file.open')}.`)
        return {ok: true, data: {name: `${n}.glb`, size: blob.size}}
    }

    const ops: OperatorDescriptor[] = [
        {
            id: 'file.new',
            label: 'New',
            description: 'Clear the scene and start again.',
            icon: 'document',
            category: 'File',
            async exec() {
                if (!await confirmDiscard('Start a new scene')) return {ok: true}
                clearScene()
                file.setName(null)
                file.markClean()
                return {ok: true}
            },
        },
        {
            id: 'file.open',
            label: 'Open…',
            description: 'Open a glTF/GLB, OBJ, FBX, STL or other model file, replacing the scene. Files saved here re-open editable.',
            icon: 'folder-open',
            category: 'File',
            async exec(_ctx, props) {
                const picked = props?.files as File[] | undefined
                if (!picked && !await confirmDiscard('Open another file')) return {ok: true}
                const files = picked ?? await uploadFile(true, false, OPEN_ACCEPT)
                if (!files.length) return {ok: true}
                clearScene()
                const loaded = await loadFiles(files)
                if (!loaded.length) {
                    file.setName(null)
                    file.markClean()
                    return {ok: false, error: `Nothing could be loaded from ${files.map(f => f.name).join(', ')}. Choose a .glb, .gltf, .obj, .fbx or .stl file.`}
                }
                file.setName(baseName(files[0].name))
                file.markClean()
                return {ok: true, data: {objects: loaded.map(o => o.name)}}
            },
        },
        {
            id: 'file.open_recent',
            label: 'Open Recent',
            description: 'A file opened before. Browsers cannot re-open a file on their own: this opens the file picker so you can choose it again.',
            icon: 'history',
            category: 'File',
            hidden: true,
            props: {type: 'object', properties: {name: {type: 'string', description: 'The recent file to open again.'}}},
            poll: () => file.recent.length > 0 || 'No files have been opened yet',
            async exec(_ctx, props) {
                const name = props?.name as string | undefined
                if (name) engine.message('info', `Choose ${name} in the file dialog: a web page cannot re-open a file without asking.`)
                return engine.run('file.open')
            },
        },
        {
            id: 'file.import',
            label: 'Import…',
            description: 'Add a model file to the scene, keeping what is there.',
            icon: 'import',
            category: 'File',
            async exec() {
                const files = await uploadFile(true, false, OPEN_ACCEPT)
                if (!files.length) return {ok: true}
                const loaded = await loadFiles(files)
                if (!loaded.length) return {ok: false, error: `Nothing could be loaded from ${files.map(f => f.name).join(', ')}. Choose a .glb, .gltf, .obj, .fbx or .stl file.`}
                file.markDirty()
                engine.message('info', `Imported ${loaded.map(o => o.name).join(', ')}. Double-click a mesh${engine.keyHint('object.enter_edit', 'object').replace('(', '(or ')} to edit it.`)
                return {ok: true, data: {objects: loaded.map(o => o.name)}}
            },
        },
        {
            id: 'file.save',
            label: 'Save',
            description: 'Download the scene as a .glb that re-opens editable (topology and modifiers included).',
            icon: 'floppy-disk',
            category: 'File',
            poll: () => engine.modelObjects().length > 0 || `Nothing to save yet: add a shape first (Add menu${engine.keyHint('add.menu')})`,
            exec: () => saveAs(file.name),
        },
        {
            id: 'file.save_as',
            label: 'Save As…',
            description: 'Download the scene as a .glb under a new name.',
            icon: 'floppy-disk',
            category: 'File',
            poll: () => engine.modelObjects().length > 0 || `Nothing to save yet: add a shape first (Add menu${engine.keyHint('add.menu')})`,
            exec: () => saveAs(null),
        },
        {
            id: 'file.export_glb',
            label: 'Export GLB',
            description: 'Download the model as a plain .glb for other apps, without viewer settings.',
            icon: 'export',
            category: 'File',
            poll: hasObjects,
            async exec() {
                const blob = await exportGlb(false)
                if (!blob) return {ok: false, error: 'Export failed: the scene could not be written as glTF. Check the browser console for the cause.'}
                downloadBlob(blob, exportName('glb'))
                return {ok: true, data: {name: exportName('glb'), size: blob.size}}
            },
        },
        {
            id: 'file.export_obj',
            label: 'Export OBJ',
            description: 'Download the model as Wavefront .obj (triangles; topology is not kept).',
            icon: 'export',
            category: 'File',
            poll: hasObjects,
            async exec() {
                if (engine.mode === 'edit') engine.meshEdit.applyToObject()
                const text = new OBJExporter().parse(viewer.scene.modelRoot as never)
                downloadBlob(new Blob([text], {type: 'text/plain'}), exportName('obj'))
                return {ok: true, data: {name: exportName('obj'), size: text.length}}
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
                downloadBlob(new Blob([data.buffer as ArrayBuffer], {type: 'model/stl'}), exportName('stl'))
                return {ok: true, data: {name: exportName('stl'), size: data.byteLength}}
            },
        },
    ]
    for (const op of ops) engine.operators.register(op)

    // Drag-and-drop: `DropzonePlugin` (on by default in the editor) imports what is dropped; the
    // engine records the files, selects what arrived and says what to do next.
    const onDrop = (e: {files: Map<string, File>, assets?: (unknown | undefined)[]}) => {
        for (const f of e.files.values()) file.addRecent(f)
        const objects = (e.assets ?? []).filter((a): a is IObject3D => !!(a as IObject3D)?.isObject3D)
        if (objects.length) {
            // A flattened glTF root is not in the scene itself; its objects were appended to the model root.
            const last = objects[objects.length - 1]
            const target = inScene(last) ? last : engine.modelObjects().at(-1)
            if (target) engine.picking.setSelectedObject(target, false, false)
            file.markDirty()
            engine.message('info', `Opened ${[...e.files.keys()].join(', ')}. Double-click a mesh${engine.keyHint('object.enter_edit', 'object').replace('(', '(or ')} to edit it.`)
        } else if (e.files.size) {
            engine.message('warning', `Nothing could be loaded from ${[...e.files.keys()].join(', ')}. Drop a .glb, .gltf, .obj, .fbx or .stl file.`)
        }
        engine.dispatchEvent({type: 'sceneChanged'})
    }
    viewer.forPlugin(DropzonePlugin,
        (dropzone: DropzonePlugin) => dropzone.addEventListener('drop', onDrop),
        (dropzone: DropzonePlugin) => dropzone.removeEventListener('drop', onDrop),
        engine)
}
