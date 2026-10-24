(function () {
// js/pedestrians.js
// Skinned, procedurally animated New Yorkers: the sidewalk crowds (traffic.js), the player's pedestrian and the
// cyclist's rider (controllers.js).
// - One continuous lofted body (torso & neck, trouser legs, sleeves, hands, head, hair, shoes) skinned to a 15-bone
//   skeleton, with bind-pose morphs for build (girth), female proportions and hair volume & length; a near and a far
//   level of detail.
// - A whole crowd is one instanced draw per level of detail: every person's bone transforms (quaternion, translation &
//   scale) live in a storage buffer the vertex stage skins from, and a per-person seed dresses them (TSL material).
// - PersonRig walks a body along whatever path its owner moves it on: footsteps are planted in the world (heel strike,
//   foot flat, heel-off & toe-off rolling over a toe joint), so feet never slide; two-bone IK bends hips & knees to
//   reach them, the pelvis rides as high as the planted legs allow (the inverted pendulum's bob), and the pelvis
//   rotation & sway, the chest's counter-rotation and the arm swing all follow the feet. It turns on the spot, stops
//   with its feet together, steps up & down curbs, runs, jumps, and rides a bicycle (feet on the pedals).

const { THREE } = window.NYC;
const {
  Fn,
  float,
  int,
  vec2,
  vec3,
  color,
  attribute,
  instanceIndex,
  attributeArray,
  normalLocal,
  varying,
  cross,
  normalize,
  sin,
  abs,
  fract,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length
} = window.NYC.TSL;
const { mergeGeometries } = window.NYC.Addons;

// ============================================================================
// 1. SKELETON
// ============================================================================
const BONE = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  UPPER_ARM_L: 3,
  FOREARM_L: 4,
  UPPER_ARM_R: 5,
  FOREARM_R: 6,
  THIGH_L: 7,
  SHIN_L: 8,
  FOOT_L: 9,
  TOE_L: 10,
  THIGH_R: 11,
  SHIN_R: 12,
  FOOT_R: 13,
  TOE_R: 14
};
const BONE_COUNT = 15;
// vec4s per person in the pose buffer: (quaternion) and (translation, scale) per bone, then (seed, female, girth, hair)
const STRIDE = BONE_COUNT * 2 + 1;

// Bind pose (metres, a 1.75 m person standing at the origin facing +Z, +X on their left): legs straight down, arms
// hanging 8 degrees out from the body
const THIGH = 0.42;
const SHIN = 0.42;
const ANKLE_H = 0.08;
const HIP_X = 0.09;
const UPPER_ARM = 0.3;
const FOREARM = 0.255;
const ARM_BIND_ABDUCTION = 0.14;
const PELVIS_Y = 0.96;
const HIP_Y = ANKLE_H + SHIN + THIGH;
const SIDES = [1, -1]; // left (+X), right (-X)
const LIMB = {
  upperArm: [BONE.UPPER_ARM_L, BONE.UPPER_ARM_R],
  forearm: [BONE.FOREARM_L, BONE.FOREARM_R],
  thigh: [BONE.THIGH_L, BONE.THIGH_R],
  shin: [BONE.SHIN_L, BONE.SHIN_R],
  foot: [BONE.FOOT_L, BONE.FOOT_R],
  toe: [BONE.TOE_L, BONE.TOE_R]
};

function shoulderJoint(female) {
  return female ? [0.165, 1.415, -0.015] : [0.185, 1.43, -0.015];
}

function bindJoints(female) {
  const sh = shoulderJoint(female);
  const ax = Math.sin(ARM_BIND_ABDUCTION) * UPPER_ARM;
  const ay = -Math.cos(ARM_BIND_ABDUCTION) * UPPER_ARM;
  const j = [];
  j[BONE.PELVIS] = new THREE.Vector3(0, PELVIS_Y, 0);
  j[BONE.CHEST] = new THREE.Vector3(0, 1.12, -0.01);
  j[BONE.HEAD] = new THREE.Vector3(0, 1.52, -0.012);
  SIDES.forEach((side, k) => {
    j[LIMB.upperArm[k]] = new THREE.Vector3(side * sh[0], sh[1], sh[2]);
    j[LIMB.forearm[k]] = new THREE.Vector3(side * (sh[0] + ax), sh[1] + ay, sh[2]);
    j[LIMB.thigh[k]] = new THREE.Vector3(side * HIP_X, HIP_Y, 0);
    j[LIMB.shin[k]] = new THREE.Vector3(side * HIP_X, ANKLE_H + SHIN, 0);
    j[LIMB.foot[k]] = new THREE.Vector3(side * HIP_X, ANKLE_H, 0);
    j[LIMB.toe[k]] = new THREE.Vector3(side * HIP_X, 0.02, 0.135);
  });
  return j;
}
const BIND = [bindJoints(false), bindJoints(true)];

// ============================================================================
// 2. SKINNED LOFTED BODY GEOMETRY
// ============================================================================
const PART = { BODY: 0, LEG: 1, SHOE: 2, ARM: 3, HAND: 4, HEAD: 5, HAIR: 6, LONG_HAIR: 7 };

// Superellipse ring around a vertical axis (x across, z to the front `rzF` or back `rzB`); `bump(a)` pushes points out
function ringY(y, rx, rzF, rzB, cz, n, ex = 2, bump = null, cx = 0) {
  const e = 2 / ex;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = Math.sign(c) * Math.abs(c) ** e * rx;
    let z = Math.sign(s) * Math.abs(s) ** e * (s >= 0 ? rzF : rzB);
    const b = bump ? bump(a) : 0;
    if (b) {
      const r = Math.hypot(x, z) || 1;
      x += (x / r) * b;
      z += (z / r) * b;
    }
    out.push(new THREE.Vector3(cx + x, y, cz + z));
  }
  return out;
}

const _down = new THREE.Vector3(0, -1, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
// Ring around a limb axis `dir` (rows run along it): x stays roughly across the body, z to the front; `twist` turns
// the ring about the axis
function limbRing(center, dir, rx, rz, n, ex = 2, twist = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(_down, dir);
  return ringY(0, rx, rz, rz, 0, n, ex).map((p) => p.applyAxisAngle(_yAxis, twist).applyQuaternion(q).add(center));
}

// Gaussian bump around angle a0 (wrapping)
function lobe(a, a0, width) {
  let d = a - a0;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return Math.exp(-(d * d) / (width * width));
}

// Closed loft through rings of equal size (rows of the surface), with optional flat caps (centroid fans). Returns
// positions, uvs (u along the rows, v around), indices and the row each vertex belongs to; rings with the same layout
// give vertex-for-vertex matching positions, which the morph targets rely on.
function loftRings(sections, capStart, capEnd) {
  const rows = sections.length;
  const columns = sections[0].length;
  const per = columns + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  const rowOf = [];
  const rowU = [0];
  for (let i = 1; i < rows; i++) {
    let d = 0;
    for (let j = 0; j < columns; j++) d += sections[i][j].distanceTo(sections[i - 1][j]);
    rowU.push(rowU[i - 1] + d / columns);
  }
  const totalU = rowU[rows - 1] || 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < per; j++) {
      const p = sections[i][j % columns];
      positions.push(p.x, p.y, p.z);
      uvs.push(rowU[i] / totalU, j / columns);
      rowOf.push(i);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < columns; j++) {
      const a = i * per + j;
      const b = a + 1;
      const c = a + per + 1;
      const d = a + per;
      indices.push(a, b, d, b, c, d);
    }
  }
  const cap = (row, flip) => {
    const start = positions.length / 3;
    const centre = new THREE.Vector3();
    for (let j = 0; j < columns; j++) {
      const p = sections[row][j];
      centre.add(p);
      positions.push(p.x, p.y, p.z);
      uvs.push(row === 0 ? 0 : 1, j / columns);
      rowOf.push(row);
    }
    centre.divideScalar(columns);
    positions.push(centre.x, centre.y, centre.z);
    uvs.push(row === 0 ? 0 : 1, 0.5);
    rowOf.push(row);
    const c = start + columns;
    for (let j = 0; j < columns; j++) {
      const a = start + j;
      const b = start + ((j + 1) % columns);
      if (flip) indices.push(c, b, a);
      else indices.push(c, a, b);
    }
  };
  // rings run counter-clockwise looking back along the rows: the first cap faces back, the last one forward
  if (capStart) cap(0, true);
  if (capEnd) cap(rows - 1, false);
  return { positions, uvs, indices, rowOf, rows, per };
}

class BodyBuilder {
  constructor() {
    this.geometries = [];
  }

