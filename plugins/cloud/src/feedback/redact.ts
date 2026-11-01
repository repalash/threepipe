/**
 * The client's redaction of a report, before anything leaves the page. The worker
 * (`services/cloud/src/reports.ts`) applies the same rules again, so a page that logs something new, or a
 * client of another version, cannot send what these rules remove.
 *
 * - Every string but the person's own text: URLs lose their query and fragment, token shapes go, the user
 *   name in a home-folder path goes (`/Users/<user>/…`), and emails other than the sender's own go.
 * - The person's own text loses token shapes only: its words, links and emails are what they chose to send.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** File extensions that look like a top-level domain after an '@' (logo@2x.png). */
const NOT_A_TLD = /^(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|exr|hdr|ktx2?|glb|gltf|3dm|obj|fbx|stl|usdz|blend|ply|js|mjs|ts|css|json|html?|bin|wasm|zip|mp4|mov|webm|pdf|txt)$/i

function redactUrl(u: string): string {
    // A stack frame's ':line:col' comes after the query ('app.js?v=3:12:7'): it stays.
    const pos = /(?::\d+){1,2}$/.exec(u)?.[0] ?? ''
    if (pos) return redactUrl(u.slice(0, -pos.length)) + pos
    try {
        const url = new URL(u)
        return url.origin === 'null' ? url.protocol + '//' + url.pathname.replace(/^\/\//, '') : url.origin + url.pathname
    } catch {
        return u.replace(/[?#].*$/, '')
    }
}

/** Secret shapes: JWTs, Bearer/Basic credentials, `…token=…` pairs, and the known key formats. */
export function redactTokens(s: string): string {
    return s
        .replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '<token>')
        .replace(/\b(bearer|basic)\s+[\w.~+/-]{8,}=*/gi, (_m, scheme) => `${scheme} <token>`)
        .replace(/([\w-]*(?:token|secret|password|passwd|session|cookie|api[_-]?key|auth|credential)s?)(["']?\s*[:=]\s*["']?)[^\s"',;&]{8,}/gi, '$1$2<token>')
        .replace(/\b(?:sk|rk|pk)_(?:live|test)_\w{8,}|\bwhsec_\w{16,}|\bre_\w{16,}|\bgh[pousr]_\w{20,}|\bgithub_pat_\w{20,}|\bglpat-[\w-]{20,}|\bxox[abprs]-[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[\w-]{35}|\bsk-[\w-]{32,}/g, '<token>')
}

/** The user name in a home-folder path: /Users/jane/…, /home/jane/…, C:\Users\jane\… (also inside file:// URLs). */
function redactHomePaths(s: string): string {
    return s
        .replace(/(\/(?:Users|home)\/)(?!<user>)[^/\s"'<>:]+/g, '$1<user>')
        .replace(/(\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)(?!<user>)[^\\/\s"'<>:]+/gi, '$1<user>')
}

/** Every string of a report but the person's own text. `keep` is the sender's own email, which stays. */
export function redact(s: string, keep?: string): string {
    const own = keep?.trim().toLowerCase()
    return redactTokens(redactHomePaths(s.replace(/\b(?:https?|file):\/\/[^\s"'<>)\]]+/gi, redactUrl)))
        .replace(/\b[0-9a-f]{32,}\b/gi, '<token>')
        .replace(/\b[\w-]{40,}\b/g, m => UUID.test(m) || !(/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) ? m : '<token>')
        .replace(/[^\s@<>()",;:'`]{1,64}@[a-z0-9.-]{1,190}\.([a-z]{2,24})\b/gi, (m, tld) =>
            NOT_A_TLD.test(tld) ? m : own && m.toLowerCase() === own ? m : '<email>')
}

/** A property whose name ends in a secret word (access_token, password, x-api-key, authorization, …): its value goes. Same list as the worker. */
const SECRET_KEY = /(?:token|secret|password|passwd|session|cookie|api[_-]?key|auth|authorization|credential)s?$/i

/**
 * Every string inside a JSON value, keys too, redacted, and the value of a secret-named property replaced (when it is a
 * string or a number). Deeper than `maxDepth` levels (default 4, as the worker) becomes null.
 */
export function redactDeep(v: unknown, keep?: string, depth = 0, maxDepth = 4): unknown {
    if (typeof v === 'string') return redact(v, keep)
    if (depth > maxDepth) return null
    if (Array.isArray(v)) return v.map(x => redactDeep(x, keep, depth + 1, maxDepth))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k.slice(0, 64), keep),
        SECRET_KEY.test(k) && (typeof x === 'string' && x || typeof x === 'number') ? '<token>' : redactDeep(x, keep, depth + 1, maxDepth)]))
    return typeof v === 'number' || typeof v === 'boolean' || v === null ? v : null
}
