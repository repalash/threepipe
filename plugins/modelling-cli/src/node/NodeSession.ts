/**
 * A modelling session in Node: a real `ThreeViewer` on the polyfill, with `ModellingPlugin` loaded, and no
 * browser. Every command that does not draw runs here exactly as it runs in a page, through the same
 * `ModellingPlugin.run`, so a transcript replayed here and one replayed in the editor take the same path.
 */

import './polyfill'
import {DummyRenderManager} from './polyfill'
import {CameraViewPlugin, ThreeViewer} from 'threepipe'
import {Command, CommandResult, ModellingPlugin} from '@threepipe/plugin-modelling'

export interface NodeSessionOptions {
    /** Fix the document id; everything the document creates derives its UUID from it. */
    documentId?: string
    /** Called for `export {path}` / `look {path}` writes. Default: `node:fs`. */
    fileSink?: (path: string, data: Uint8Array) => Promise<void>
}

/** The ops that need pixels. A Node session refuses them with a pointer to a browser session. */
export const RENDER_OPS = new Set(['look', 'capture'])

export class NodeSession {
    readonly kind = 'node' as const
    readonly viewer: ThreeViewer
    readonly modelling: ModellingPlugin

    constructor(options: NodeSessionOptions = {}) {
        const canvas = document.createElement('canvas') as unknown as HTMLCanvasElement
        document.body.appendChild(canvas as never)
        this.viewer = new ThreeViewer({
            canvas,
            rmClass: DummyRenderManager,
            tonemap: false,
            msaa: false,
            dropzone: false,
        } as never)
        this.viewer.getOrAddPluginSync(CameraViewPlugin)
        this.modelling = this.viewer.addPluginSync(new ModellingPlugin({documentId: options.documentId}))
        if (options.fileSink) this.modelling.fileSink = options.fileSink
    }

    get documentId(): string {
        return this.modelling.document.documentId
    }

    run(command: Command): Promise<CommandResult> {
        return this.modelling.run(command)
    }

    /**
     * Load a GLB written by `export`. Objects carrying the `THREEPIPE_mesh_topology` extension come back as
     * editable document objects with their exact n-gon topology and modifier stacks.
     */
    async load(bytes: Uint8Array, name = 'document.glb'): Promise<string[]> {
        const file = new File([bytes as BlobPart], name, {type: 'model/gltf-binary'})
        const before = new Set(this.modelling.document.entries.map(e => e.id))
        await this.viewer.load(file as never, {autoScale: false, autoCenter: false} as never)
        return this.modelling.document.entries.filter(e => !before.has(e.id)).map(e => e.name)
    }

    /** The scene as a GLB, with editable topology in `THREEPIPE_mesh_topology`. */
    async exportGlb(): Promise<Uint8Array> {
        const blob = await this.viewer.exportScene({exportExt: 'glb'})
        if (!blob) throw new Error('the exporter returned nothing')
        return new Uint8Array(await blob.arrayBuffer())
    }

    dispose(): void {
        this.viewer.dispose()
    }
}