  // rows: { pts, ptsF (female), ptsH (more hair volume), ptsL (long hair), skin: [boneA, boneB, weightB], axis }
  // flattenBelow: normals of vertices lower than this face less downwards (the crotch of the trousers reads as cloth,
  // not as a dark gap between the legs)
  loft(rows, part, { capStart = false, capEnd = false, flattenBelow = -1 } = {}) {
    const lo = loftRings(rows.map((r) => r.pts), capStart, capEnd);
    const variant = (key) => (rows.some((r) => r[key]) ? loftRings(rows.map((r) => r[key] || r.pts), capStart, capEnd).positions : null);
    const fem = variant('ptsF');
    const vol = variant('ptsH');
    const long = variant('ptsL');

    const geo = new THREE.BufferGeometry();
    geo.setIndex(lo.indices);
    // normals of the shape as seen: the long hair's hanging down, not its bind pose folded away inside the head
    geo.setAttribute('position', new THREE.Float32BufferAttribute(long || lo.positions, 3));
    geo.computeVertexNormals();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lo.positions, 3));
    // weld the normals along the seam of every ring
    const normals = geo.attributes.normal;
    for (let i = 0; i < lo.rows; i++) {
      const a = i * lo.per;
      const b = a + lo.per - 1;
      _seam.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
      normals.setXYZ(a, _seam.x, _seam.y, _seam.z);
      normals.setXYZ(b, _seam.x, _seam.y, _seam.z);
    }
    for (let v = 0; v < normals.count; v++) {
      if (lo.positions[v * 3 + 1] >= flattenBelow || normals.getY(v) >= 0) continue;
      _seam.set(normals.getX(v), normals.getY(v) * 0.3, normals.getZ(v)).normalize();
      normals.setXYZ(v, _seam.x, _seam.y, _seam.z);
    }

    // Packed (WebGPU allows 8 vertex buffers): skin = (bone A, bone B, weight of B, part), extra = (girth direction
    // x & z, u along the loft), femaleDelta, hairDelta (hair volume on the shell, hair length on the long hair)
    const pos = lo.positions;
    const count = pos.length / 3;
    const skin = new Float32Array(count * 4);
    const extra = new Float32Array(count * 3);
    const femaleDelta = new Float32Array(count * 3);
    const hairDelta = new Float32Array(count * 3);
    const hair = vol || long;
    for (let v = 0; v < count; v++) {
      const row = rows[lo.rowOf[v]];
      skin[v * 4] = row.skin[0];
      skin[v * 4 + 1] = row.skin[1];
      skin[v * 4 + 2] = row.skin[2];
      skin[v * 4 + 3] = part;
      if (row.axis) {
        extra[v * 3] = pos[v * 3] - row.axis.x;
        extra[v * 3 + 1] = pos[v * 3 + 2] - row.axis.z;
      }
      extra[v * 3 + 2] = lo.uvs[v * 2];
      for (let k = 0; k < 3; k++) {
        if (fem) femaleDelta[v * 3 + k] = fem[v * 3 + k] - pos[v * 3 + k];
        if (hair) hairDelta[v * 3 + k] = hair[v * 3 + k] - pos[v * 3 + k];
      }
    }
    geo.setAttribute('skin', new THREE.BufferAttribute(skin, 4));
    geo.setAttribute('extra', new THREE.BufferAttribute(extra, 3));
    geo.setAttribute('femaleDelta', new THREE.BufferAttribute(femaleDelta, 3));
    geo.setAttribute('hairDelta', new THREE.BufferAttribute(hairDelta, 3));
    this.geometries.push(geo);
  }

  build() {
    const geo = mergeGeometries(this.geometries);
    geo.computeBoundingSphere();
    return geo;
  }
}
const _seam = new THREE.Vector3();

// Profiles: [y, rx, rzFront, rzBack, centreZ, keepInFarLod] for the male base and the female morph target
const TORSO = {
  m: [
    [1.615, 0.046, 0.044, 0.048, -0.004, 1],
    [1.575, 0.051, 0.049, 0.053, -0.008, 0],
    [1.53, 0.058, 0.053, 0.057, -0.013, 1],
    [1.5, 0.1, 0.064, 0.07, -0.018, 0],
    [1.47, 0.163, 0.08, 0.082, -0.02, 1],
    [1.44, 0.188, 0.095, 0.089, -0.018, 1],
    [1.4, 0.186, 0.108, 0.093, -0.014, 0],
    [1.34, 0.177, 0.118, 0.096, -0.01, 1],
    [1.27, 0.167, 0.117, 0.093, -0.006, 0],
    [1.2, 0.157, 0.11, 0.089, -0.002, 1],
    [1.13, 0.15, 0.104, 0.086, 0, 0],
    [1.06, 0.154, 0.101, 0.089, 0, 1],
    [0.99, 0.163, 0.099, 0.099, 0, 0],
    [0.935, 0.166, 0.095, 0.106, 0, 1],
    [0.885, 0.152, 0.078, 0.1, 0, 0],
    [0.845, 0.1, 0.055, 0.075, 0, 1]
  ],
  f: [
    [1.615, 0.042, 0.04, 0.044, -0.004],
    [1.575, 0.045, 0.043, 0.047, -0.008],
    [1.53, 0.051, 0.047, 0.051, -0.012],
    [1.5, 0.086, 0.056, 0.062, -0.016],
    [1.47, 0.142, 0.072, 0.074, -0.018],
    [1.44, 0.164, 0.085, 0.081, -0.016],
    [1.4, 0.163, 0.1, 0.084, -0.012],
    [1.34, 0.157, 0.122, 0.087, -0.006],
    [1.27, 0.148, 0.118, 0.084, -0.002],
    [1.2, 0.136, 0.097, 0.08, 0],
    [1.13, 0.127, 0.09, 0.078, 0],
    [1.06, 0.144, 0.094, 0.086, 0],
    [0.99, 0.165, 0.098, 0.103, 0],
    [0.935, 0.174, 0.096, 0.112, 0],
    [0.885, 0.16, 0.08, 0.106, 0],
    [0.845, 0.104, 0.056, 0.078, 0]
  ]
};

function torsoSkin(y) {
  if (y > 1.6) return [BONE.CHEST, BONE.HEAD, 1];
  if (y > 1.56) return [BONE.CHEST, BONE.HEAD, 0.65];
  if (y > 1.52) return [BONE.CHEST, BONE.HEAD, 0.2];
  if (y > 1.15) return [BONE.CHEST, BONE.CHEST, 0];
  if (y > 1.1) return [BONE.PELVIS, BONE.CHEST, 0.5];
  if (y > 1.03) return [BONE.PELVIS, BONE.CHEST, 0.15];
  return [BONE.PELVIS, BONE.PELVIS, 0];
}

// [y, rx, rzFront, rzBack, centreZ, keepInFarLod] around each leg's axis (x = +-HIP_X)
const LEG = {
  m: [
    [0.975, 0.054, 0.054, 0.054, 0, 1],
    [0.925, 0.062, 0.072, 0.075, 0, 0],
    [0.865, 0.083, 0.088, 0.091, 0.003, 1],
    [0.77, 0.078, 0.083, 0.083, 0.006, 0],
    [0.67, 0.071, 0.075, 0.073, 0.008, 1],
    [0.59, 0.064, 0.067, 0.064, 0.008, 0],
    [0.535, 0.058, 0.062, 0.058, 0.008, 1],
    [0.5, 0.056, 0.061, 0.056, 0.008, 1],
    [0.465, 0.054, 0.058, 0.056, 0.004, 1],
    [0.415, 0.054, 0.056, 0.06, 0, 0],
    [0.335, 0.053, 0.054, 0.061, -0.004, 1],
    [0.245, 0.051, 0.052, 0.054, -0.003, 0],
    [0.17, 0.051, 0.053, 0.053, 0, 1],
    [0.13, 0.052, 0.055, 0.053, 0.004, 0],
    [0.1, 0.044, 0.046, 0.044, 0.004, 1]
  ],
  f: [
    [0.975, 0.056, 0.056, 0.056, 0],
    [0.925, 0.066, 0.074, 0.08, 0],
    [0.865, 0.087, 0.087, 0.094, 0.003],
    [0.77, 0.078, 0.079, 0.08, 0.006],
    [0.67, 0.067, 0.069, 0.067, 0.008],
    [0.59, 0.057, 0.059, 0.057, 0.008],
    [0.535, 0.051, 0.055, 0.051, 0.008],
    [0.5, 0.049, 0.053, 0.049, 0.008],
    [0.465, 0.047, 0.051, 0.049, 0.004],
    [0.415, 0.047, 0.049, 0.054, 0],
    [0.335, 0.046, 0.047, 0.056, -0.004],
    [0.245, 0.04, 0.042, 0.045, -0.003],
    [0.17, 0.035, 0.037, 0.037, 0],
    [0.13, 0.034, 0.036, 0.035, 0.003],
    [0.1, 0.031, 0.033, 0.032, 0.003]
  ]
};

function legSkin(y, k) {
  const thigh = LIMB.thigh[k];
  const shin = LIMB.shin[k];
  const foot = LIMB.foot[k];
  // the hip bends over 0.75-0.95 m, below the jacket's hem, so the thigh tops stay inside the pelvis
  if (y > 0.95) return [BONE.PELVIS, thigh, 0.05];
  if (y > 0.9) return [BONE.PELVIS, thigh, 0.3];
  if (y > 0.84) return [BONE.PELVIS, thigh, 0.72];
  if (y > 0.74) return [BONE.PELVIS, thigh, 0.93];
  if (y > 0.55) return [thigh, thigh, 0];
  if (y > 0.52) return [thigh, shin, 0.12];
  if (y > 0.48) return [thigh, shin, 0.5];
  if (y > 0.44) return [thigh, shin, 0.88];
  if (y > 0.15) return [shin, shin, 0];
  if (y > 0.115) return [shin, foot, 0.25];
  return [shin, foot, 0.5];
}

