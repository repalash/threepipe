/**
 * Parity fixture files: a fixture `x.json` / `x.bin` is stored as is when small and gzipped as `x.json.gz` /
 * `x.bin.gz` above {@link GZIP_ABOVE} bytes (2 KiB), to keep the repository light. Readers take either; writers pick by size and
 * remove the other variant. `porting/blender/vendor_results.py` follows the same rule.
 */
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {gunzipSync, gzipSync} from 'node:zlib'

/** Files larger than this are written gzipped. */
export const GZIP_ABOVE = 2 * 1024

/** Whether `path` or `path.gz` exists. */
export function fixtureExists(path: string): boolean {
    return existsSync(path) || existsSync(`${path}.gz`)
}

/** The bytes of `path`, or of `path.gz` unzipped; undefined when neither exists. */
export function readFixture(path: string): Buffer | undefined {
    if (existsSync(path)) return readFileSync(path)
    if (existsSync(`${path}.gz`)) return gunzipSync(readFileSync(`${path}.gz`))
    return undefined
}

export function readFixtureText(path: string): string | undefined {
    return readFixture(path)?.toString('utf8')
}

/** Parsed JSON of `path` (or `path.gz`); throws when missing. */
export function readFixtureJSON<T>(path: string): T {
    const text = readFixtureText(path)
    if (text === undefined) throw new Error(`fixture ${path}(.gz) does not exist`)
    return JSON.parse(text) as T
}

/** Write a fixture plain or gzipped by size, removing the other variant. */
export function writeFixture(path: string, data: string | Buffer): void {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    // Unchanged content keeps its file (gzip writers differ in header bytes).
    const old = readFixture(path)
    if (old && old.equals(bytes) && existsSync(bytes.length > GZIP_ABOVE ? `${path}.gz` : path)) return
    if (bytes.length > GZIP_ABOVE) {
        writeFileSync(`${path}.gz`, gzipSync(bytes, {level: 9}))
        rmSync(path, {force: true})
    } else {
        writeFileSync(path, bytes)
        rmSync(`${path}.gz`, {force: true})
    }
}

/** A file name without its `.gz`. */
export const withoutGz = (name: string) => name.replace(/\.gz$/, '')
