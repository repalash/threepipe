import type {$Env} from 'teenybase/worker'
import type {CloudUser} from './auth'

export type CloudEnv = $Env<CloudflareBindings, {cloudUser?: CloudUser}>

/** sha256 of a string, lowercase hex */
export async function sha256Hex(s: string | ArrayBuffer): Promise<string> {
    const data = typeof s === 'string' ? new TextEncoder().encode(s) : s
    return hex(await crypto.subtle.digest('SHA-256', data))
}

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export const base64url = (buf: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** URL-safe random string of `bytes` random bytes */
export function randomCode(bytes = 24): string {
    return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** The origin files are served from: FILES_HOST, or `<api origin>/_files` when it is not set (local dev). */
export function filesOrigin(env: CloudflareBindings, apiOrigin: string): string {
    return env.FILES_HOST ? `https://${env.FILES_HOST}` : `${apiOrigin}/_files`
}

/** The bucket name in the `files` registry for the cloud R2 bucket (src/buckets.ts registers `samples` and `e2e`). */
export const BUCKET = 'cloud'

/**
 * Relative path segments, any language, NFC-normalized (macOS sends decomposed accents: `café` would be two keys).
 * Not allowed: empty, `.`, `..` and dotfile parts; control and invisible format characters (a right-to-left override
 * makes `exe.png` read `gnp.exe`); `\ ? # %`, which break URLs. R2 takes keys up to 1024 bytes; a part up to 255.
 */
export function cleanSegments(path: string): string[] | null {
    if (!path) return null
    path = path.normalize('NFC')
    if (new TextEncoder().encode(path).length > 1000) return null
    const segs = path.split('/')
    if (segs.some(s => !s || s.startsWith('.') || new TextEncoder().encode(s).length > 255 || /[\p{Cc}\p{Cf}\\?#%]/u.test(s))) return null
    return segs
}

/** The public URL of a key: each part percent-encoded (spaces, other languages). */
export const keyUrl = (origin: string, key: string) => `${origin}/${key.split('/').map(encodeURIComponent).join('/')}`

/**
 * `[from, to)` of the paths that start with `prefix`, for `path >= ? AND path < ?`. Unlike LIKE, a range uses the
 * (bucket, path) index, so it reads only the matching rows.
 */
export function prefixRange(prefix: string): [string, string] {
    return [prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)]
}
