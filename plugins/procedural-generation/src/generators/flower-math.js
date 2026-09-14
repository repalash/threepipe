/**
 * Pure math functions for the procedural flower generator.
 * No three.js dependency — works in Node.js for verification.
 *
 * Ported from repeat_zone_flower_by_MiRA.blend.
 */
import { mapRange } from '../blender/math_nodes';
// ─── Parameter interpolation (Group.003) ────────────────────────────
// Group.007 inner (GN_PetalParameters.001) — the "end" values after animation completes.
// At frame >= 91 (StartFrame + AnimateFrame), t=1 → EndValue = Group.007 output.
const PARAM_RANGES = {
    waveWidth: { min: 0.02, max: 0.02 },
    wrinkleScale: { min: 0, max: 0 },
    wrinkleHeight: { min: 0.02, max: 0.02 },
    bend: { min: -3.1, max: -8.0 },
    roll: { min: 0, max: 13.9 },
    curlValue: { min: 4.2, max: 4.2 },
    scaleX: { min: 1.0, max: 0.8 },
    scaleY: { min: 0.8, max: 0.3 },
    scaleZ: { min: 1.0, max: 0.8 },
    forke: { min: 0.1, max: 0.1 },
    roundness: { min: 1.0, max: 1.0 },
    rhombus: { min: 150, max: 150 },
    // Rotation comes from Group.003 DIRECTLY (bypasses animation controller)
    rotX: { min: -3.1, max: 13.5 },
    rotY: { min: -30.2, max: -63.1 },
    rotZ: { min: -60, max: 106.5 },
};
const DEG2RAD = Math.PI / 180;
export function getParamsForRing(id, iterations) {
    const P = PARAM_RANGES;
    const lr = (r) => mapRange(id, 0, iterations, r.min, r.max);
    return {
        waveWidth: lr(P.waveWidth),
        wrinkleScale: lr(P.wrinkleScale),
        wrinkleHeight: lr(P.wrinkleHeight),
        bend: lr(P.bend),
        roll: lr(P.roll),
        curlValue: lr(P.curlValue),
        scale: [lr(P.scaleX), lr(P.scaleY), lr(P.scaleZ)],
        forke: lr(P.forke),
        roundness: lr(P.roundness),
        rhombus: lr(P.rhombus),
        rotation: [lr(P.rotX) * DEG2RAD, lr(P.rotY) * DEG2RAD, lr(P.rotZ) * DEG2RAD],
    };
}
// ─── Vector rotation ────────────────────────────────────────────────
function vectorRotate(vx, vy, vz, cx, cy, cz, angle, axis) {
    const dx = vx - cx, dy = vy - cy, dz = vz - cz;
    const c = Math.cos(angle), s = Math.sin(angle);
    let rx, ry, rz;
    if (axis === 'X') {
        rx = dx;
        ry = dy * c - dz * s;
        rz = dy * s + dz * c;
    }
    else if (axis === 'Y') {
        rx = dx * c + dz * s;
        ry = dy;
        rz = -dx * s + dz * c;
    }
    else {
        rx = dx * c - dy * s;
        ry = dx * s + dy * c;
        rz = dz;
    }
    return [rx + cx, ry + cy, rz + cz];
}
// ─── EulerXYZ rotation matrix ───────────────────────────────────────
function eulerXYZMatrix(rx, ry, rz) {
    const ci = Math.cos(rx), si = Math.sin(rx);
    const cj = Math.cos(ry), sj = Math.sin(ry);
    const ch = Math.cos(rz), sh = Math.sin(rz);
    const cc = ci * ch, cs = ci * sh, sc = si * ch, ss = si * sh;
    return [
        cj * ch, cj * sh, -sj,
        sj * sc - cs, sj * ss + cc, cj * si,
        sj * cc + ss, sj * cs - sc, cj * ci,
    ];
}
function applyRotScale(pos, N, rx, ry, rz, sx, sy, sz) {
    const m = eulerXYZMatrix(rx, ry, rz);
    for (let i = 0; i < N; i++) {
        const x = pos[i * 3] * sx, y = pos[i * 3 + 1] * sy, z = pos[i * 3 + 2] * sz;
        pos[i * 3] = m[0] * x + m[3] * y + m[6] * z;
        pos[i * 3 + 1] = m[1] * x + m[4] * y + m[7] * z;
        pos[i * 3 + 2] = m[2] * x + m[5] * y + m[8] * z;
    }
}
// ─── Petal generator (Group.019 — GN_Petal.001) ────────────────────
export function createPetalVertices(p, verticesX = 14, verticesY = 11) {
    const nx = verticesX, ny = verticesY, N = nx * ny;
    const pos = new Float64Array(N * 3);
    // Grid (0.1 × 0.1)
    let idx = 0;
    for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
            pos[idx++] = (ix / (nx - 1) - 0.5) * 0.1;
            pos[idx++] = (iy / (ny - 1) - 0.5) * 0.1;
            pos[idx++] = 0;
        }
    }
    // Transform.003: rotate Z=π then translate X=+0.05
    for (let i = 0; i < N; i++) {
        pos[i * 3] = -pos[i * 3] + 0.05;
        pos[i * 3 + 1] = -pos[i * 3 + 1];
    }
    // Transform.001: scale X by WaveWidth
    const ww = p.waveWidth;
    for (let i = 0; i < N; i++)
        pos[i * 3] *= ww;
    // Wrinkle noise: skip (wrinkleScale=0 → constant → negligible)
    // Transform: scale X by 1/WaveWidth (restore)
    if (Math.abs(ww) > 1e-10) {
        const invWW = 1.0 / ww;
        for (let i = 0; i < N; i++)
            pos[i * 3] *= invWW;
    }
    // Petal shape (fork + rhombus/roundness)
    for (let i = 0; i < N; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1];
        // Fork
        const leftDeg = mapRange(y, -0.05, 0, 0, 180);
        const rightDeg = mapRange(y, 0, 0.05, 0, 180);
        const sineLeft = Math.sin(leftDeg * DEG2RAD);
        const sineRight = Math.sin(rightDeg * DEG2RAD);
        const newX = x * (sineLeft + sineRight) * p.forke + x * (1 - p.forke);
        // Rhombus/Roundness
        const rhombusDeg = mapRange(x, 0, 0.1, 0, p.rhombus);
        const sineR = Math.sin(rhombusDeg * DEG2RAD);
        const newY = sineR * y * p.roundness + y * (1 - p.roundness);
        pos[i * 3] = newX;
        pos[i * 3 + 1] = newY;
    }
    // Blender's Set Position with Offset: new_pos = current_pos + VectorRotate(current_pos)
    // This is ADDITIVE — the rotated vector is added as displacement, not replacing position.
    // Source: node_geo_set_position.cc — new_positions[i] = positions_input[i] + offsets[i]
    // Roll: Set Position.001, Offset = VectorRotate(pos, center=0, X_AXIS, angle=Y*Roll)
    for (let i = 0; i < N; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const angle = y * p.roll;
        const [rx, ry, rz] = vectorRotate(x, y, z, 0, 0, 0, angle, 'X');
        pos[i * 3] = x + rx;
        pos[i * 3 + 1] = y + ry;
        pos[i * 3 + 2] = z + rz;
    }
    // Bend: Set Position.005, Offset = VectorRotate(pos, center=0, Y_AXIS, angle=X*Bend)
    for (let i = 0; i < N; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const angle = x * p.bend;
        const [rx, ry, rz] = vectorRotate(x, y, z, 0, 0, 0, angle, 'Y');
        pos[i * 3] = x + rx;
        pos[i * 3 + 1] = y + ry;
        pos[i * 3 + 2] = z + rz;
    }
    // Curl: Set Position.007, Offset = VectorRotate(pos, center=(cx,0,cz), Y_AXIS, angle=X*CurlValue)
    const curlCX = mapRange(p.curlValue, 0, 13, 0, 0.4);
    const curlCZ = mapRange(p.curlValue, 0, 13, 0, -0.2);
    for (let i = 0; i < N; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const angle = x * p.curlValue;
        const [rx, ry, rz] = vectorRotate(x, y, z, curlCX, 0, curlCZ, angle, 'Y');
        pos[i * 3] = x + rx;
        pos[i * 3 + 1] = y + ry;
        pos[i * 3 + 2] = z + rz;
    }
    // Final rotation + scale
    applyRotScale(pos, N, p.rotation[0], p.rotation[1], p.rotation[2], p.scale[0], p.scale[1], p.scale[2]);
    return pos;
}
