// Hashing, constant-time comparison and the origin allowlist, shared by the routes.
import type {Env} from '../env.ts'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

/** Compares two strings in time that does not depend on where they differ. */
export function timingSafeEqual(a: string, b: string): boolean {
    let diff = a.length ^ b.length
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(1, b.length))
    return diff === 0
}

export type EnvTag = 'prod' | 'staging' | 'dev' | 'local' | 'other'

function isLocal(origin: string): boolean {
    try {
        const h = new URL(origin).hostname
        return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost')
    } catch {
        return false
    }
}

/** The env tag of an Origin (ORIGINS: 'https://threepipe.org=prod,…'), or null when that origin may not send. */
export function envOf(env: Env, origin: string | null): EnvTag | null {
    if (!origin) return 'other' // not a browser; the route's own gate still applies
    for (const pair of String(env.ORIGINS || '').split(',')) {
        const [o, t] = pair.trim().split('=')
        if (o === origin && ['prod', 'staging', 'dev'].includes(t)) return t as EnvTag
    }
    return isLocal(origin) ? 'local' : null
}
