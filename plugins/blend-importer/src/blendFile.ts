/**
 * The parsed Blender file: the raw `js.blend` FILE object (see `src/js-blend/parser/parser.js` for
 * the full DNA tree), plus the three.js root built from it as `scene`. Notable fields are typed here;
 * everything else is untyped under `[k: string]`.
 *
 * `TScene` is the root's type: threepipe's `Object3D` from `BlendLoadPlugin`, three's `Group` from
 * `BlendLoader`.
 */
export interface BlendFileData<TScene = unknown> {
    /** Three.js root constructed from the file's Blender objects. */
    scene: TScene
    /**
     * Embedded preview thumbnail (RGBA8, packed one pixel per `Uint32`). Absent on very old saves
     * or files saved with preview disabled. Typical size 128×128.
     * Convert via `<canvas>.createImageData` for display.
     */
    thumbnail?: {width: number, height: number, data: Uint32Array}
    /** Parsed Blender objects keyed by SDNA struct type, e.g. `objects.Object`, `objects.Mesh`, `objects.Material`. */
    objects: Record<string, any[]>
    /** SDNA template — Blender's runtime struct definitions parsed out of the DNA1 block. */
    template: any
    /** Memory-address-keyed lookup of every parsed block. */
    memory_lookup: Record<string, any>
    /** Raw `ArrayBuffer` of the decompressed `.blend` payload. */
    AB: ArrayBuffer
    [k: string]: any
}
