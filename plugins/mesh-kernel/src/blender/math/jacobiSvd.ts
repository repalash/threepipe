/**
 * `BLI_svd_m3` (`blenlib/intern/math_solvers.cc:46`) -> `EIG_svd_square_matrix` (`intern/eigen/intern/svd.cc`):
 * `JacobiSVD<MatrixXf, NoQRPreconditioner>` with `ComputeThinU | ComputeThinV` on a square float matrix. Port of
 * Eigen's `JacobiSVD::compute_impl` (`Eigen/src/SVD/JacobiSVD.h:697`), `real_2x2_jacobi_svd` and
 * `JacobiRotation` (`Eigen/src/Jacobi/Jacobi.h`), in float32 as Blender builds it:
 *
 * - every scalar expression is evaluated unfused: Blender compiles with `-ffp-contract=off`
 *   (`build_files/cmake/platform/platform_apple.cmake:161`), and the rotations on 3-element rows / columns take
 *   the scalar `apply_rotation_in_the_plane_selector` (the dynamic packet path needs `size >= 2 * PacketSize`,
 *   the fixed-size one a compile-time size).
 * - `maxCoeff(&index)` keeps the first maximum (`max_coeff_functor`: `candidate > incumbent`; with 3 values the
 *   packet loop of `FindCoeff.h` does not run).
 * - the coefficient-wise divisions / products (`matrix / scale`, `m_singularValues *= scale`) are single IEEE
 *   operations per element whether vectorized or not.
 *
 * Matrices are column-major `size * size` arrays (Blender and Eigen agree on that).
 */

const f32 = Math.fround

/** `JacobiRotation<float>`. */
interface Rot {
    c: number
    s: number
}

/** `JacobiRotation::operator*` (Jacobi.h:51) for real scalars. */
function rotMul(a: Rot, b: Rot): Rot {
    return {c: f32(f32(a.c * b.c) - f32(a.s * b.s)), s: f32(f32(a.c * b.s) + f32(a.s * b.c))}
}

/** `JacobiRotation::transpose`: `(c, -conj(s))`. */
const rotT = (r: Rot): Rot => ({c: r.c, s: -r.s})

/** `JacobiRotation::makeJacobi(x, y, z)` (Jacobi.h:93) for real scalars. */
function makeJacobi(x: number, y: number, z: number): Rot {
    const deno = f32(2 * Math.abs(y))
    if (deno < FLT_MIN) return {c: 1, s: 0}
    const tau = f32(f32(x - z) / deno)
    const w = f32(Math.sqrt(f32(f32(tau * tau) + 1)))
    const t = tau > 0 ? f32(1 / f32(tau + w)) : f32(1 / f32(tau - w))
    const signT = t > 0 ? 1 : -1
    const n = f32(1 / f32(Math.sqrt(f32(f32(t * t) + 1))))
    // `-sign_t * (conj(y) / abs(y)) * abs(t) * n`, left to right.
    const s = f32(f32(f32(-signT * f32(y / Math.abs(y))) * Math.abs(t)) * n)
    return {c: n, s}
}

/** `std::numeric_limits<float>::min()`. */
const FLT_MIN = 1.1754943508222875e-38
/** `NumTraits<float>::epsilon()`. */
const FLT_EPSILON = 1.1920928955078125e-7

/**
 * `apply_rotation_in_the_plane` (Jacobi.h:398): the scalar loop
 * `x = c * x + conj(s) * y; y = -s * x + conj(c) * y`, skipped for the identity rotation.
 */
function rotateInPlane(m: Float32Array, xAt: (i: number) => number, yAt: (i: number) => number, size: number, r: Rot): void {
    if (r.c === 1 && r.s === 0) return
    for (let i = 0; i < size; i++) {
        const xi = m[xAt(i)], yi = m[yAt(i)]
        m[xAt(i)] = f32(f32(r.c * xi) + f32(r.s * yi))
        m[yAt(i)] = f32(f32(-r.s * xi) + f32(r.c * yi))
    }
}

/** `applyOnTheLeft(p, q, j)`: rows p and q. */
function applyOnTheLeft(m: Float32Array, n: number, p: number, q: number, j: Rot): void {
    rotateInPlane(m, i => i * n + p, i => i * n + q, n, j)
}

/** `applyOnTheRight(p, q, j)`: columns p and q with `j.transpose()`. */
function applyOnTheRight(m: Float32Array, n: number, p: number, q: number, j: Rot): void {
    rotateInPlane(m, i => p * n + i, i => q * n + i, n, rotT(j))
}