// [distance along the arm from the shoulder, rx, rz, offset towards the body's side, offset forward, keepInFarLod]
const ARM = [
  [-0.022, 0.026, 0.032, -0.024, 0, 1],
  [-0.008, 0.042, 0.05, -0.014, 0, 0],
  [0.012, 0.052, 0.057, -0.006, 0, 1],
  [0.05, 0.055, 0.057, 0.001, 0, 0],
  [0.1, 0.052, 0.052, 0.003, 0, 1],
  [0.16, 0.048, 0.049, 0.001, 0.003, 0],
  [0.23, 0.044, 0.046, 0, 0, 1],
  [0.272, 0.042, 0.043, 0, -0.003, 0],
  [0.3, 0.041, 0.042, 0, -0.005, 1],
  [0.328, 0.042, 0.043, 0, -0.003, 0],
  [0.39, 0.043, 0.042, 0, 0, 1],
  [0.465, 0.038, 0.035, 0, 0, 0],
  [0.525, 0.034, 0.031, 0, 0, 1],
  [0.542, 0.036, 0.033, 0, 0, 1],
  [0.55, 0.028, 0.026, 0, 0, 1]
];
// [distance along the arm, thickness (across), width (front-back), offset forward, keepInFarLod]
const HAND = [
  [0.525, 0.023, 0.026, 0, 1],
  [0.555, 0.021, 0.03, 0.002, 0],
  [0.595, 0.023, 0.04, 0.004, 1],
  [0.64, 0.021, 0.042, 0.004, 0],
  [0.68, 0.017, 0.037, 0.002, 1],
  [0.712, 0.013, 0.028, 0, 0],
  [0.728, 0.008, 0.015, 0, 1]
];
const HAND_TWIST = 0.45; // relaxed hands: palms turned from facing the thighs towards the back

function armSkin(d, k) {
  const ua = LIMB.upperArm[k];
  const fa = LIMB.forearm[k];
  if (d < -0.03) return [BONE.CHEST, ua, 0.32];
  if (d < 0) return [BONE.CHEST, ua, 0.6];
  if (d < 0.06) return [BONE.CHEST, ua, 0.88];
  if (d < 0.26) return [ua, ua, 0];
  if (d < 0.29) return [ua, fa, 0.15];
  if (d < 0.315) return [ua, fa, 0.5];
  if (d < 0.36) return [ua, fa, 0.85];
  return [fa, fa, 0];
}

// [y, rx, rzFront, rzBack, centreZ, keepInFarLod]
const HEAD = {
  m: [
    [1.752, 0.018, 0.018, 0.02, -0.012, 1],
    [1.738, 0.056, 0.058, 0.064, -0.013, 0],
    [1.712, 0.078, 0.082, 0.092, -0.013, 1],
    [1.682, 0.087, 0.09, 0.102, -0.011, 0],
    [1.652, 0.088, 0.093, 0.103, -0.009, 1],
    [1.622, 0.084, 0.094, 0.098, -0.007, 0],
    [1.592, 0.078, 0.095, 0.09, -0.005, 1],
    [1.562, 0.071, 0.091, 0.078, -0.002, 0],
    [1.537, 0.063, 0.085, 0.066, 0.002, 1],
    [1.514, 0.052, 0.074, 0.054, 0.008, 0],
    [1.497, 0.03, 0.048, 0.032, 0.016, 1]
  ],
  f: [
    [1.748, 0.017, 0.017, 0.019, -0.012],
    [1.734, 0.053, 0.055, 0.061, -0.013],
    [1.709, 0.074, 0.078, 0.088, -0.013],
    [1.68, 0.083, 0.086, 0.097, -0.011],
    [1.651, 0.083, 0.089, 0.098, -0.009],
    [1.622, 0.079, 0.09, 0.093, -0.007],
    [1.594, 0.073, 0.09, 0.085, -0.005],
    [1.566, 0.066, 0.086, 0.073, -0.002],
    [1.543, 0.058, 0.08, 0.061, 0.002],
    [1.522, 0.046, 0.068, 0.049, 0.008],
    [1.507, 0.026, 0.042, 0.028, 0.014]
  ]
};

// Nose, brow, cheekbones, chin & ears pushed out of the head's rings
function headBump(y) {
  const front = Math.PI / 2;
  return (a) => {
    let b = 0;
    if (Math.abs(y - 1.592) < 0.02) b += 0.017 * lobe(a, front, 0.16); // nose tip
    if (Math.abs(y - 1.622) < 0.02) b += 0.007 * lobe(a, front, 0.14); // bridge
    if (Math.abs(y - 1.652) < 0.02) b += 0.004 * lobe(a, front, 0.6); // brow ridge
    if (Math.abs(y - 1.562) < 0.02) b += 0.004 * lobe(a, front, 0.2) + 0.004 * (lobe(a, front - 0.75, 0.3) + lobe(a, front + 0.75, 0.3));
    if (Math.abs(y - 1.514) < 0.012) b += 0.006 * lobe(a, front, 0.35); // chin
    if (y < 1.64 && y > 1.575) b += 0.011 * (lobe(a, -0.12, 0.22) + lobe(a, Math.PI + 0.12, 0.22)); // ears
    return b;
  };
}

// Head profile at any height (for the hair shell)
function headAt(table, y) {
  if (y >= table[0][0]) return table[0];
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (y <= a[0] && y >= b[0]) {
      const t = (a[0] - y) / (a[0] - b[0]);
      return a.map((v, k) => v + (b[k] - v) * t);
    }
  }
  return table[table.length - 1];
}

const hairlineY = (a) => 1.62 + 0.055 * Math.sin(a) - 0.005 * Math.cos(2 * a);

// Hair shell over the scalp, from the crown to the hairline, `t` thick (thinning to a soft edge at the hairline)
function hairShellRing(table, f, t, n) {
  const crown = table[0][0];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const y = crown + (hairlineY(a) - crown) * f;
    const [, rx, rzF, rzB, cz] = headAt(table, y);
    const p = new THREE.Vector3(Math.cos(a) * rx, y, cz + Math.sin(a) * (Math.sin(a) >= 0 ? rzF : rzB));
    const k = t * (1 - 0.75 * f * f);
    const c = new THREE.Vector3(0, 1.635, -0.012);
    out.push(p.sub(c).multiplyScalar(1 + k / Math.max(0.05, p.length())).add(c));
  }
  return out;
}

// Long hair falling behind the shoulders: [y, rx, rzFront, rzBack, centreZ]
const LONG_HAIR = [
  [1.635, 0.094, 0.045, 0.108, -0.01],
  [1.59, 0.098, 0.034, 0.107, -0.015],
  [1.55, 0.097, 0.03, 0.101, -0.022],
  [1.5, 0.093, 0.028, 0.09, -0.036],
  [1.45, 0.096, 0.028, 0.08, -0.05],
  [1.4, 0.091, 0.026, 0.07, -0.06],
  [1.36, 0.066, 0.02, 0.052, -0.068]
];

// [z from the ankle, half width, top, sole, keepInFarLod] (relative to the ankle joint)
const SHOE = [
  [-0.088, 0.02, -0.02, -0.066, 1],
  [-0.078, 0.034, 0.016, -0.08, 0],
  [-0.05, 0.042, 0.036, -0.08, 1],
  [-0.01, 0.045, 0.032, -0.08, 0],
  [0.04, 0.048, 0.006, -0.08, 1],
  [0.09, 0.05, -0.022, -0.08, 0],
  [0.13, 0.051, -0.035, -0.08, 1],
  [0.165, 0.048, -0.044, -0.08, 0],
  [0.192, 0.039, -0.05, -0.079, 1],
  [0.208, 0.022, -0.056, -0.075, 1]
];

function shoeRing(cx, z, hw, top, sole, n) {
  const out = [];
  const mid = sole + (top - sole) * 0.38;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** 0.6 * hw;
    const y = s >= 0 ? mid + (top - mid) * s ** 0.85 : mid - (mid - sole) * Math.abs(s) ** 0.35;
    out.push(new THREE.Vector3(cx + x, ANKLE_H + y, z));
  }
  return out;
}

function shoeSkin(z, k) {
  const foot = LIMB.foot[k];
  const toe = LIMB.toe[k];
  if (z < 0.07) return [foot, foot, 0];
  if (z < 0.11) return [foot, toe, 0.12];
  if (z < 0.15) return [foot, toe, 0.55];
  return [toe, toe, 0];
}

const _geometryCache = new Map();

/**
 * The skinned person: detail 1 near (~2000 vertices), 0 far (~600 vertices). Attributes: position & normal (male bind
 * pose), skin (two bones & the weight of the second, part id), extra (girth direction, u along the loft) and the
 * femaleDelta & hairDelta morph targets.
 */
