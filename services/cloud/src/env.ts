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

/** The bucket name in the `files` registry for the cloud R2 bucket (samples and e2e buckets come later). */
export const BUCKET = 'cloud'

/** Relative path segments without empty, '.', '..' or dotfile parts. */
export function cleanSegments(path: string): string[] | null {
    if (!path || path.length > 512) return null
    const segs = path.split('/')
    if (segs.some(s => !s || s === '.' || s === '..' || s.startsWith('.') || !/^[\w\-.()+@ ]+$/.test(s))) return null
    return segs
}

/**
 * `[from, to)` of the paths that start with `prefix`, for `path >= ? AND path < ?`. Unlike LIKE, a range uses the
 * (bucket, path) index, so it reads only the matching rows.
 */
export function prefixRange(prefix: string): [string, string] {
    return [prefix, prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)]
}
