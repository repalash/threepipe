/**
 * `BLI_strcasecmp_natural` (`blenlib/intern/string.cc:735`) with `left_number_strcmp` (:686), on UTF-8 bytes as
 * C does (Blender builds with `-funsigned-char`; `isdigit`/`tolower` are the C locale's, ASCII only).
 */

const encoder = new TextEncoder()

const isDigit = (c: number) => c >= 48 && c <= 57
const toLower = (c: number) => (c >= 65 && c <= 90 ? c + 32 : c)

/** `strncmp` / `strcmp` on unsigned bytes, as a sign. */
function byteCompare(a: Uint8Array, ai: number, b: Uint8Array, bi: number, n: number): number {
    for (let k = 0; k < n; k++) {
        const x = a[ai + k] ?? 0, y = b[bi + k] ?? 0
        if (x !== y) return x < y ? -1 : 1
        if (x === 0) return 0
    }
    return 0
}

function leftNumberStrcmp(s1: Uint8Array, i1: number, s2: Uint8Array, i2: number, tie: {v: number}): number {
    let p1 = i1, p2 = i2
    let numzero1 = 0, numzero2 = 0
    while (s1[p1] === 48) { numzero1++; p1++ }
    while (s2[p2] === 48) { numzero2++; p2++ }
    let numdigit = 0
    for (;; numdigit++) {
        const d1 = isDigit(s1[p1 + numdigit] ?? 0), d2 = isDigit(s2[p2 + numdigit] ?? 0)
        if (d1 && d2) continue
        if (d1) return 1
        if (d2) return -1
        break
    }
    if (numdigit > 0) {
        const compare = byteCompare(s1, p1, s2, p2, numdigit)
        if (compare !== 0) return compare
    }
    if (tie.v === 0) {
        if (numzero1 > numzero2) tie.v = 1
        else if (numzero1 < numzero2) tie.v = -1
    }
    return 0
}

export function strcasecmpNatural(a: string, b: string): number {
    const s1 = encoder.encode(a), s2 = encoder.encode(b)
    let d1 = 0, d2 = 0
    const tie = {v: 0}
    for (;;) {
        if (isDigit(s1[d1] ?? 0) && isDigit(s2[d2] ?? 0)) {
            const numcompare = leftNumberStrcmp(s1, d1, s2, d2, tie)
            if (numcompare !== 0) return numcompare
            d1++
            while (isDigit(s1[d1] ?? 0)) d1++
            d2++
            while (isDigit(s2[d2] ?? 0)) d2++
        }
        const c1raw = s1[d1] ?? 0, c2raw = s2[d2] ?? 0
        if (c1raw === 0 || c2raw === 0) break
        const c1 = toLower(c1raw), c2 = toLower(c2raw)
        if (c1 !== c2) {
            if (c1 === 46) return -1
            if (c2 === 46) return 1
            return c1 < c2 ? -1 : 1
        }
        d1++
        d2++
    }
    if (tie.v) return tie.v
    return byteCompare(s1, 0, s2, 0, Math.max(s1.length, s2.length) + 1)
}