function buildPersonGeometry(detail = 1) {
  if (_geometryCache.has(detail)) return _geometryCache.get(detail);
  const hi = detail > 0;
  const keep = (row, flagIndex) => hi || row[flagIndex] === 1;
  const B = new BodyBuilder();
  const nTorso = hi ? 16 : 8;
  const nLeg = hi ? 12 : 6;
  const nArm = hi ? 10 : 6;
  const nHand = hi ? 8 : 4;
  const nHead = hi ? 20 : 8;
  const nShoe = hi ? 12 : 6;

  // Torso & neck: a soft-cornered chest (superellipse), with a hint of bust on the female target
  const bust = (a) => 0.011 * (lobe(a, Math.PI / 2 - 0.5, 0.38) + lobe(a, Math.PI / 2 + 0.5, 0.38));
  const torsoRows = [];
  TORSO.m.forEach((m, i) => {
    if (!keep(m, 5)) return;
    const f = TORSO.f[i];
    const ex = m[0] > 1.5 ? 2 : m[0] > 1.0 ? 2.35 : 2.15;
    const fBump = m[0] < 1.37 && m[0] > 1.25 ? bust : null;
    torsoRows.push({
      pts: ringY(m[0], m[1], m[2], m[3], m[4], nTorso, ex),
      ptsF: ringY(f[0], f[1], f[2], f[3], f[4], nTorso, ex, fBump),
      skin: torsoSkin(m[0]),
      axis: new THREE.Vector3(0, m[0], m[4])
    });
  });
  B.loft(torsoRows, PART.BODY, { capEnd: true, flattenBelow: 0.95 });

  // Trouser legs
  SIDES.forEach((side, k) => {
    const rows = [];
    LEG.m.forEach((m, i) => {
      if (!keep(m, 5)) return;
      const f = LEG.f[i];
      const cx = side * HIP_X;
      rows.push({
        pts: ringY(m[0], m[1], m[2], m[3], m[4], nLeg, 2, null, cx),
        ptsF: ringY(f[0], f[1], f[2], f[3], f[4], nLeg, 2, null, cx),
        skin: legSkin(m[0], k),
        axis: new THREE.Vector3(cx, m[0], m[4])
      });
    });
    B.loft(rows, PART.LEG, { capStart: true, capEnd: true });
  });

  // Sleeves & hands, along each arm's bind direction (female arms: slimmer & from narrower shoulders)
  SIDES.forEach((side, k) => {
    const dir = new THREE.Vector3(side * Math.sin(ARM_BIND_ABDUCTION), -Math.cos(ARM_BIND_ABDUCTION), 0);
    const shM = new THREE.Vector3(...shoulderJoint(false));
    const shF = new THREE.Vector3(...shoulderJoint(true));
    shM.x *= side;
    shF.x *= side;
    const at = (sh, d, ox, oz) => sh.clone().addScaledVector(dir, d).add(new THREE.Vector3(side * ox, 0, oz));
    const sleeve = [];
    for (const r of ARM) {
      if (!keep(r, 5)) continue;
      const [d, rx, rz, ox, oz] = r;
      const c = at(shM, d, ox, oz);
      sleeve.push({
        pts: limbRing(c, dir, rx, rz, nArm),
        ptsF: limbRing(at(shF, d, ox * 0.9, oz), dir, rx * 0.84, rz * 0.84, nArm),
        skin: armSkin(d, k),
        axis: c
      });
    }
    B.loft(sleeve, PART.ARM, { capStart: true, capEnd: true });

    const hand = [];
    const twist = -side * HAND_TWIST;
    for (const r of HAND) {
      if (!keep(r, 4)) continue;
      const [d, rx, rz, oz] = r;
      hand.push({
        pts: limbRing(at(shM, d, 0, oz), dir, rx, rz, nHand, 2, twist),
        ptsF: limbRing(at(shF, d * 0.985, 0, oz), dir, rx * 0.88, rz * 0.88, nHand, 2, twist),
        skin: [LIMB.forearm[k], LIMB.forearm[k], 0],
        axis: null
      });
    }
    B.loft(hand, PART.HAND, { capStart: true, capEnd: true });

    if (hi) {
      // Thumb, along the front edge of the (turned) palm
      const thumb = [
        [0.565, 0.026, 0.011],
        [0.605, 0.038, 0.0105],
        [0.64, 0.044, 0.008]
      ].map(([d, oz, r]) => {
        const off = new THREE.Vector3(side * -0.006, 0, oz).applyAxisAngle(_yAxis, twist);
        return {
          pts: limbRing(shM.clone().addScaledVector(dir, d).add(off), dir, r, r, 6),
          ptsF: limbRing(shF.clone().addScaledVector(dir, d * 0.985).addScaledVector(off, 0.9), dir, r * 0.88, r * 0.88, 6),
          skin: [LIMB.forearm[k], LIMB.forearm[k], 0],
          axis: null
        };
      });
      B.loft(thumb, PART.HAND, { capStart: true, capEnd: true });
    }
  });

  // Head (nose, brow, cheekbones, chin & ears sculpted into the rings)
  const headRows = [];
  HEAD.m.forEach((m, i) => {
    if (!keep(m, 5)) return;
    const f = HEAD.f[i];
    headRows.push({
      pts: ringY(m[0], m[1], m[2], m[3], m[4], nHead, 2, hi ? headBump(m[0]) : null),
      ptsF: ringY(f[0], f[1], f[2], f[3], f[4], nHead, 2, hi ? headBump(m[0]) : null),
      skin: [BONE.HEAD, BONE.HEAD, 0],
      axis: null
    });
  });
  B.loft(headRows, PART.HEAD, { capStart: true, capEnd: true });

  // Hair shell (volume morph) & long hair (length morph, folded away inside the head when short)
  const shell = (hi ? [0.04, 0.22, 0.45, 0.68, 0.86, 1] : [0.04, 0.45, 1]).map((f) => ({
    pts: hairShellRing(HEAD.m, f, 0.006, nHead),
    ptsF: hairShellRing(HEAD.f, f, 0.006, nHead),
    ptsH: hairShellRing(HEAD.m, f, 0.022, nHead),
    skin: [BONE.HEAD, BONE.HEAD, 0],
    axis: null
  }));
  B.loft(shell, PART.HAIR, { capStart: true });
  const nLong = hi ? 14 : 6;
  const longRows = (hi ? LONG_HAIR : LONG_HAIR.filter((r, i) => i % 2 === 0)).map(([y, rx, rzF, rzB, cz]) => ({
    pts: ringY(1.64, 0.02, 0.02, 0.02, -0.03, nLong),
    ptsL: ringY(y, rx, rzF, rzB, cz, nLong, 2.2),
    skin: y > 1.56 ? [BONE.HEAD, BONE.HEAD, 0] : y > 1.47 ? [BONE.HEAD, BONE.CHEST, 0.4] : [BONE.HEAD, BONE.CHEST, 0.8],
    axis: null
  }));
  B.loft(longRows, PART.LONG_HAIR, { capEnd: true });

  // Shoes, heel to toe (the toes bend at the ball of the foot)
  SIDES.forEach((side, k) => {
    const rows = SHOE.filter((r) => keep(r, 4)).map(([z, hw, top, sole]) => ({
      pts: shoeRing(side * HIP_X, z, hw, top, sole, nShoe),
      ptsF: shoeRing(side * HIP_X, z * 0.93, hw * 0.88, top * 0.92, sole, nShoe),
      skin: shoeSkin(z, k),
      axis: null
    }));
    B.loft(rows, PART.SHOE, { capStart: true, capEnd: true });
  });

  const geo = B.build();
  _geometryCache.set(detail, geo);
  return geo;
}

// ============================================================================
// 3. TSL MATERIAL: GPU SKINNING + PROCEDURAL CLOTHES
// ============================================================================
const COAT_COLORS = [0x2b3a52, 0x33332f, 0x8a6a44, 0x5a2f2f, 0x4f5238, 0x6a6a66, 0x222024, 0x7d3f22];
const COAT_COLORS_F = [0x7a2630, 0xb89a72, 0x2e3e5c, 0x1f1d22, 0xc9c1b2, 0x5b6b4a, 0x8c5a7a, 0x3c3c40];
const SHIRT_COLORS = [0xe8e6e0, 0xb8c4d8, 0xcfc8b8, 0x9aa7b8];
const LEG_COLORS = [0x22242c, 0x35485b, 0x51473d, 0x7c7160, 0x252526];
const LEG_COLORS_F = [0x1c1c22, 0x2f4a6e, 0x46413b, 0xcfc8bb, 0x5a2a2e];
const SKIN_COLORS = [0xc68863, 0xa96f4c, 0x8a5535, 0x6b3d24, 0xd9a077];
const HAIR_COLORS = [0x1a1512, 0x3a2a1a, 0x584022, 0x6e6862, 0x2a2624, 0x8f6d43, 0x5e3020];

// Branchless TSL palette selector from an array of hex colors and a [0..1) hash value
function pickColorFromPalette(hexArray, tNode) {
  const n = hexArray.length;
  const scaled = tNode.mul(n);
  let acc = color(hexArray[0]);
  for (let i = 1; i < n; i++) {
    acc = mix(acc, color(hexArray[i]), step(float(i), scaled));
  }
  return acc;
}

// v rotated by unit quaternion q
const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0));

/**
 * Material for one crowd mesh. `pose` is its storage buffer (STRIDE vec4s per instance). The vertex stage morphs the
 * bind pose (girth, female, hair) and skins it with two bones; the fragment stage dresses the person from their seed:
 * skin tone, hair & hairline, eyes, brows & mouth, a tailored jacket (lapels, shirt V) or casual coat (zip, hem,
 * collar), cuffs, trousers, sneakers or leather shoes with soles & laces.
 */
