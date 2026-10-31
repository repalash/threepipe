import {AssetExporterPlugin, AViewerPluginSync, ImportResult, ThreeViewer} from 'threepipe'
import {UiObjectConfig} from 'uiconfig.js'
import {formatBytes, GLTFSummary, parseGLTFBuffer, summarizeGLTF} from './gltf-summary'

/**
 * glTF Contents Plugin
 *
 * Shows what a glTF file holds, in its UI folder (`glTF Contents`):
 * - **The export**: "Check the export" makes the file that {@link AssetExporterPlugin} would download (with its export
 *   options: the models of the scene, and the viewer config with the settings of each plugin, like the notes) and lists
 *   what is in it. It does not download it.
 * - **Loaded files**: each glTF or GLB file that is loaded (dropped, picked or from a URL), read again from the file.
 *
 * For each: the file, JSON and binary sizes (and the part in images), the generator, the counts (nodes, meshes,
 * triangles, vertices, materials, textures, animations, cameras, lights), the viewer config (each plugin with the size
 * of its settings, and the resources), and lists of the meshes, materials, images, animations and extensions. The
 * summary itself is {@link summarizeGLTF}.
 *
 * @category Plugins
 */
export class GLTFContentsPlugin extends AViewerPluginSync {
    static readonly PluginType = 'GLTFContentsPlugin'
    /** The most loaded files kept (the oldest goes first) */
    static MaxFiles = 10
    /** The most rows in a list (meshes, materials, ...); the rest are counted in one row */
    static MaxRows = 100
    enabled = true
    // what a file holds is not a setting of the scene
    toJSON: any = undefined

    /** The summary of the last export check, shown first */
    exportSummary?: GLTFSummary
    /** The summaries of the loaded glTF files, newest first */
    readonly files: GLTFSummary[] = []
    /** The summary shown: `export`, or the index in {@link files} as a string (`'0'` is the newest file) */
    shown = '0'
    /** The state of the export check, or the error of the last one */
    status = ''

    onAdded(viewer: ThreeViewer) {
        super.onAdded(viewer)
        viewer.assetManager.addEventListener('loadAsset', this._onLoad)
    }

    onRemove(viewer: ThreeViewer) {
        viewer.assetManager.removeEventListener('loadAsset', this._onLoad)
        super.onRemove(viewer)
    }

    /**
     * Makes the file that {@link AssetExporterPlugin} would download, with its export options, and shows what it holds.
     * Returns the summary, or undefined (no exporter, or not a glTF export).
     */
    async checkExport(): Promise<GLTFSummary | undefined> {
        const exporter = this._viewer?.getPlugin(AssetExporterPlugin)
        if (!exporter) {
            this._setStatus('Add the AssetExporterPlugin to check the export')
            return undefined
        }
        this._setStatus('Exporting…')
        try {
            const blob = await exporter.exportScene()
            if (!blob || blob.ext !== 'glb' && blob.ext !== 'gltf') {
                this._setStatus(blob ? 'Not a glTF export: .' + blob.ext : 'Nothing to export')
                return undefined
            }
            const buffer = await blob.arrayBuffer()
            this.exportSummary = summarizeGLTF('Export: ' + (exporter.exportOptions.name || 'scene') + '.' + blob.ext, parseGLTFBuffer(buffer), buffer.byteLength)
            this.shown = 'export'
            this._setStatus('')
            return this.exportSummary
        } catch (e) {
            this._viewer?.console.error('GLTFContentsPlugin: the export check failed', e)
            this._setStatus('The export failed: ' + ((e as Error)?.message ?? e))
            return undefined
        }
    }

    /** The summary shown in the UI */
    get shownSummary(): GLTFSummary | undefined {
        return this.shown === 'export' ? this.exportSummary : this.files[Number(this.shown)]
    }

    private _setStatus(status: string) {
        this.status = status
        this.uiConfig.uiRefresh?.(true, 'postFrame')
    }

    /** A loaded glTF or GLB: read the file again (the loader does not keep its JSON) */
    private _onLoad = async({data}: {data: ImportResult}) => {
        if (!data || data.assetType !== 'model') return
        const blob: File | Blob | undefined = (data as any).__rootBlob
        const path: string = blob ? (blob as any).filePath || (blob as File).name || '' : (data as any).__rootPath || data.userData?.rootPath || ''
        const ext = path.split('?')[0].split('.').pop()?.toLowerCase()
        if (ext !== 'glb' && ext !== 'gltf') return
        try {
            const buffer = blob ? await blob.arrayBuffer() : await (await fetch(path)).arrayBuffer()
            const name = path.split('?')[0].split('/').pop() || path
            this.files.unshift(summarizeGLTF(name, parseGLTFBuffer(buffer), buffer.byteLength))
            this.files.length = Math.min(this.files.length, GLTFContentsPlugin.MaxFiles)
            if (this.shown !== 'export' || !this.exportSummary) this.shown = '0'
            this.uiConfig.uiRefresh?.(true, 'postFrame')
        } catch (e) {
            this._viewer?.console.warn('GLTFContentsPlugin: could not read', path, e)
        }
    }

