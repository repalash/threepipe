/**
 * Float32-exact ports of the C geometry helpers that triangulation depends on. Blender computes these
 * in `float` with `-ffp-contract=off` (`build_files/cmake/platform/platform_unix.cmake:898`), and the
 * results feed sign tests and diagonal choices, so each operation is rounded to float32 here
 * (`Math.fround`), unlike the double-precision helpers in `../math/geom.ts`.
 */

const f = Math.fround

export type F3 = [number, number, number]

/** `dot_v3v3` (`blenlib/intern/math_vector_inline.cc`). */
export function dotV3V3(a: ArrayLike<number>, b: ArrayLike<number>): number {
    return f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]))
}

/** `cross_v3_v3v3` (`math_vector_inline.cc`). */
export function crossV3V3(a: ArrayLike<number>, b: ArrayLike<number>): F3 {
    return [
        f(f(a[1] * b[2]) - f(a[2] * b[1])),
        f(f(a[2] * b[0]) - f(a[0] * b[2])),
        f(f(a[0] * b[1]) - f(a[1] * b[0])),
    ]
}

/** `sub_v3_v3v3`. */
export function subV3V3(a: ArrayLike<number>, b: ArrayLike<number>): F3 {
    return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])]
}

/**
 * `normalize_v3_v3_length(r, a, 1.0f)` (`math_vector_inline.cc:872`): scales by `1 / d` (one division,
 * then products), zero vector and 0 when the squared length is not above 1e-35. Normalises `n` in
 * place and returns the original length.
 */
export function normalizeV3(n: number[]): number {
    let d = dotV3V3(n, n)
    if (d > 1.0e-35) {
        d = f(Math.sqrt(d))
        const s = f(1 / d)
        n[0] = f(n[0] * s)
        n[1] = f(n[1] * s)
        n[2] = f(n[2] * s)
        return d
    }
    n[0] = n[1] = n[2] = 0
    return 0
}

/** `add_newell_cross_v3_v3v3` (`math_vector_inline.cc:700`). */
export function addNewellCrossV3V3(n: number[], prev: ArrayLike<number>, curr: ArrayLike<number>): void {
    n[0] = f(n[0] + f(f(prev[1] - curr[1]) * f(prev[2] + curr[2])))
    n[1] = f(n[1] + f(f(prev[2] - curr[2]) * f(prev[0] + curr[0])))
    n[2] = f(n[2] + f(f(prev[0] - curr[0]) * f(prev[1] + curr[1])))
}

/** `ortho_basis_v3v3_v3` (`blenlib/intern/math_vector.cc:568`). */
export function orthoBasisV3V3V3(n: ArrayLike<number>): [F3, F3] {
    const len2 = f(f(n[0] * n[0]) + f(n[1] * n[1]))
    if (len2 > 1.1920928955078125e-7) {
        const d = f(1 / f(Math.sqrt(len2)))
        const n1: F3 = [f(n[1] * d), f(-n[0] * d), 0]
        const n2: F3 = [f(-n[2] * n1[1]), f(n[2] * n1[0]), f(f(n[0] * n1[1]) - f(n[1] * n1[0]))]
        return [n1, n2]
    }
    return [[n[2] < 0 ? -1 : 1, 0, 0], [0, 1, 0]]
}

/**
 * `axis_dominant_v3_to_m3_negate` (`blenlib/intern/math_geom.cc:3663`): rows are the basis vectors of
 * the plane facing `-normal`, as `float r_mat[3][3]` (`r_mat[col][row]` after the transpose). Returned
 * flat in Blender's memory order, `m[i * 3 + j] = r_mat[i][j]`.
 */
export function axisDominantV3ToM3Negate(normal: ArrayLike<number>): Float32Array {
    const neg: F3 = [-normal[0], -normal[1], -normal[2]]
    const [n1, n2] = orthoBasisV3V3V3(neg)
    // Before the transpose, r_mat[0] = n1, r_mat[1] = n2, r_mat[2] = -normal (rows of memory).
    const m = new Float32Array(9)
    const rows = [n1, n2, neg]
    // transpose_m3: m[i][j] = rows[j][i]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = rows[j][i]
    return m
}

/** `mul_v2_m3v3` (`blenlib/intern/math_matrix_c.cc:844`) with `M[i][j] = m[i * 3 + j]`. */
export function mulV2M3V3(m: ArrayLike<number>, a: ArrayLike<number>, out: number[] | Float32Array, o = 0): void {
    out[o] = f(f(f(m[0] * a[0]) + f(m[3] * a[1])) + f(m[6] * a[2]))
    out[o + 1] = f(f(f(m[1] * a[0]) + f(m[4] * a[1])) + f(m[7] * a[2]))
}

/** `is_quad_flip_v3_first_third_fast` (`math_geom.cc:5609`). */
export function isQuadFlipV3FirstThirdFast(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>, v4: ArrayLike<number>): boolean {
    const d12 = subV3V3(v2, v1)
    const d13 = subV3V3(v3, v1)
    const d14 = subV3V3(v4, v1)
    const a = crossV3V3(d12, d13)
    const b = crossV3V3(d14, d13)
    return dotV3V3(a, b) > 0
}

/** `cross_tri_v2` (`blenlib/intern/math_geom_inline.cc:24`). */
export function crossTriV2(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): number {
    return f(f(f(v1[0] - v2[0]) * f(v2[1] - v3[1])) + f(f(v1[1] - v2[1]) * f(v3[0] - v2[0])))
}

/** `cross_tri_v3` (`math_geom.cc:30`). */
export function crossTriV3(v1: ArrayLike<number>, v2: ArrayLike<number>, v3: ArrayLike<number>): F3 {
    const n1 = [f(v1[0] - v2[0]), f(v1[1] - v2[1]), f(v1[2] - v2[2])]
    const n2 = [f(v2[0] - v3[0]), f(v2[1] - v3[1]), f(v2[2] - v3[2])]
    return [
        f(f(n1[1] * n2[2]) - f(n1[2] * n2[1])),
        f(f(n1[2] * n2[0]) - f(n1[0] * n2[2])),
        f(f(n1[0] * n2[1]) - f(n1[1] * n2[0])),
    ]
}

/** `len_v2v2` (`math_vector_inline.cc`). */
export function lenV2V2(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const dx = f(a[0] - b[0]), dy = f(a[1] - b[1])
    return f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
}