function createPersonMaterial(pose) {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  const base = int(instanceIndex).mul(STRIDE);
  const info = pose.element(base.add(STRIDE - 1)); // seed, female, girth, hair

  mat.positionNode = Fn(() => {
    const skin = attribute('skin', 'vec4');
    const extra = attribute('extra', 'vec3');
    // hair volume on the shell (part 6), hair length on the long hair (part 7)
    const hairAmount = mix(clamp(info.w.mul(2.0), 0.0, 1.0), clamp(info.w.mul(2.0).sub(1.0), 0.0, 1.0), step(PART.LONG_HAIR - 0.5, skin.w));
    const p = attribute('position', 'vec3')
      .add(vec3(extra.x, 0.0, extra.y).mul(info.z.sub(1.0)))
      .add(attribute('femaleDelta', 'vec3').mul(info.y))
      .add(attribute('hairDelta', 'vec3').mul(hairAmount));
    const n = attribute('normal', 'vec3');
    const w = skin.z;
    const ia = base.add(int(skin.x).mul(2));
    const ib = base.add(int(skin.y).mul(2));
    const qa = pose.element(ia);
    const ta = pose.element(ia.add(1));
    const qb = pose.element(ib);
    const tb = pose.element(ib.add(1));
    normalLocal.assign(normalize(mix(qrot(qa, n), qrot(qb, n), w)));
    return mix(qrot(qa, p).mul(ta.w).add(ta.xyz), qrot(qb, p).mul(tb.w).add(tb.xyz), w);
  })();

  const vInfo = varying(info, 'vPersonInfo');
  const isPart = (partId, id) => step(abs(partId.sub(id)), 0.25);
  const lane = (salt) => fract(sin(vInfo.x.add(salt).mul(12.9898)).mul(43758.5453));
  const partOf = () => attribute('skin', 'vec4').w;

  mat.colorNode = Fn(() => {
    const partId = partOf();
    const female = vInfo.y;
    const q = attribute('position', 'vec3').toVar();
    const along = attribute('extra', 'vec3').z;

    const skinCol = pickColorFromPalette(SKIN_COLORS, lane(17.0)).toVar();
    const hairCol = pickColorFromPalette(HAIR_COLORS, lane(3.0)).toVar();
    const coatCol = mix(pickColorFromPalette(COAT_COLORS, lane(29.0)), pickColorFromPalette(COAT_COLORS_F, lane(29.0)), female).toVar();
    const shirtCol = pickColorFromPalette(SHIRT_COLORS, lane(71.0)).toVar();
    const legsCol = mix(pickColorFromPalette(LEG_COLORS, lane(47.0)), pickColorFromPalette(LEG_COLORS_F, lane(47.0)), female);

    // Head: skin, hairline (none for the bald), eyes, brows, lips
    const hd = normalize(vec2(q.x, q.z.add(0.01)));
    const bald = step(lane(41.0), 0.08).mul(float(1.0).sub(female));
    const hairline = hd.y.mul(0.055).add(1.62).sub(hd.x.mul(hd.x).sub(hd.y.mul(hd.y)).mul(0.005)).add(bald.mul(0.3));
    const hairMask = smoothstep(hairline.sub(0.004), hairline.add(0.004), q.y);
    const front = smoothstep(0.06, 0.08, q.z);
    const eyeX = abs(abs(q.x).sub(0.031));
    const eyes = smoothstep(0.011, 0.006, eyeX).mul(smoothstep(0.0055, 0.002, abs(q.y.sub(1.627)))).mul(front);
    const brows = smoothstep(0.016, 0.01, eyeX).mul(smoothstep(0.0035, 0.0012, abs(q.y.sub(1.646)))).mul(front);
    const mouth = smoothstep(0.022, 0.014, abs(q.x)).mul(smoothstep(0.0045, 0.0015, abs(q.y.sub(1.549)))).mul(front);
    const faceCol = mix(
      skinCol.mul(float(1.0).sub(eyes.mul(0.7)).sub(brows.mul(0.45))),
      skinCol.mul(color(0xb06a5c)).mul(1.15),
      mouth.mul(0.7)
    );
    const headCol = mix(faceCol, hairCol, hairMask);
    const hairStrands = hairCol.mul(sin(q.x.mul(170.0).add(q.z.mul(130.0))).mul(0.06).add(0.97));
    const hairPartCol = mix(hairStrands, skinCol, bald.mul(step(q.y, 1.755)));

    // Torso: collar & neck, tailored jacket (lapels, shirt V) or casual coat (zip, collar band), hem, trousers below
    const tailored = step(0.42, lane(89.0));
    const hemY = mix(mix(0.955, 1.0, lane(61.0)), mix(0.88, 1.0, lane(61.0)), female);
    const chestFront = smoothstep(0.035, 0.075, q.z);
    const opening = q.y.sub(1.33).mul(0.42);
    const shirtV = smoothstep(1.33, 1.35, q.y).mul(smoothstep(0.004, 0.0, abs(q.x).sub(opening))).mul(chestFront).mul(tailored);
    const lapel = smoothstep(0.024, 0.009, abs(abs(q.x).sub(opening)))
      .mul(smoothstep(1.32, 1.37, q.y))
      .mul(chestFront)
      .mul(tailored)
      .mul(float(1.0).sub(shirtV));
    const zip = smoothstep(0.006, 0.0025, abs(q.x)).mul(chestFront).mul(float(1.0).sub(tailored));
    const collarBand = smoothstep(1.455, 1.48, q.y).mul(float(1.0).sub(tailored));
    const neckLine = mix(1.5, 1.49, tailored);
    const neck = smoothstep(neckLine.sub(0.004), neckLine.add(0.004), q.y);
    const hem = smoothstep(hemY.sub(0.004), hemY.add(0.004), q.y);
    const hemShade = smoothstep(hemY.add(0.035), hemY, q.y).mul(0.12);
    const jacketCol = mix(
      coatCol.mul(float(1.0).sub(lapel.mul(0.25)).sub(zip.mul(0.4)).sub(collarBand.mul(0.15)).sub(hemShade)),
      shirtCol,
      shirtV
    );
    const torsoCol = mix(mix(legsCol, jacketCol, hem), skinCol, neck);

    // Sleeves: cuffs (shirt cuff under a tailored jacket)
    const cuff = smoothstep(0.93, 0.96, along);
    const sleeveCol = mix(coatCol, mix(coatCol.mul(0.72), shirtCol, tailored), cuff);

    // Trousers: subtle front crease
    const crease = smoothstep(0.004, 0.0, abs(abs(q.x).sub(HIP_X))).mul(step(0.0, q.z)).mul(0.08);
    const trouserCol = legsCol.mul(float(1.0).sub(crease));

    // Shoes: sneakers or leather, soles, laces over the instep
    const sneaker = step(0.4, lane(5.0));
    const leatherCol = mix(color(0x201e1c), color(0x4a3524), lane(23.0));
    const sneakerCol = mix(color(0x252b32), color(0xc8c3b8), step(0.55, lane(31.0)));
    const upperCol = mix(leatherCol, sneakerCol, sneaker);
    const sole = smoothstep(0.024, 0.016, q.y);
    const soleCol = mix(color(0x191816), color(0xd5d1c8), sneaker);
    const laceCoord = q.z.mul(80.0);
    const laces = smoothstep(0.6, 0.75, fract(laceCoord))
      .mul(step(abs(abs(q.x).sub(HIP_X)), 0.016))
      .mul(step(0.0, q.z))
      .mul(step(q.z, 0.09))
      .mul(step(0.075, q.y))
      .mul(sneaker);
    const shoeCol = mix(mix(upperCol, soleCol, sole), color(0xb8b4aa), laces.mul(0.6));

    return mix(
      mix(
        mix(
          mix(
            mix(mix(torsoCol, trouserCol, isPart(partId, PART.LEG)), shoeCol, isPart(partId, PART.SHOE)),
            sleeveCol,
            isPart(partId, PART.ARM)
          ),
          skinCol,
          isPart(partId, PART.HAND)
        ),
        headCol,
        isPart(partId, PART.HEAD)
      ),
      hairPartCol,
      step(PART.HAIR - 0.5, partId)
    );
  })();

  mat.roughnessNode = Fn(() => {
    const partId = partOf();
    const skin = max(isPart(partId, PART.HAND), isPart(partId, PART.HEAD));
    const leather = isPart(partId, PART.SHOE).mul(step(lane(5.0), 0.4));
    return mix(mix(mix(float(0.86), float(0.55), skin), float(0.74), step(PART.HAIR - 0.5, partId)), float(0.38), leather);
  })();

  return mat;
}

// ============================================================================
// 4. CROWD: ONE INSTANCED, SKINNED DRAW PER LEVEL OF DETAIL
// ============================================================================
class PersonCrowd {
  /**
   * @param {number} maxCount - most people drawn at once
   * @param {{ farDistance?: number, castShadow?: boolean }} options - beyond farDistance (m) people use the far LOD
   */
  constructor(maxCount, { farDistance = 34, castShadow = true } = {}) {
    this.farDistance = farDistance;
    this.lods = [1, 0].map((detail) => {
      const pose = attributeArray(maxCount * STRIDE, 'vec4').toReadOnly();
      const mesh = new THREE.InstancedMesh(buildPersonGeometry(detail), createPersonMaterial(pose), maxCount);
      mesh.name = detail ? 'PeopleNear' : 'PeopleFar';
      mesh.count = 1; // one (degenerate) person until the first frame, so the pipelines compile up front
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      return { pose, mesh, count: 0, max: maxCount };
    });
    this.meshes = this.lods.map((l) => l.mesh);
  }

  begin() {
    for (const l of this.lods) l.count = 0;
  }

  add(rig, distance = 0) {
    const l = this.lods[distance > this.farDistance ? 1 : 0];
    if (l.count >= l.max) return;
    l.pose.value.array.set(rig.pose, l.count * STRIDE * 4);
    l.count++;
  }

  end() {
    for (const l of this.lods) {
      l.mesh.count = l.count;
      if (l.count === 0) continue;
      const attr = l.pose.value;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, l.count * STRIDE * 4);
      attr.needsUpdate = true;
    }
  }
}