    uiConfig: UiObjectConfig = {
        type: 'folder',
        label: 'glTF Contents',
        children: [
            {type: 'button', label: 'Check the export', value: async() => this.checkExport()},
            () => this._summaryUi(),
        ],
    }

    /** The rows of the summary shown, made again on each refresh (with the Show dropdown, whose options change) */
    private _summaryUi(): UiObjectConfig[] {
        const options = [
            ...this.exportSummary ? [{label: this.exportSummary.name, value: 'export'}] : [],
            ...this.files.map((f, i) => ({label: f.name, value: String(i)})),
        ]
        const show: UiObjectConfig[] = options.length > 1 ? [{
            type: 'dropdown', label: 'Show', property: [this, 'shown'], children: options,
            onChange: () => this.uiConfig.uiRefresh?.(true, 'postFrame'),
        }] : []
        const s = this.shownSummary
        if (this.status || !s) return [...show, {type: 'button', label: this.status || 'Check the export, or load a glTF file', readOnly: true}]
        const c = s.counts
        const n = (v: number) => v.toLocaleString('en-US')
        const ui: UiObjectConfig[] = [
            ...show,
            row('File', s.name),
            row('Size', formatBytes(s.fileBytes)),
            row('JSON', formatBytes(s.jsonBytes)),
            row('Binary', formatBytes(s.binBytes)),
            row('Images', formatBytes(s.imageBytes) + (s.binBytes ? ' (' + Math.round(s.imageBytes / s.binBytes * 100) + '% of the binary)' : '')),
        ]
        if (s.generator) ui.push(row('Generator', s.generator + (s.version ? ' · glTF ' + s.version : '')))
        ui.push(folder('Scene', [
            row('Nodes', n(c.nodes) + (c.scenes > 1 ? ' in ' + c.scenes + ' scenes' : '')),
            row('Meshes', n(c.meshes) + ' (' + n(c.primitives) + ' primitives)'),
            row('Triangles', n(c.triangles)),
            row('Vertices', n(c.vertices)),
            row('Materials', n(c.materials)),
            row('Textures', n(c.textures) + ' (' + n(c.images) + ' images)'),
            row('Animations', n(c.animations)),
            row('Cameras', n(c.cameras)),
            row('Lights', n(c.lights)),
            ...c.skins ? [row('Skins', n(c.skins))] : [],
        ], true))
        const vc = s.viewerConfig
        ui.push(vc ? folder('Viewer config (' + formatBytes(vc.bytes) + ')', [
            // the largest first
            ...[...vc.plugins].sort((a, b) => b.bytes - a.bytes).map(p => row(p.type, formatBytes(p.bytes))),
            ...Object.entries(vc.resources).map(([k, v]) => row('Resources: ' + k, n(v))),
        ], true) : row('Viewer config', 'none'))
        const list = <T>(title: string, items: T[], toRow: (it: T) => UiObjectConfig) => {
            if (!items.length) return
            const max = GLTFContentsPlugin.MaxRows
            ui.push(folder(title + ' (' + items.length + ')', [
                ...items.slice(0, max).map(toRow),
                ...items.length > max ? [row('…', items.length - max + ' more')] : [],
            ]))
        }
        list('Meshes', s.meshes, m => row(m.name, n(m.triangles) + ' tris · ' + n(m.vertices) + ' verts' + (m.primitives > 1 ? ' · ' + m.primitives + ' prims' : '')))
        list('Materials', s.materials, m => row(m.name, m.extensions.join(', ') || '—'))
        list('Images', s.images, im => row(im.name, [im.mimeType, formatBytes(im.bytes)].filter(Boolean).join(' · ')))
        list('Animations', s.animations, a => row(a.name, a.channels + ' channels' + (a.duration !== undefined ? ' · ' + a.duration.toFixed(2) + ' s' : '')))
        list('Extensions', s.extensionsUsed, e => row(e, s.extensionsRequired.includes(e) ? 'required' : 'used'))
        return ui
    }
}

/** A read-only row: a label and a text */
function row(label: string, value: string): UiObjectConfig {
    return {type: 'input', label, property: [{value}, 'value'], readOnly: true}
}

function folder(label: string, children: UiObjectConfig[], expanded = false): UiObjectConfig {
    return {type: 'folder', label, children, expanded}
}
