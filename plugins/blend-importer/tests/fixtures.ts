/**
 * Locating and parsing the real `.blend` files the tests run against.
 *
 * These tests deliberately do not build synthetic datablocks: the whole point of the importer is that
 * it reads what Blender actually wrote, and a hand-built stand-in would encode this file's
 * understanding of the DNA rather than test it. The `.blend` corpus is tens of megabytes so it lives
 * outside the repo - see `tests/README.md` for where to put it.
 */

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {decompressBlend} from '../src/decompress'
import {parseBlend} from '../src/js-blend/main.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The directory holding the `.blend` corpus, or null when it is not available.
 *
 * `BLEND_FIXTURES_DIR` wins; otherwise the first `tmp/blend-fixtures` found walking up from this
 * package, which finds the main checkout's copy from inside a worktree too.
 */
export function fixturesDir(): string | null {
    const env = process.env.BLEND_FIXTURES_DIR
    if (env) return existsSync(env) ? resolve(env) : null
    let dir = here
    for (let i = 0; i < 8; i++) {
        const candidate = join(dir, 'tmp', 'blend-fixtures')
        if (existsSync(candidate)) return candidate
        const up = dirname(dir)
        if (up === dir) break
        dir = up
    }
    return null
}

/** Absolute path of one fixture, or null when the corpus (or that file) is missing. */
export function fixturePath(name: string): string | null {
    const dir = fixturesDir()
    if (!dir) return null
    const p = join(dir, name)
    return existsSync(p) ? p : null
}

/** Every `.blend` in the corpus under `maxBytes`, sorted, as absolute paths. */
export function listFixtures(maxBytes = 12 * 1024 * 1024): string[] {
    const dir = fixturesDir()
    if (!dir) return []
    const out: string[] = []
    for (const f of readdirSync(dir).sort()) {
        if (!f.endsWith('.blend')) continue
        const p = join(dir, f)
        try {
            if (statSync(p).size <= maxBytes) out.push(p)
        } catch {
            // unreadable entry (a directory named *.blend, a broken link) - skip it
        }
    }
    return out
}

/** Parse a `.blend` through the plugin's own decompressor and parser, exactly as the loader does. */
export async function loadBlend(path: string): Promise<any> {
    const bytes = new Uint8Array(readFileSync(path))
    const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer as ArrayBuffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return parseBlend(decompressBlend(buf))
}

/** Datablock names carry a two-character type prefix in the DNA ("MECube"). */
export function meshName(mesh: any): string {
    const n = mesh && mesh.id && mesh.id.name
    return typeof n === 'string' ? n : ''
}

/** One named mesh datablock out of a parsed file. Throws rather than silently testing the wrong mesh. */
export function pickMesh(blend: any, name?: string): any {
    const meshes: any[] = blend.objects.Mesh ?? []
    if (!meshes.length) throw new Error('blend file contains no Mesh datablocks')
    if (name === undefined) {
        if (meshes.length !== 1) throw new Error(`blend file has ${meshes.length} meshes; pass a name`)
        return meshes[0]
    }
    const found = meshes.filter(m => meshName(m) === name)
    if (found.length !== 1) throw new Error(`mesh '${name}' matched ${found.length} datablocks`)
    return found[0]
}

/** Which of the three on-disk mesh layouts a datablock uses. */
export function meshLayout(mesh: any): 'mpoly' | 'attribute_storage' | 'customdata' {
    if (mesh.mpoly) return 'mpoly'
    if (mesh.attribute_storage) return 'attribute_storage'
    return 'customdata'
}