// ============================================================================
// 5. PERSON RIG: PLANTED FOOTSTEPS, TWO-BONE IK & A GAIT THAT FOLLOWS THE FEET
// ============================================================================
const GAIT = {
  dutyWalk: 0.6, // share of the gait cycle each foot spends on the ground (a walk always has a foot down)
  dutyRun: 0.29, // ...and running (both feet off the ground in between)
  minCadence: 0.95, // gait cycles per second stepping on the spot
  startCadence: 0.72,
  turnRate: 3.4, // rad/s
  spread: 0.074, // each foot's distance from the line of travel
  toeOut: 0.09,
  heelStrike: -0.26, // foot pitch at heel strike (toes up) and toe-off (heel up)
  toeOff: 0.72,
  heelRoll: 0.14, // share of the stance spent rolling onto the sole, and when the heel comes up
  heelOff: 0.5
};
const HEEL = new THREE.Vector3(0, -ANKLE_H, -0.07); // heel contact, from the ankle
const TOE_JOINT = new THREE.Vector3(0, 0.02 - ANKLE_H, 0.135);

const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qPelvis = new THREE.Quaternion();
const _qChest = new THREE.Quaternion();
const _qUpper = new THREE.Quaternion();
const _qRoot = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pelvis = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _front = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _rootPos = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const qX = (out, a) => out.setFromAxisAngle(AX, a);
const qY = (out, a) => out.setFromAxisAngle(AY, a);
const qZ = (out, a) => out.setFromAxisAngle(AZ, a);

function makeFoot(side) {
  return {
    side,
    swing: false,
    // planted: ground point under the ankle (foot flat), heading
    px: 0, py: 0, pz: 0, yaw: 0,
    // current ankle, foot pitch (+ heel up), toe bend (relative), ground contact 0..1
    ax: 0, ay: 0, az: 0, pitch: 0, toe: 0, contact: 1,
    // lift-off state and landing target during a swing
    w: 0, lx: 0, ly: 0, lz: 0, lyaw: 0, lpitch: 0, ltoe: 0, lground: 0,
    tx: 0, ty: 0, tz: 0, tyaw: 0
  };
}

class PersonRig {
  /**
   * @param {object} o - seed (dresses them), scale (height / 1.75 m), female, girth (build, ~0.9-1.15),
   *   hair (0 short .. 0.5 voluminous .. 1 long), armSwing & stride (gait personality, ~1)
   */
  constructor({ seed = 0, scale = 1, female = false, girth = 1, hair = 0.2, armSwing = 1, stride = 1 } = {}) {
    this.seed = seed;
    this.s = scale;
    this.female = female ? 1 : 0;
    this.girth = girth;
    this.hair = hair;
    this.armSwing = armSwing;
    this.stride = stride;
    this.bind = BIND[this.female];
    this.placed = false;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.gait = 0; // how much of the walking motion shows (0 standing .. 1 walking)
    this.run = 0;
    this.phase = 0.05;
    this.pelvisY = 0;
    this.sway = 0;
    this.air = 0;
    this.time = seed * 7.3;
    this.feet = [makeFoot(1), makeFoot(-1)];
    this.pose = new Float32Array(STRIDE * 4);
    this.pose.set([seed, this.female, girth, hair], (STRIDE - 1) * 4);
  }

  get legLength() {
    return (THIGH + SHIN) * this.s;
  }

  // Standing still at (x, z) facing yaw, feet side by side on the ground
  reset(x, z, yaw, ground, owner = null) {
    const s = this.s;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.speed = 0;
    this.gait = this.run = this.sway = this.air = 0;
    this.phase = 0.05;
    for (const foot of this.feet) {
      this.restPoint(foot, x, z, yaw, _v);
      foot.px = _v.x;
      foot.pz = _v.z;
      foot.py = ground(owner, _v.x, _v.z);
      foot.yaw = yaw + foot.side * GAIT.toeOut;
      foot.swing = false;
      foot.pitch = foot.toe = 0;
      foot.contact = 1;
      this.footAnkle(foot, 0, HEEL);
    }
    this.pelvisY = (this.feet[0].py + this.feet[1].py) * 0.5 + ANKLE_H * s + this.legLength * 0.997 + (PELVIS_Y - HIP_Y) * s;
    this.placed = true;
    this.solve();
  }

  restPoint(foot, x, z, yaw, out) {
    const d = foot.side * GAIT.spread * this.s;
    return out.set(x + Math.cos(yaw) * d, 0, z - Math.sin(yaw) * d);
  }

  // Ankle of a foot planted at (px, py, pz) heading foot.yaw, pitched by `pitch` about `pivot` (heel or toe joint)
  footAnkle(foot, pitch, pivot) {
    const s = this.s;
    const sn = Math.sin(foot.yaw);
    const cs = Math.cos(foot.yaw);
    const pyl = pivot.y * s;
    const pzl = pivot.z * s;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const vy = -pyl * cp + pzl * sp;
    const vz = -pyl * sp - pzl * cp;
    foot.ax = foot.px + sn * (pzl + vz);
    foot.ay = foot.py + pyl + ANKLE_H * s + vy;
    foot.az = foot.pz + cs * (pzl + vz);
    foot.pitch = pitch;
  }

  /**
   * Walk the body to ground position (x, z), turning towards `heading`. `ground(owner, x, z)` gives the walking
   * surface's height anywhere around. `air` lifts the body off the ground (jumps). Set `updatePose` false for hidden
   * pedestrians: their gait and planted feet still advance, while bone transforms wait until they are drawn.
   */
  update(dt, x, z, heading, ground, owner = null, air = 0, updatePose = true) {
    if (!this.placed || Math.hypot(x - this.x, z - this.z) > 3) {
      this.reset(x, z, heading, ground, owner);
      return;
    }
    dt = Math.min(Math.max(dt, 1e-4), 0.1);
    const s = this.s;
    this.time += dt;

    // Body velocity (smoothed) and heading
    const kv = 1 - Math.exp(-dt / 0.1);
    this.vx += ((x - this.x) / dt - this.vx) * kv;
    this.vz += ((z - this.z) / dt - this.vz) * kv;
    this.x = x;
    this.z = z;
    const speed = (this.speed = Math.hypot(this.vx, this.vz));
    const yawErr = wrap(heading - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-GAIT.turnRate * dt, Math.min(GAIT.turnRate * dt, yawErr)));
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwdSpeed = this.vx * sinY + this.vz * cosY;

    this.gait += (Math.min(1, speed / 0.9) - this.gait) * (1 - Math.exp(-dt / 0.22));
    this.run += (smooth(2.3, 3.6, speed) - this.run) * (1 - Math.exp(-dt / 0.3));
    const run = this.run;
    const duty = lerp(GAIT.dutyWalk, GAIT.dutyRun - 0.07 * smooth(4.5, 8, speed), run);

    // Airborne (jumping): legs tuck under the body, feet land wherever they come down
    this.air += (air - this.air) * (1 - Math.exp(-dt / 0.04));
    if (air > 0.03) {
      for (const foot of this.feet) {
        this.restPoint(foot, x, z, this.yaw, _v);
        foot.swing = false;
        foot.px = _v.x;
        foot.pz = _v.z;
        foot.py = ground(owner, _v.x, _v.z) + air * 0.85 + 0.04 * s;
        foot.yaw = this.yaw + foot.side * GAIT.toeOut;
        foot.contact = 0;
        this.footAnkle(foot, 0.25, HEEL);
        foot.toe = 0;
      }
      this.pelvisY = ground(owner, x, z) + air + ANKLE_H * s + this.legLength * 0.97 + (PELVIS_Y - HIP_Y) * s;
      if (updatePose) this.solve();
      return;
    }

    // Cadence: the walking gait cycle shortens with speed (step length ~0.61 v^0.57 m); running ~1.5 cycles/s jogging,
    // ~2 sprinting
    const moving = speed > 0.08;
    let f = 0;
    if (moving) {
      const walkF = Math.pow(speed, 0.43) / (1.22 * s * this.stride);
      const runF = (1.3 + 0.13 * (speed - 3)) / Math.sqrt(s);
      f = Math.max(GAIT.startCadence, lerp(walkF, runF, run));
    } else {
      let unsettled = Math.abs(yawErr) > 0.12;
      for (const foot of this.feet) {
        this.restPoint(foot, x, z, this.yaw, _v);
        if (Math.hypot(foot.px - _v.x, foot.pz - _v.z) > 0.07 * s) unsettled = true;
        if (Math.abs(wrap(foot.yaw - this.yaw - foot.side * GAIT.toeOut)) > 0.25) unsettled = true;
        if (foot.swing) unsettled = true;
      }
      if (unsettled) f = GAIT.minCadence;
    }
    if (Math.abs(yawErr) > 0.12) f = Math.max(f, GAIT.minCadence);

