import type {$Env} from 'teenybase/worker'

export type CloudEnv = $Env & {Bindings: CloudflareBindings}

/** sha256 of a string, lowercase hex */
export async function sha256Hex(s: string | ArrayBuffer): Promise<string> {
    const data = typeof s === 'string' ? new TextEncoder().encode(s) : s
    return hex(await crypto.subtle.digest('SHA-256', data))
}

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

/** URL-safe random string of `bytes` random bytes */
export function randomCode(bytes = 24): string {
    const b = crypto.getRandomValues(new Uint8Array(bytes))
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The origin files are served from: FILES_HOST, or `<api origin>/_files` when it is not set (local dev). */
export function filesOrigin(env: CloudflareBindings, apiOrigin: string): string {
    return env.FILES_HOST ? `https://${env.FILES_HOST}` : `${apiOrigin}/_files`
}