/** `real_2x2_jacobi_svd` (Jacobi.h:424): `j_left`, `j_right` for the 2x2 block (p, q). */
function real2x2JacobiSvd(w: Float32Array, n: number, p: number, q: number): {left: Rot, right: Rot} {
    // `m << m(p,p), m(p,q), m(q,p), m(q,q)` (row-wise comma init into a column-major 2x2).
    const m = new Float32Array([w[p * n + p], w[p * n + q], w[q * n + p], w[q * n + q]])
    const t = f32(m[0] + m[3])
    const d = f32(m[1] - m[2])
    let rot1: Rot
    if (Math.abs(d) < FLT_MIN) rot1 = {c: 1, s: 0}
    else {
        const u = f32(t / d)
        const tmp = f32(Math.sqrt(f32(1 + f32(u * u))))
        rot1 = {s: f32(1 / tmp), c: f32(u / tmp)}
    }
    applyOnTheLeft(m, 2, 0, 1, rot1)
    // `makeJacobi(m, 0, 1)`: x = m(0,0), y = m(0,1), z = m(1,1).
    const right = makeJacobi(m[0], m[2], m[3])
    return {left: rotMul(rot1, rotT(right)), right}
}

export interface SVDResult {
    /** Column-major `size * size`. */
    u: Float32Array
    s: Float32Array
    v: Float32Array
}

/** `JacobiSVD<MatrixXf, NoQRPreconditioner>(matrix, ComputeThinU | ComputeThinV)` for a square column-major matrix. */
export function jacobiSvdSquare(matrix: ArrayLike<number>, size: number): SVDResult {
    const n = size
    const precision = f32(2 * FLT_EPSILON)
    const considerAsZero = FLT_MIN
    // `cwiseAbs().maxCoeff<PropagateNaN>()`.
    let scale = 0
    for (let i = 0; i < n * n; i++) {
        const a = Math.abs(matrix[i])
        if (Number.isNaN(a)) {
            scale = NaN
            break
        }
        if (a > scale) scale = a
    }
    if (!Number.isFinite(scale)) {
        // `InvalidInput`: singular values zero, U and V left uninitialized (`allocate` only resizes), which
        // Blender then copies out. Uninitialized memory has no defined value to port.
        throw new Error('Matrix SVD: non-finite input matrix (Eigen leaves U and V uninitialized)')
    }
    if (scale === 0) scale = 1
    const w = new Float32Array(n * n)
    for (let i = 0; i < n * n; i++) w[i] = f32(matrix[i] / scale)
    const u = new Float32Array(n * n), v = new Float32Array(n * n)
    for (let i = 0; i < n; i++) u[i * n + i] = v[i * n + i] = 1

    let maxDiagEntry = 0
    for (let i = 0; i < n; i++) maxDiagEntry = Math.max(maxDiagEntry, Math.abs(w[i * n + i]))

    let finished = false
    while (!finished) {
        finished = true
        for (let p = 1; p < n; p++) {
            for (let q = 0; q < p; q++) {
                const threshold = Math.max(considerAsZero, f32(precision * maxDiagEntry))
                if (Math.abs(w[q * n + p]) > threshold || Math.abs(w[p * n + q]) > threshold) {
                    finished = false
                    // `svd_precondition_2x2_block_to_be_real` is `true` for real scalars.
                    const {left, right} = real2x2JacobiSvd(w, n, p, q)
                    applyOnTheLeft(w, n, p, q, left)
                    applyOnTheRight(u, n, p, q, rotT(left))
                    applyOnTheRight(w, n, p, q, right)
                    applyOnTheRight(v, n, p, q, right)
                    // `numext::maxi(maxDiagEntry, maxi(abs(w(p,p)), abs(w(q,q))))`.
                    maxDiagEntry = maxi(maxDiagEntry, maxi(Math.abs(w[p * n + p]), Math.abs(w[q * n + q])))
                }
            }
        }
    }

    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const a = w[i * n + i]
        s[i] = Math.abs(a)
        if (a < 0) for (let k = 0; k < n; k++) u[i * n + k] = -u[i * n + k]
    }
    for (let i = 0; i < n; i++) s[i] = f32(s[i] * scale)

    // Sort descending; `maxCoeff(&pos)` over the tail keeps the first maximum.
    for (let i = 0; i < n; i++) {
        let pos = i
        for (let k = i + 1; k < n; k++) if (s[k] > s[pos]) pos = k
        if (s[pos] === 0) break
        if (pos !== i) {
            [s[i], s[pos]] = [s[pos], s[i]]
            for (let k = 0; k < n; k++) {
                [u[pos * n + k], u[i * n + k]] = [u[i * n + k], u[pos * n + k]];
                [v[pos * n + k], v[i * n + k]] = [v[i * n + k], v[pos * n + k]]
            }
        }
    }
    return {u, s, v}
}

/** `numext::maxi` (`std::max`): returns `a` unless `a < b`. */
const maxi = (a: number, b: number) => (a < b ? b : a)