    // Advance the cycle: feet lift off when their phase passes the duty factor, land when it wraps
    const prev = this.phase;
    this.phase = (this.phase + f * dt) % 1;
    const tSwing = f > 0 ? (1 - duty) / f : 0.4;
    const tStance = f > 0 ? duty / f : 0.6;
    const landFrac = lerp(0.33, 0.33, run); // feet land a third of the stance's travel ahead of the hips
    const g = this.gait;

    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i];
      const off = i === 0 ? 0 : 0.5;
      const lp0 = (prev + off) % 1;
      const lp = (this.phase + off) % 1;
      if (f > 0 && foot.swing && lp < lp0) {
        // touch down on the target
        foot.swing = false;
        foot.px = foot.tx;
        foot.py = foot.ty;
        foot.pz = foot.tz;
        foot.yaw = foot.tyaw;
      } else if (f > 0 && !foot.swing && lp >= duty && lp >= lp0) {
        // lift off
        foot.swing = true;
        foot.lx = foot.ax;
        foot.ly = foot.ay;
        foot.lz = foot.az;
        foot.lyaw = foot.yaw;
        foot.lpitch = foot.pitch;
        foot.ltoe = foot.toe;
        foot.lground = foot.py;
      }

      if (foot.swing) {
        const w = (foot.w = clamp01((lp - duty) / (1 - duty)));
        // Where to land: under the hips' future position, ahead by the share of the next stance's travel
        const tRem = (1 - w) * tSwing;
        const yawPred = this.yaw + Math.max(-GAIT.turnRate * tRem, Math.min(GAIT.turnRate * tRem, wrap(heading - this.yaw)));
        const sn = Math.sin(yawPred);
        const cs = Math.cos(yawPred);
        const lead = fwdSpeed * tStance * landFrac;
        const lat = foot.side * GAIT.spread * s;
        foot.tx = x + this.vx * tRem + sn * lead + cs * lat;
        foot.tz = z + this.vz * tRem + cs * lead - sn * lat;
        foot.ty = ground(owner, foot.tx, foot.tz);
        foot.tyaw = yawPred + foot.side * GAIT.toeOut;

        // Landing pose (heel strike), then the swing from the lift-off pose to it
        const sx = foot.px, sy = foot.py, sz = foot.pz, syaw = foot.yaw;
        foot.px = foot.tx;
        foot.py = foot.ty;
        foot.pz = foot.tz;
        foot.yaw = foot.tyaw;
        const strike = GAIT.heelStrike * g * (1 - run * 0.5);
        this.footAnkle(foot, strike, HEEL);
        const ex = foot.ax, ey = foot.ay, ez = foot.az;
        foot.px = sx;
        foot.py = sy;
        foot.pz = sz;
        foot.yaw = syaw;

        const e = lerp(w * w * (3 - 2 * w), smooth(0.12, 1, w), run);
        const stepLen = Math.hypot(ex - foot.lx, ez - foot.lz);
        // foot clearance; running, the heel flicks up behind early in the swing
        const clearance =
          (0.03 + 0.055 * Math.min(1, stepLen / (0.9 * s))) * s * (1 - run) + run * 0.3 * s + Math.max(0, foot.ty - foot.lground) * 1.15;
        const bump = lerp(Math.sin(Math.PI * w) * (1.12 - 0.3 * w), Math.sin(Math.PI * Math.pow(w, 0.6)), run);
        foot.ax = lerp(foot.lx, ex, e);
        foot.ay = lerp(foot.ly, ey, e) + clearance * bump;
        foot.az = lerp(foot.lz, ez, e);
        foot.pitch = foot.lpitch * (1 - smooth(0, 0.5, w)) + strike * smooth(0.35, 1, w) - 0.12 * g * Math.sin(Math.PI * w) * (1 - run);
        foot.toe = foot.ltoe * (1 - smooth(0, 0.3, w));
        foot.swingYaw = foot.lyaw + wrap(foot.tyaw - foot.lyaw) * e;
        foot.contact = Math.max(0.25 * (1 - smooth(0, 0.2, w)), smooth(0.82, 1, w));
      } else {
        // Stance: roll onto the sole, then up onto the toes (handing the body's weight over to the other foot)
        const u = clamp01(lp / duty);
        let pitch = 0;
        let pivot = HEEL;
        if (u < GAIT.heelRoll) {
          const t = 1 - u / GAIT.heelRoll;
          pitch = GAIT.heelStrike * g * (1 - run * 0.5) * t * t;
        } else if (u > GAIT.heelOff) {
          const t = (u - GAIT.heelOff) / (1 - GAIT.heelOff);
          pitch = GAIT.toeOff * g * Math.pow(t, 1.6);
          pivot = TOE_JOINT;
        }
        this.footAnkle(foot, pitch, pivot);
        foot.toe = pitch > 0 ? -pitch : 0;
        foot.swingYaw = foot.yaw;
        // running, a foot carries the body only until mid-stance; behind the hips the leg just pushes off
        foot.contact = 1 - 0.75 * smooth(lerp(GAIT.heelOff, 0.3, run), lerp(1, 0.62, run), u) * Math.max(g, run);
        foot.stance = Math.sin(Math.PI * u);
      }
      if (foot.swing) foot.stance = 0;
    }

    // Pelvis: as high as the planted legs reach, never above a slightly bent standing height; sways over the foot
    // carrying the weight
    const left = this.feet[0];
    const right = this.feet[1];
    const zl = (left.ax - x) * sinY + (left.az - z) * cosY;
    const zr = (right.ax - x) * sinY + (right.az - z) * cosY;
    const spreadF = (zl - zr) / s; // > 0 with the left foot ahead
    const latL = (left.ax - x) * cosY - (left.az - z) * sinY;
    const latR = (right.ax - x) * cosY - (right.az - z) * sinY;
    const cSum = left.contact + right.contact;
    const swayTarget = cSum > 0.01 ? ((left.contact * latL + right.contact * latR) / cSum) * 0.42 * g * (1 - run * 0.6) : 0;
    this.sway += (swayTarget - this.sway) * (1 - Math.exp(-dt / 0.12));

    this.pelvisYaw = Math.max(-0.13, Math.min(0.13, -0.13 * spreadF * g));
    this.pelvisRoll = 0.045 * g * (left.contact - right.contact) * (1 - run * 0.5);
    this.pelvisTilt = 0.035 + 0.035 * g + 0.12 * run;
    this.spreadF = spreadF;
    this.setPelvisRotation();

    const groundAvg = cSum > 0.01 ? (left.contact * left.py + right.contact * right.py) / cSum : (left.py + right.py) * 0.5;
    const bend = lerp(lerp(0.997, 0.989, g), 0.965, run); // knees all but straight standing, ~15 degrees at mid-stance
    // running: the legs give under the landing (lowest at mid-stance), the body floats between steps
    const compress = run * s * (0.075 * Math.max(left.stance || 0, right.stance || 0) - 0.015);
    let target = groundAvg + ANKLE_H * s + this.legLength * bend + (PELVIS_Y - HIP_Y) * s - compress;
    const reach = this.legLength * 0.997;
    const hard = [Infinity, Infinity];
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i];
      this.hipOffset(i, _v);
      const hx = x + cosY * this.sway + _v.x;
      const hz = z - sinY * this.sway + _v.z;
      const d = Math.hypot(foot.ax - hx, foot.az - hz);
      const top = foot.ay + Math.sqrt(Math.max(0, reach * reach - d * d)) - _v.y;
      if (foot.contact > 0.97) hard[i] = top;
      target = Math.min(target, top + (1 - foot.contact) * lerp(0.35, 1.5, run));
    }
    this.pelvisY += (target - this.pelvisY) * (1 - Math.exp(-dt / 0.045));
    this.pelvisY = Math.min(this.pelvisY, hard[0], hard[1]);
    if (updatePose) this.solve();
  }

  setPelvisRotation() {
    qY(_qPelvis, this.yaw + this.pelvisYaw);
    _qPelvis.multiply(qZ(_q, this.pelvisRoll)).multiply(qX(_q, this.pelvisTilt));
  }

  // Hip joint relative to the pelvis joint (out.y < 0: the hips are below it)
  hipOffset(i, out) {
    const j = this.bind;
    return out.copy(j[LIMB.thigh[i]]).sub(j[BONE.PELVIS]).multiplyScalar(this.s).applyQuaternion(_qPelvis);
  }

  writeBone(b, q, p) {
    const s = this.s;
    _v2.copy(this.bind[b]).applyQuaternion(q).multiplyScalar(s);
    const o = b * 8;
    const a = this.pose;
    a[o] = q.x;
    a[o + 1] = q.y;
    a[o + 2] = q.z;
    a[o + 3] = q.w;
    a[o + 4] = p.x - _v2.x;
    a[o + 5] = p.y - _v2.y;
    a[o + 6] = p.z - _v2.z;
    a[o + 7] = s;
  }

  // Bone rotation whose +Y points `up` (from the child joint to this one) and +Z towards `front`
  basis(up, front, out) {
    _by.copy(up).normalize();
    _bz.copy(front).addScaledVector(_by, -front.dot(_by));
    if (_bz.lengthSq() < 1e-8) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
    _bz.normalize();
    _bx.crossVectors(_by, _bz);
    _m.makeBasis(_bx, _by, _bz);
    return out.setFromRotationMatrix(_m);
  }

  // Two-bone leg IK from the hip to the ankle target, knee towards the foot's heading
  solveLeg(i, hip, ankleTarget, footYaw) {
    const s = this.s;
    const l1 = THIGH * s;
    const l2 = SHIN * s;
    _v.subVectors(ankleTarget, hip);
    let dist = _v.length();
    const dn = _v.divideScalar(dist || 1);
    dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min((l1 + l2) * 0.9999, dist));
    _pole.set(Math.sin(footYaw) + Math.sin(this.yaw), 0, Math.cos(footYaw) + Math.cos(this.yaw));
    _pole.addScaledVector(dn, -_pole.dot(dn));
    if (_pole.lengthSq() < 1e-8) _pole.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _pole.normalize();
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _knee.copy(hip).addScaledVector(dn, l1 * cosA).addScaledVector(_pole, l1 * sinA);
    _ankle.copy(hip).addScaledVector(dn, dist);
    this.reachError = Math.max(this.reachError || 0, _ankle.distanceTo(ankleTarget));
    if (this.feet[i].contact > 0.97) this.stanceReachError = Math.max(this.stanceReachError || 0, _ankle.distanceTo(ankleTarget));
    const front = _front.set(Math.sin(footYaw), 0, Math.cos(footYaw)).add(_pole);
    this.writeBone(LIMB.thigh[i], this.basis(_v2.subVectors(hip, _knee), front, _q), hip);
    this.writeBone(LIMB.shin[i], this.basis(_v2.subVectors(_knee, _ankle), front, _q), _knee);
    return _ankle;
  }

  // Bones of the whole body from the feet, pelvis and gait state (world space)
  solve() {
    const s = this.s;
    const j = this.bind;
    const g = this.gait;
    const run = this.run;
    const yaw = this.yaw;
    if (this.pelvisYaw === undefined) {
      this.pelvisYaw = this.pelvisRoll = 0;
      this.pelvisTilt = 0.035;
      this.spreadF = 0;
    }
    this.setPelvisRotation();
    _pelvis.set(this.x + Math.cos(yaw) * this.sway, this.pelvisY, this.z - Math.sin(yaw) * this.sway);
    this.writeBone(BONE.PELVIS, _qPelvis, _pelvis);

    // Chest counter-rotates against the pelvis, leans into the walk; the head stays level, looking ahead
    const idle = 1 - g;
    const breathe = Math.sin(this.time * 1.7) * 0.008 * idle;
    _qChest.copy(_qPelvis)
      .multiply(qY(_q, -1.75 * this.pelvisYaw))
      .multiply(qX(_q, 0.015 + 0.03 * g + 0.14 * run + breathe))
      .multiply(qZ(_q, -0.8 * this.pelvisRoll));
    _chest.copy(j[BONE.CHEST]).sub(j[BONE.PELVIS]).multiplyScalar(s).applyQuaternion(_qPelvis).add(_pelvis);
    this.writeBone(BONE.CHEST, _qChest, _chest);

    const look = Math.sin(this.time * 0.37 + this.seed) * 0.25 * idle * idle;
    qY(_qa, yaw + look).multiply(qX(_q, 0.05 - 0.1 * run));
    _v.copy(j[BONE.HEAD]).sub(j[BONE.CHEST]).multiplyScalar(s).applyQuaternion(_qChest).add(_chest);
    this.writeBone(BONE.HEAD, _qa, _v);

    // Arms swing against the legs (elbows bend more on the forward swing, ~90 degrees running)
    const swingAmp = 0.42 * this.armSwing * g * (1 + run * 0.6);
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const flex = 0.06 - side * this.spreadF * swingAmp + idle * 0.02;
      const abduction = 0.1 + (this.girth - 1) * 0.35 + run * 0.08;
      _shoulder.copy(j[LIMB.upperArm[i]]).sub(j[BONE.CHEST]).multiplyScalar(s).applyQuaternion(_qChest).add(_chest);
      _qUpper.copy(_qChest).multiply(qZ(_q, side * (abduction - ARM_BIND_ABDUCTION))).multiply(qX(_q, -flex));
      this.writeBone(LIMB.upperArm[i], _qUpper, _shoulder);
      const elbow = 0.2 + 0.55 * Math.max(0, flex) + 0.1 * g + run * 1.05;
      _v.copy(j[LIMB.forearm[i]]).sub(j[LIMB.upperArm[i]]).multiplyScalar(s).applyQuaternion(_qUpper).add(_shoulder);
      _q2.copy(_qUpper).multiply(qX(_q, -elbow));
      this.writeBone(LIMB.forearm[i], _q2, _v);
    }

    // Legs: IK to the ankles, then the feet & toes
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i];
      const footYaw = foot.swing ? foot.swingYaw : foot.yaw;
      _hip.copy(j[LIMB.thigh[i]]).sub(j[BONE.PELVIS]).multiplyScalar(s).applyQuaternion(_qPelvis).add(_pelvis);
      _target.set(foot.ax, foot.ay, foot.az);
      const ankle = this.solveLeg(i, _hip, _target, footYaw);
      qY(_qa, footYaw).multiply(qX(_q, foot.pitch));
      this.writeBone(LIMB.foot[i], _qa, ankle);
      _v.copy(j[LIMB.toe[i]]).sub(j[LIMB.foot[i]]).multiplyScalar(s).applyQuaternion(_qa).add(ankle);
      qY(_q2, footYaw).multiply(qX(_q, foot.pitch + foot.toe));
      this.writeBone(LIMB.toe[i], _q2, _v);
    }
  }

  /**
   * Riding a bicycle: `root` (Object3D) is the bike frame (pose in its parent's space, e.g. the scene), `crank` the
   * pedal crank angle. Seat, bars and bottom bracket in the frame's space (metres, +Z forward).
   */
  ride(root, crank, { seat, bars, gripHalf = 0.22, bracket, crankLength = 0.17 }) {
    const s = this.s;
    const j = this.bind;
    this.gait = 0;
    this.run = 0;
    root.updateWorldMatrix(true, false);
    root.matrixWorld.decompose(_rootPos, _qRoot, _v);
    const toWorld = (local) => local.applyQuaternion(_qRoot).add(_rootPos);

    // Pelvis on the saddle, leaning forward; chest further forward, head up looking ahead
    qX(_qPelvis, 0.42).premultiply(_qRoot);
    _pelvis.set(0, seat.y + 0.055 * s, seat.z + 0.03);
    toWorld(_pelvis);
    this.writeBone(BONE.PELVIS, _qPelvis, _pelvis);
    _qChest.copy(_qPelvis).multiply(qX(_q, 0.2));
    _chest.copy(j[BONE.CHEST]).sub(j[BONE.PELVIS]).multiplyScalar(s).applyQuaternion(_qPelvis).add(_pelvis);
    this.writeBone(BONE.CHEST, _qChest, _chest);
    _qa.copy(_qRoot).multiply(qX(_q, -0.12));
    _v.copy(j[BONE.HEAD]).sub(j[BONE.CHEST]).multiplyScalar(s).applyQuaternion(_qChest).add(_chest);
    this.writeBone(BONE.HEAD, _qa, _v);
    this.headPosition = (this.headPosition || new THREE.Vector3()).copy(_v);
    this.headQuaternion = (this.headQuaternion || new THREE.Quaternion()).copy(_qa);

    // Hands on the grips (two-bone arm IK, elbows out & down), feet on the pedals (leg IK, knees over the feet)
    _fwd.set(0, 0, 1).applyQuaternion(_qRoot);
    this.yaw = Math.atan2(_fwd.x, _fwd.z);
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      _shoulder.copy(j[LIMB.upperArm[i]]).sub(j[BONE.CHEST]).multiplyScalar(s).applyQuaternion(_qChest).add(_chest);
      _target.set(side * gripHalf, bars.y + 0.02, bars.z - 0.07);
      toWorld(_target);
      const l1 = UPPER_ARM * s;
      const l2 = (FOREARM + 0.07) * s;
      _v.subVectors(_target, _shoulder);
      let dist = _v.length();
      const dn = _v.divideScalar(dist || 1);
      dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min((l1 + l2) * 0.999, dist));
      _pole.set(side * 0.6, -1, -0.4).applyQuaternion(_qRoot);
      _pole.addScaledVector(dn, -_pole.dot(dn)).normalize();
      const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      _knee.copy(_shoulder).addScaledVector(dn, l1 * cosA).addScaledVector(_pole, l1 * sinA);
      _ankle.copy(_shoulder).addScaledVector(dn, dist);
      // Bind arms point down & slightly out; their +Z (front) is kept towards the bike's front
      this.basis(_v2.subVectors(_shoulder, _knee), _fwd, _qUpper);
      _qUpper.multiply(qZ(_q, -side * ARM_BIND_ABDUCTION));
      this.writeBone(LIMB.upperArm[i], _qUpper, _shoulder);
      this.basis(_v2.subVectors(_knee, _ankle), _fwd, _q2);
      _q2.multiply(qZ(_q, -side * ARM_BIND_ABDUCTION));
      this.writeBone(LIMB.forearm[i], _q2, _knee);

      // pedals go round bottom, back, top, front as `crank` grows (pedalling forwards)
      const a = crank + (i === 0 ? 0 : Math.PI);
      const pedal = _v.set(side * 0.1, bracket.y - Math.cos(a) * crankLength, bracket.z - Math.sin(a) * crankLength);
      const footPitch = 0.16 + 0.16 * Math.cos(a) - 0.1 * Math.sin(a);
      qX(_q2, footPitch);
      // ball of the foot on the pedal: ankle = pedal - R * (ball offset from the ankle)
      _v2.set(0, TOE_JOINT.y * s - 0.012, TOE_JOINT.z * s * 0.85).applyQuaternion(_q2);
      const ankleTarget = _target.copy(pedal).sub(_v2);
      toWorld(ankleTarget);
      _hip.copy(j[LIMB.thigh[i]]).sub(j[BONE.PELVIS]).multiplyScalar(s).applyQuaternion(_qPelvis).add(_pelvis);
      const ankle = this.solveLeg(i, _hip, ankleTarget, this.yaw);
      _qa.copy(_qRoot).multiply(_q2);
      this.writeBone(LIMB.foot[i], _qa, ankle);
      _v.copy(j[LIMB.toe[i]]).sub(j[LIMB.foot[i]]).multiplyScalar(s).applyQuaternion(_qa).add(ankle);
      this.writeBone(LIMB.toe[i], _qa, _v);
    }
  }
}

Object.assign(window.NYC, { PERSON_BONES: BONE, buildPersonGeometry, createPersonMaterial, PersonCrowd, PersonRig });
})();
