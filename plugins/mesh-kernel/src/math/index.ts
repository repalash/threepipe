/**
 * The small amount of vector and matrix maths the kernel needs.
 *
 * Ported from three.js (`src/math/Vector3.js`, `src/math/Matrix4.js`, `src/math/Quaternion.js`) so
 * that the numerics match what the renderer does, element for element. It exists as a local module
 * rather than an import because the kernel has no dependencies at all - see the guard in
 * `bake.test.ts` - and because plain arrays are what {@link MeshData} already stores.
 *
 * Matrices are column-major with the same element order as `THREE.Matrix4.elements`, so a `Mat4`
 * can be handed straight to `Matrix4.fromArray` and back.
 */

/** A point or direction. */
export type Vec3 = [number, number, number]
/** A 4x4 matrix, column-major, 16 elements - `THREE.Matrix4.elements` order. */
export type Mat4 = number[]

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z]
export const v3add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const v3sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const v3mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const v3dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const v3cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
]
export const v3len = (a: Vec3): number => Math.sqrt(v3dot(a, a))
export const v3dist = (a: Vec3, b: Vec3): number => v3len(v3sub(a, b))
export const v3lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
]

export function v3normalize(a: Vec3): Vec3 {
    const l = v3len(a)
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Component-wise multiply, for non-uniform scale. */
export const v3scale3 = (a: Vec3, s: Vec3): Vec3 => [a[0] * s[0], a[1] * s[1], a[2] * s[2]]

export const mat4Identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** `Matrix4.multiplyMatrices`. */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Array<number>(16)
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] =
                a[r] * b[c * 4] +
                a[4 + r] * b[c * 4 + 1] +
                a[8 + r] * b[c * 4 + 2] +
                a[12 + r] * b[c * 4 + 3]
        }
    }
    return out
}

/** `Vector3.applyMatrix4`, including the perspective divide three does. */
export function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
    const [x, y, z] = p
    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15] || 1)
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) * w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) * w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) * w,
    ]
}

/** `Vector3.transformDirection` without the normalise, i.e. the upper 3x3 only. */
export function mat4TransformDir(m: Mat4, p: Vec3): Vec3 {
    const [x, y, z] = p
    return [
        m[0] * x + m[4] * y + m[8] * z,
        m[1] * x + m[5] * y + m[9] * z,
        m[2] * x + m[6] * y + m[10] * z,
    ]
}

/** `Matrix4.makeTranslation`. */
export const mat4Translation = (t: Vec3): Mat4 =>
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]

/** `Matrix4.makeScale`. */
export const mat4Scale = (s: Vec3): Mat4 =>
    [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]

/**
 * `Matrix4.invert`, the cofactor expansion three uses. Returns the zero matrix when the input is
 * singular, exactly as three does, so callers see a degenerate result rather than NaNs.
 *
 * Blender's `invert_m4_m4` is Gauss-Jordan with partial pivoting; three's closed form is what the
 * renderer uses, and the kernel matches the renderer (see the module note above).
 */
export function mat4Invert(m: Mat4): Mat4 {
    const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3]
    const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7]
    const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11]
    const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15]

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
    if (det === 0) return new Array<number>(16).fill(0)
    const d = 1 / det

    return [
        t11 * d,
        (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
        (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
        (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,

        t12 * d,
        (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
        (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
        (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,

        t13 * d,
        (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
        (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
        (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,

        t14 * d,
        (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
        (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
        (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
    ]
}

/**
 * The length of each basis column, Blender's `mat4_to_size`. Used to decide whether an offset
 * matrix carries a scale, which changes how the array modifier propagates its merge mapping.
 */
export const mat4ToSize = (m: Mat4): Vec3 => [
    v3len([m[0], m[1], m[2]]),
    v3len([m[4], m[5], m[6]]),
    v3len([m[8], m[9], m[10]]),
]

/** `Matrix4.makeRotationAxis`, Rodrigues about a normalised axis. */
export function mat4RotationAxis(axis: Vec3, angle: number): Mat4 {
    const [x, y, z] = v3normalize(axis)
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const t = 1 - c
    const tx = t * x
    const ty = t * y
    return [
        tx * x + c, tx * y + s * z, tx * z - s * y, 0,
        tx * y - s * z, ty * y + c, ty * z + s * x, 0,
        tx * z + s * y, ty * z - s * x, t * z * z + c, 0,
        0, 0, 0, 1,
    ]
}

/** `Matrix4.makeRotationFromEuler` with the default XYZ order. */
export function mat4RotationEuler(e: Vec3): Mat4 {
    const [x, y, z] = e
    const a = Math.cos(x), b = Math.sin(x)
    const c = Math.cos(y), d = Math.sin(y)
    const f = Math.cos(z), g = Math.sin(z)
    const ae = a * f, af = a * g, be = b * f, bf = b * g
    return [
        c * f, af + be * d, bf - ae * d, 0,
        -c * g, ae - bf * d, be + af * d, 0,
        d, -b * c, a * c, 0,
        0, 0, 0, 1,
    ]
}

/** Translation * rotation(XYZ euler) * scale, the usual object transform composition. */
export function mat4Compose(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
    return mat4Multiply(
        mat4Multiply(mat4Translation(position), mat4RotationEuler(rotation)),
        mat4Scale(scale))
}

/** A rotation matrix from its three basis columns. */
export const mat4FromBasis = (x: Vec3, y: Vec3, z: Vec3, origin: Vec3 = [0, 0, 0]): Mat4 => [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    origin[0], origin[1], origin[2], 1,
]

/**
 * `Quaternion.setFromUnitVectors` applied as a matrix: the shortest rotation taking `from` to `to`.
 * Used by the minimum-twist frame transport in the sweep generator.
 */
export function mat4RotationBetween(from: Vec3, to: Vec3): Mat4 {
    const a = v3normalize(from)
    const b = v3normalize(to)
    const d = v3dot(a, b)
    if (d > 1 - 1e-9) return mat4Identity()
    if (d < -1 + 1e-9) {
        // Anti-parallel: rotate half a turn about any perpendicular axis, as three does.
        let axis: Vec3 = Math.abs(a[0]) > Math.abs(a[2]) ? [-a[1], a[0], 0] : [0, -a[2], a[1]]
        axis = v3normalize(axis)
        return mat4RotationAxis(axis, Math.PI)
    }
    return mat4RotationAxis(v3cross(a, b), Math.acos(Math.max(-1, Math.min(1, d))))
}
