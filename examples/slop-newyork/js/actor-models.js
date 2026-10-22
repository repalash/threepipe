(function () {
// js/actor-models.js
// Realistic 3D Lofted Vehicle Geometry + TSL Materials (the skinned, animated people are in pedestrians.js)
// Ported and adapted from Three.js webgpu_generator_city:
// - LoftGeometry.js (skinning 3D cross-section rings with arc-length UVs, smooth seam normals & Newell caps)
// - CarGenerator.js (lofted sedan/taxi/SUV/NYPD bodies with circular wheel arches, curved cabin windscreens,
//   crowned roofs, LatheGeometry tyres & recessed 5-spoke alloy wheels, side mirrors, roof signs & TSL fascia/seams)

const { THREE, cityUniforms } = window.NYC;
const {
  Fn,
  float,
  vec2,
  vec3,
  color,
  attribute,
  uv,
  sin,
  cos,
  abs,
  fract,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  fwidth,
  uniform,
  time,
  instanceIndex
} = window.NYC.TSL;
const { mergeGeometries, mergeVertices } = window.NYC.Addons;

const _vector = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

// ============================================================================
// 1. LOFT GEOMETRY (Ported from three/addons/geometries/LoftGeometry.js)
// ============================================================================
class LoftGeometry extends THREE.BufferGeometry {
  constructor(sections = [], options = {}) {
    super();
    this.type = 'LoftGeometry';

    const { closed = true, capStart = false, capEnd = false } = options;
    const rows = sections.length;
    if (rows < 2) return;
    const columns = sections[0].length;
    for (let i = 1; i < rows; i++) {
      if (sections[i].length !== columns) return;
    }

    const pointsPerRow = closed ? columns + 1 : columns;
    const indices = [];
    const vertices = [];
    const uvs = [];

    const rowU = [0];
    for (let i = 1; i < rows; i++) {
      let distance = 0;
      for (let j = 0; j < columns; j++) {
        distance += sections[i][j].distanceTo(sections[i - 1][j]);
      }
      rowU.push(rowU[i - 1] + distance / columns);
    }
    const totalU = rowU[rows - 1];

    for (let i = 0; i < rows; i++) {
      const section = sections[i];
      const colV = [0];
      for (let j = 1; j < pointsPerRow; j++) {
        colV.push(colV[j - 1] + section[j % columns].distanceTo(section[(j - 1) % columns]));
      }
      const totalV = colV[pointsPerRow - 1];

      for (let j = 0; j < pointsPerRow; j++) {
        const point = section[j % columns];
        vertices.push(point.x, point.y, point.z);
        uvs.push(
          totalU > 0 ? rowU[i] / totalU : i / (rows - 1),
          totalV > 0 ? colV[j] / totalV : j / (pointsPerRow - 1)
        );
      }
    }

    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < pointsPerRow - 1; j++) {
        const a = i * pointsPerRow + j;
        const b = i * pointsPerRow + j + 1;
        const c = (i + 1) * pointsPerRow + j + 1;
        const d = (i + 1) * pointsPerRow + j;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    function generateCap(sectionIndex) {
      const section = sections[sectionIndex];
      const centroid = new THREE.Vector3();
      const normal = new THREE.Vector3();

      for (let i = 0; i < columns; i++) {
        const p = section[i];
        const q = section[(i + 1) % columns];
        centroid.add(p);
        normal.x += (p.y - q.y) * (p.z + q.z);
        normal.y += (p.z - q.z) * (p.x + q.x);
        normal.z += (p.x - q.x) * (p.y + q.y);
      }
      centroid.divideScalar(columns);
      normal.normalize();

      const neighbor = sections[sectionIndex === 0 ? 1 : rows - 2];
      _vector.set(0, 0, 0);
      for (let i = 0; i < columns; i++) _vector.add(neighbor[i]);
      _vector.divideScalar(columns).sub(centroid);
      if (normal.dot(_vector) > 0) normal.negate();

      const tangent = new THREE.Vector3(1, 0, 0);
      if (Math.abs(normal.x) > 0.9) tangent.set(0, 1, 0);
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      tangent.crossVectors(bitangent, normal);

      const contour = [];
      const points = section.slice();
      for (let i = 0; i < columns; i++) {
        _vector.subVectors(points[i], centroid);
        contour.push(new THREE.Vector2(_vector.dot(tangent), _vector.dot(bitangent)));
      }

      if (THREE.ShapeUtils.isClockWise(contour) === true) {
        contour.reverse();
        points.reverse();
      }

      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const minV = new THREE.Vector2(Infinity, Infinity);
      const maxV = new THREE.Vector2(-Infinity, -Infinity);
      for (let i = 0; i < columns; i++) {
        minV.min(contour[i]);
        maxV.max(contour[i]);
      }
      const width = Math.max(maxV.x - minV.x, Number.EPSILON);
      const height = Math.max(maxV.y - minV.y, Number.EPSILON);

      const indexOffset = vertices.length / 3;
      for (let i = 0; i < columns; i++) {
        const point = points[i];
        vertices.push(point.x, point.y, point.z);
        uvs.push((contour[i].x - minV.x) / width, (contour[i].y - minV.y) / height);
      }
      for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        indices.push(indexOffset + face[0], indexOffset + face[1], indexOffset + face[2]);
      }
    }

    if (capStart === true) generateCap(0);
    if (capEnd === true) generateCap(rows - 1);

    this.setIndex(indices);
    this.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.computeVertexNormals();

    if (closed === true) {
      const normals = this.getAttribute('normal');
      for (let i = 0; i < rows; i++) {
        const a = i * pointsPerRow;
        const b = i * pointsPerRow + (pointsPerRow - 1);
        _vector.set(
          normals.getX(a) + normals.getX(b),
          normals.getY(a) + normals.getY(b),
          normals.getZ(a) + normals.getZ(b)
        ).normalize();
        normals.setXYZ(a, _vector.x, _vector.y, _vector.z);
        normals.setXYZ(b, _vector.x, _vector.y, _vector.z);
      }
    }
  }
}

function part(geometry, id) {
  const g = geometry.index ? geometry : mergeVertices(geometry);
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

// ============================================================================
// 2. LOFTED VEHICLE GEOMETRY & TSL MATERIAL
// ============================================================================
// Car bodies are lofted from ~45 cross-sections generated along the car out of a few smooth side- & plan-view curves
// (monotone cubic splines) plus elliptical roundings into the nose and tail: rounded plan-view corners, a hood that
// rolls down into the fascia, a tucked-in sill, crowned hood & deck, fender flares and circular wheel arches. A second,
// open loft sits on the belt line as the glasshouse (raked windshield & backlight, tumblehome side glass, crowned roof
// with rounded rails). All the detail (glass, seals, pillars, lamps, grilles, plates, door seams, NYPD & taxi liveries,
// brake lights & turn signals) is painted by one TSL material from object-space position & normal, so each body type
// stays a single instanced draw call.
const CAR_PARTS = {
  BODY: 0,
  WINDOW: 1,
  TYRE: 2,
  ALLOY: 3,
  TRIM: 4,
  MIRROR: 5,
  SIGN: 6,
  FRONT: 7,
  REAR: 8
};

// Design tables. Curves are [z, value] control points (z = +front); nose / tail entries are [length, tip value,
// superellipse exponent] roundings of the same quantities into the tips.
const BODY_SPECS = {
  sedan: {
    name: 'sedan',
    zFront: 2.25,
    zRear: -2.25,
    wheelRadius: 0.35,
    wheelZ: 1.38,
    wheelX: 0.83,
    archGap: 0.065, // wheel arch radius = wheelRadius + archGap
    archFlare: 0.02, // extra half-width over the wheels
    tuck: 0.075, // sill tucked in from the widest point
    halfWidth: [[2.25, 0.91], [1.38, 0.922], [0, 0.928], [-1.38, 0.926], [-2.25, 0.915]],
    sill: [[2.25, 0.29], [1.2, 0.265], [-1.2, 0.265], [-2.25, 0.3]],
    shoulder: [[2.25, 0.66], [0, 0.7], [-2.25, 0.76]],
    edge: [[2.1, 0.79], [1.5, 0.85], [0.85, 0.935], [0.55, 0.955], [-1.0, 0.985], [-1.62, 1.015], [-2.1, 1.03]],
    crown: [[2.1, 0.035], [0.95, 0.03], [0.66, 0.004], [-1.56, 0.004], [-1.78, 0.022], [-2.25, 0.026]],
    tumble: [[2.25, 0.11], [0.9, 0.09], [-1.6, 0.085], [-2.25, 0.105]],
    nose: { halfWidth: [0.36, 0.6, 2], edge: [0.22, 0.6, 2.4], crown: [0.22, 0.01, 2], sill: [0.13, 0.4, 2], shoulder: [0.3, 0.52, 2] },
    tail: { halfWidth: [0.3, 0.66, 2], edge: [0.11, 0.88, 2.4], crown: [0.11, 0, 2], sill: [0.14, 0.44, 2], shoulder: [0.2, 0.68, 2] },
    cabin: {
      cowl: 0.86,
      roofFront: 0.0,
      roofRear: -1.0,
      deck: -1.68,
      roofY: [[0.0, 1.435], [-0.5, 1.455], [-1.0, 1.42]],
      rail: [0.645, 0.625], // roof rail half-width at the front & rear of the roof
      inset: 0.035, // side glass base inset from the body's top edge
      bulge: 0.012, // side glass outward curvature
      roofEdge: 0.05, // roof rail rounding height
      roofCrown: 0.035,
      roofRound: 4,
      pillars: [-0.3] // B (and C) pillar centres
    },
    doors: [0.84, -0.3, -1.02], // door shut lines
    handles: [-0.13, -0.86],
    headlight: [0.56, 0.705, 0.2, 0.058], // centre |x|, y, half-width, half-height
    taillight: [0.585, 0.87, 0.235, 0.052],
    grille: [0.7, 0.27, 0.02], // upper slot between the headlights: y, half-width, half-height
    intake: [0.46, 0.43, 0.095], // lower grille
    plates: [0.47, 0.66], // front / rear plate centre heights
    bumperLine: [0.775, 0.595], // hood / bumper and trunk / bumper shut lines on the nose & tail
    chrome: true, // chrome strip along the side windows' sills
    cladding: 0, // height of the unpainted lower body cladding (SUVs)
    sign: false,
    rails: false
  },
  suv: {
    name: 'suv',
    zFront: 2.3,
    zRear: -2.3,
    wheelRadius: 0.39,
    wheelZ: 1.4,
    wheelX: 0.87,
    archGap: 0.075,
    archFlare: 0.03,
    tuck: 0.07,
    halfWidth: [[2.3, 0.948], [1.4, 0.96], [0, 0.966], [-1.4, 0.964], [-2.3, 0.956]],
    sill: [[2.3, 0.39], [1.2, 0.35], [-1.2, 0.35], [-2.3, 0.41]],
    shoulder: [[2.3, 0.8], [0, 0.84], [-2.3, 0.88]],
    edge: [[2.1, 0.99], [1.5, 1.045], [0.85, 1.1], [0.6, 1.12], [-1.0, 1.145], [-2.0, 1.175], [-2.3, 1.18]],
    crown: [[2.1, 0.035], [0.9, 0.03], [0.6, 0.004], [-2.3, 0.004]],
    tumble: [[2.3, 0.1], [0.9, 0.08], [-2.3, 0.08]],
    nose: { halfWidth: [0.3, 0.7, 2], edge: [0.2, 0.84, 2.6], crown: [0.2, 0.01, 2], sill: [0.12, 0.5, 2], shoulder: [0.24, 0.66, 2] },
    tail: { halfWidth: [0.24, 0.76, 2], edge: [0.08, 1.1, 2.6], crown: [0.08, 0, 2], sill: [0.14, 0.52, 2], shoulder: [0.18, 0.84, 2] },
    cabin: {
      cowl: 0.8,
      roofFront: 0.08,
      roofRear: -1.96,
      deck: -2.2,
      roofY: [[0.08, 1.735], [-0.9, 1.76], [-1.96, 1.745]],
      rail: [0.71, 0.7],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.055,
      roofCrown: 0.03,
      roofRound: 4,
      pillars: [-0.3, -1.18]
    },
    doors: [0.78, -0.3, -1.18],
    handles: [-0.13, -1.0],
    headlight: [0.6, 0.9, 0.2, 0.055],
    taillight: [0.66, 1.0, 0.2, 0.07],
    grille: [0.83, 0.36, 0.1],
    intake: [0.52, 0.44, 0.06],
    plates: [0.6, 0.76],
    bumperLine: [0.965, 0.84],
    chrome: false,
    cladding: 0.5,
    sign: false,
    rails: true
  }
};
BODY_SPECS.taxi = Object.assign({}, BODY_SPECS.sedan, { name: 'taxi', sign: true });
for (const spec of Object.values(BODY_SPECS)) {
  // Kept for code that places lamp flares: lamp heights (front, rear) and centres across the car
  spec.lamps = [spec.headlight[1], spec.taillight[1]];
  spec.lampX = [spec.headlight[0], spec.taillight[0]];
}

const lerp = (a, b, t) => a + (b - a) * t;

// Monotone cubic (Fritsch-Carlson) interpolation through [x, y] control points: smooth, never overshoots
function smoothCurve(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 1) return () => pts[0][1];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0);
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m.push((w1 + w2) / (w1 / d[i - 1] + w2 / d[i]));
    }
  }
  m.push(d[n - 2]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// 1 along the body, falling to 0 at the tip along a superelliptic quarter (vertical tangent at the tip)
function endFactor(z, zTip, length, exponent = 2) {
  const u = zTip > 0 ? (z - (zTip - length)) / length : (zTip + length - z) / length;
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  return Math.pow(1 - Math.pow(u, exponent), 1 / exponent);
}

/**
 * Evaluates a body spec's curves into the cross-section parameters along the vehicle (memoized on the spec):
 *   body(z) -> { W: half-width, yB: sill, yS: shoulder (widest), yE / xE: top edge, yT: crown, xB: sill half-width }
 */
function bodyProfile(spec) {
  if (spec._body) return spec._body;
  const W0 = smoothCurve(spec.halfWidth);
  const B0 = smoothCurve(spec.sill);
  const S0 = smoothCurve(spec.shoulder);
  const E0 = smoothCurve(spec.edge);
  const C0 = smoothCurve(spec.crown);
  const T0 = smoothCurve(spec.tumble);
  const archR = spec.wheelRadius + spec.archGap;
  const axles = [spec.wheelZ, -spec.wheelZ];

  const rounded = (z, value, key) => {
    const nose = spec.nose[key];
    const tail = spec.tail[key];
    if (nose && z > 0) value = nose[1] + (value - nose[1]) * endFactor(z, spec.zFront, nose[0], nose[2]);
    if (tail && z < 0) value = tail[1] + (value - tail[1]) * endFactor(z, spec.zRear, tail[0], tail[2]);
    return value;
  };

  const body = (z) => {
    let flare = 0;
    for (const axle of axles) {
      const d = (z - axle) / (archR + 0.4);
      if (Math.abs(d) < 1) flare = Math.max(flare, (1 - d * d) ** 2);
    }
    const W = rounded(z, W0(z) + spec.archFlare * flare, 'halfWidth');
    let yB = rounded(z, B0(z), 'sill');
    for (const axle of axles) {
      const d = Math.abs(z - axle);
      if (d < archR) yB = Math.max(yB, spec.wheelRadius + Math.sqrt(archR * archR - d * d));
    }
    const yE = rounded(z, E0(z), 'edge');
    const yT = yE + Math.max(0, rounded(z, C0(z), 'crown'));
    const yS = Math.min(Math.max(rounded(z, S0(z), 'shoulder'), yB + 0.035), yE - 0.035);
    const xE = Math.max(W - T0(z), W * 0.55);
    return { z, W, yB, yS, yE, yT, xE, xB: W - spec.tuck };
  };
  spec._body = body;
  return body;
}

/**
 * A car's body profile plus its glasshouse (memoized on the spec):
 *   cabin(z) -> { beltX, beltY: side glass base, railX, railY: top of the side glass, h: roof / glass crown height }
 */
function carLayout(spec) {
  if (spec._layout) return spec._layout;
  const body = bodyProfile(spec);
  const archR = spec.wheelRadius + spec.archGap;
  const cab = spec.cabin;
  const roofY = smoothCurve(cab.roofY);
  const H = cab.roofEdge + cab.roofCrown;
  const belt = (z) => {
    const s = body(z);
    return { x: s.xE - cab.inset, y: s.yE - 0.004 };
  };
  const bc = belt(cab.cowl);
  const bd = belt(cab.deck);
  const railF = { x: cab.rail[0], y: roofY(cab.roofFront) - H };
  const railR = { x: cab.rail[1], y: roofY(cab.roofRear) - H };
  const roofMid = (cab.roofFront + cab.roofRear) / 2;
  const railM = { x: (cab.rail[0] + cab.rail[1]) / 2, y: roofY(roofMid) - H };
  // At the cowl & deck the glass arch stays under the hood / trunk crown, so the glass grows out of the panel
  const hCowl = Math.max(0.006, body(cab.cowl).yT - bc.y - 0.008);
  const hDeck = Math.max(0.006, body(cab.deck).yT - bd.y - 0.008);

  const cabin = (z) => {
    const b = belt(z);
    let railX;
    let railY;
    let h;
    if (z >= cab.roofFront) {
      const t = (cab.cowl - z) / (cab.cowl - cab.roofFront);
      railX = lerp(bc.x, railF.x, t);
      railY = lerp(bc.y, railF.y, t);
      h = lerp(hCowl, H, Math.min(1, t * 1.6));
    } else if (z <= cab.roofRear) {
      const t = (z - cab.deck) / (cab.roofRear - cab.deck);
      railX = lerp(bd.x, railR.x, t);
      railY = lerp(bd.y, railR.y, t);
      h = lerp(hDeck, H, Math.min(1, t * 1.6));
    } else {
      const t = (cab.roofFront - z) / (cab.roofFront - cab.roofRear);
      railX = lerp(railF.x, railR.x, t);
      railY = roofY(z) - H;
      h = H;
    }
    return { z, beltX: Math.max(b.x, railX), beltY: Math.min(b.y, railY), railX, railY, h, bulge: cab.bulge };
  };

  // Height of the glasshouse's top surface (roof / windshield crown) at |x| for a cabin section
  const cabinTop = (c, x) => {
    const n = cab.roofRound;
    const ratio = Math.min(1, Math.abs(x) / Math.max(c.railX, 1e-4));
    const th = Math.acos(Math.pow(ratio, n / 2));
    return c.railY + c.h * Math.pow(Math.sin(th), 2 / n);
  };

  spec._layout = { spec, body, cabin, cabinTop, archR, belt: { cowl: bc, deck: bd }, rail: { front: railF, mid: railM, rear: railR, roofMid } };
  return spec._layout;
}

// Section winding used by every car loft in this file: left (-x) bottom, up & over the top, right (+x) bottom
function mirrorSection(right, center, z) {
  const pts = [];
  for (const [x, y] of right) pts.push(new THREE.Vector3(-x, y, z));
  if (center) pts.push(new THREE.Vector3(center[0], center[1], z));
  for (let i = right.length - 1; i >= 0; i--) pts.push(new THREE.Vector3(right[i][0], right[i][1], z));
  return pts;
}

const BODY_LOWER_ROUND = 2.8;
const BODY_UPPER_ROUND = 3.2;

// Right half of a body cross-section: superelliptic lower corner (sill -> widest point), superelliptic upper corner
// (widest point -> top edge) and a parabolic crown. Specs may sharpen the corners (lowerRound / upperRound) and sample
// the upper corner more densely (upperSamples).
function bodyHalfProfile(s, detail, spec = {}) {
  const n1 = spec.lowerRound || BODY_LOWER_ROUND;
  const n2 = spec.upperRound || BODY_UPPER_ROUND;
  const right = [];
  const low = detail ? [0, 0.32, 0.64, 1] : [0, 1];
  const up = detail ? spec.upperSamples || [0.38, 0.72, 1] : [1];
  const top = detail ? [0.66, 0.33] : [0.5];
  for (const a of low) {
    const th = (a * Math.PI) / 2;
    right.push([s.xB + (s.W - s.xB) * Math.pow(Math.sin(th), 2 / n1), s.yS - (s.yS - s.yB) * Math.pow(Math.cos(th), 2 / n1)]);
  }
  for (const a of up) {
    const th = (a * Math.PI) / 2;
    right.push([s.xE + (s.W - s.xE) * Math.pow(Math.cos(th), 2 / n2), s.yS + (s.yE - s.yS) * Math.pow(Math.sin(th), 2 / n2)]);
  }
  for (const f of top) right.push([s.xE * f, s.yE + (s.yT - s.yE) * (1 - f * f)]);
  return right;
}

function bodyStations(spec, detail) {
  const zs = [];
  const add = (z) => zs.push(Math.min(spec.zFront, Math.max(spec.zRear, z)));
  const step = detail ? spec.stationStep || 0.28 : 0.75;
  for (let z = spec.zRear; z < spec.zFront; z += step) add(z);
  add(spec.zFront);
  const noseLen = Math.max(...Object.values(spec.nose).map((v) => v[0]));
  const tailLen = Math.max(...Object.values(spec.tail).map((v) => v[0]));
  for (const u of detail ? [0, 0.3, 0.52, 0.7, 0.83, 0.92, 0.97, 0.993] : [0, 0.6, 0.92]) {
    add(spec.zFront - noseLen * (1 - u));
    add(spec.zRear + tailLen * (1 - u));
  }
  const archR = spec.wheelRadius + spec.archGap;
  const k = detail ? 8 : 4;
  for (const axle of [spec.wheelZ, -spec.wheelZ]) {
    for (let i = 0; i <= k; i++) add(axle + archR * Math.cos((i / k) * Math.PI));
    add(axle + archR + 0.006);
    add(axle - archR - 0.006);
  }
  if (detail && spec.cabin) {
    add(spec.cabin.cowl);
    add(spec.cabin.deck);
  }
  zs.sort((a, b) => b - a);
  const eps = detail ? 0.004 : 0.04;
  const out = [];
  for (const z of zs) {
    if (!out.length || out[out.length - 1] - z > eps) out.push(z);
  }
  out[0] = spec.zFront;
  out[out.length - 1] = spec.zRear;
  return out;
}

function buildBodyLoft(spec, detail = 1) {
  const body = bodyProfile(spec);
  const sections = bodyStations(spec, detail).map((z) => {
    const s = body(z);
    return mirrorSection(bodyHalfProfile(s, detail, spec), [0, s.yT], z);
  });
  return new LoftGeometry(sections, { capStart: true, capEnd: true });
}

function buildCarBody(spec, detail = 1) {
  return part(buildBodyLoft(spec, detail), CAR_PARTS.BODY);
}

function cabinSection(c, detail, roundness) {
  const right = [[c.beltX, c.beltY]];
  if (detail) {
    for (const s of [1 / 3, 2 / 3]) {
      right.push([lerp(c.beltX, c.railX, s) + c.bulge * 4 * s * (1 - s), lerp(c.beltY, c.railY, s)]);
    }
  }
  right.push([c.railX, c.railY]);
  for (const f of detail ? [0.2, 0.42, 0.68] : [0.5]) {
    const th = (f * Math.PI) / 2;
    right.push([c.railX * Math.pow(Math.cos(th), 2 / roundness), c.railY + c.h * Math.pow(Math.sin(th), 2 / roundness)]);
  }
  return mirrorSection(right, [0, c.railY + c.h], c.z);
}

function cabinStations(spec, detail) {
  const cab = spec.cabin;
  const zs = [];
  for (const t of detail ? [0, 0.1, 0.24, 0.42, 0.62, 0.82] : [0, 0.5]) zs.push(lerp(cab.cowl, cab.roofFront, t));
  for (const t of detail ? [0, 0.25, 0.5, 0.75] : [0, 0.5]) zs.push(lerp(cab.roofFront, cab.roofRear, t));
  for (const t of detail ? [1, 0.8, 0.6, 0.4, 0.22, 0.1, 0] : [1, 0.5, 0]) zs.push(lerp(cab.deck, cab.roofRear, t));
  return zs;
}

function buildCarCabin(spec, detail = 1) {
  const L = carLayout(spec);
  const sections = cabinStations(spec, detail).map((z) => cabinSection(L.cabin(z), detail, spec.cabin.roofRound));
  return part(new LoftGeometry(sections, { closed: false }), CAR_PARTS.WINDOW);
}

/**
 * Half-width of a body's outer skin at height y of the cross-section at z (for decals & signs that hug the sides)
 */
function carBodyHalfWidthAt(spec, z, y) {
  const s = bodyProfile(spec)(z);
  const n1 = spec.lowerRound || BODY_LOWER_ROUND;
  const n2 = spec.upperRound || BODY_UPPER_ROUND;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const th = ((i / 16) * Math.PI) / 2;
    pts.push([s.xB + (s.W - s.xB) * Math.pow(Math.sin(th), 2 / n1), s.yS - (s.yS - s.yB) * Math.pow(Math.cos(th), 2 / n1)]);
  }
  for (let i = 1; i <= 16; i++) {
    const th = ((i / 16) * Math.PI) / 2;
    pts.push([s.xE + (s.W - s.xE) * Math.pow(Math.cos(th), 2 / n2), s.yS + (s.yE - s.yS) * Math.pow(Math.sin(th), 2 / n2)]);
  }
  if (y <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][1]) {
      const t = (y - pts[i - 1][1]) / Math.max(pts[i][1] - pts[i - 1][1], 1e-6);
      return lerp(pts[i - 1][0], pts[i][0], t);
    }
  }
  return s.xE;
}

/**
 * A thin grid patch lying `offset` m off the body side (side = +1: +x) over z0..z1, y0..y1. UVs read from the
 * front of the car to the back on both sides (u = 0 at the front on the +x side, at the back on the -x side).
 */
function buildCarSidePatch(spec, side, z0, z1, y0, y1, offset = 0.003, nz = 10, ny = 6) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= ny; j++) {
    const v = j / ny;
    const y = lerp(y0, y1, v);
    for (let i = 0; i <= nz; i++) {
      const u = i / nz;
      const z = side > 0 ? lerp(z1, z0, u) : lerp(z0, z1, u);
      positions.push(side * (carBodyHalfWidthAt(spec, z, y) + offset), y, z);
      uvs.push(u, v);
      if (i < nz && j < ny) {
        const a = j * (nz + 1) + i;
        const b = a + 1;
        const c = a + nz + 1;
        const d = c + 1;
        if (side > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(hw, hh, r) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

// Rounded box extruded along z, centred on the origin
function roundedBox(hw, hh, depth, r, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(hw - bevel, hh - bevel, Math.max(0.002, r - bevel)), {
    depth: Math.max(0.001, depth - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2
  });
  return g.translate(0, 0, -(depth - 2 * bevel) / 2);
}

/**
 * Builds a single wheel assembly (LatheGeometry tyre + recessed alloy lip + dished hub)
 * centered at the origin (for steerable/spinning player wheels) or translated to (x, r, z).
 */
function buildWheelParts(spec, side, translateToAxle = false, z = 0) {
  const r = spec.wheelRadius;
  const rim = r * 0.64;
  const width = r * 0.68;
  const wheelProfile = [
    new THREE.Vector2(rim + 0.014, -width * 0.44),
    new THREE.Vector2(r * 0.96, -width * 0.33),
    new THREE.Vector2(r, -width * 0.05),
    new THREE.Vector2(r, width * 0.05),
    new THREE.Vector2(r * 0.96, width * 0.33),
    new THREE.Vector2(rim + 0.014, width * 0.44)
  ];

  const x = translateToAxle ? side * spec.wheelX : 0;
  const y = translateToAxle ? r : 0;
  const zOff = translateToAxle ? z : 0;

  const tyre = new THREE.LatheGeometry(wheelProfile, 20)
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const lip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim + 0.014, width * 0.44), new THREE.Vector2(rim, width * 0.29)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const backLip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim, -width * 0.29), new THREE.Vector2(rim + 0.014, -width * 0.44)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const hub = new THREE.CircleGeometry(rim, 20);
  hub.attributes.position.setZ(0, -0.015);
  hub.computeVertexNormals();
  hub.rotateY(side * Math.PI * 0.5).translate(x + side * width * 0.29, y, zOff);

  const backHub = new THREE.CircleGeometry(rim, 20);
  backHub.attributes.position.setZ(0, -0.015);
  backHub.computeVertexNormals();
  backHub.rotateY(-side * Math.PI * 0.5).translate(x - side * width * 0.29, y, zOff);

  const list = [
    part(tyre, CAR_PARTS.TYRE),
    part(lip, CAR_PARTS.ALLOY),
    part(backLip, CAR_PARTS.ALLOY),
    part(hub, CAR_PARTS.ALLOY),
    part(backHub, CAR_PARTS.ALLOY)
  ];

  if (translateToAxle) list.push(buildWheelWell(spec, side, z));
  return list;
}

// Dark arch liner behind a wheel, so the arch never shows through to the other side of the car
function buildWheelWell(spec, side, z) {
  const r = spec.wheelRadius;
  const width = r * 0.68;
  const wellOuter = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  const wellInner = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(-side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  return part(mergeGeometries([wellOuter, wellInner]), CAR_PARTS.TRIM);
}

function buildSteerableWheelGeo(spec, side) {
  return mergeGeometries(buildWheelParts(spec, side, false));
}

function buildMirrors(spec) {
  const L = carLayout(spec);
  const z = spec.cabin.cowl - 0.17;
  const c = L.cabin(z);
  const list = [];
  for (const side of [-1, 1]) {
    const housing = roundedBox(0.1, 0.06, 0.085, 0.035, 0.014)
      .rotateY(side * 0.12)
      .translate(side * (c.beltX + 0.15), c.beltY + 0.085, z - 0.02);
    const arm = new THREE.BoxGeometry(0.12, 0.035, 0.06)
      .rotateZ(side * 0.35)
      .translate(side * (c.beltX + 0.04), c.beltY + 0.045, z);
    list.push(part(housing, CAR_PARTS.MIRROR), part(arm, CAR_PARTS.TRIM));
  }
  return list;
}

function buildRoofRails(spec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const list = [];
  for (const side of [-1, 1]) {
    const sections = [0.04, 0.1, 0.9, 0.96].map((t, i) => {
      const z = lerp(cab.roofFront, cab.roofRear, t);
      const c = L.cabin(z);
      const x = side * c.railX * 0.8;
      const y = L.cabinTop(c, x) + (i === 0 || i === 3 ? 0.004 : 0.05);
      return [
        new THREE.Vector3(x - 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y + 0.016, z),
        new THREE.Vector3(x - 0.02, y + 0.016, z)
      ].reverse();
    });
    list.push(part(new LoftGeometry(sections, { capStart: true, capEnd: true }), CAR_PARTS.TRIM));
  }
  return list;
}

// NYC medallion roof light: a lit, gently tapered box on a black mount
function taxiSignPlacement(spec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, 0.45);
  const c = L.cabin(z);
  return { z, y: c.railY + c.h };
}

function buildTaxiSign(spec) {
  const { z, y } = taxiSignPlacement(spec);
  const shape = new THREE.Shape();
  const hw0 = 0.3;
  const hw1 = 0.27;
  const h = 0.15;
  const r = 0.035;
  shape.moveTo(-hw0, 0);
  shape.lineTo(hw0, 0);
  shape.lineTo(hw1, h - r);
  shape.quadraticCurveTo(hw1 - 0.004, h, hw1 - r, h);
  shape.lineTo(-hw1 + r, h);
  shape.quadraticCurveTo(-hw1 + 0.004, h, -hw1, h - r);
  shape.lineTo(-hw0, 0);
  const sign = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 3
  }).translate(0, y + 0.03, z - 0.06);
  const mount = new THREE.BoxGeometry(0.46, 0.04, 0.12).translate(0, y + 0.012, z);
  return [part(sign, CAR_PARTS.SIGN), part(mount, CAR_PARTS.TRIM)];
}

function buildCarGeometry(spec, includeWheels = true) {
  const parts = [buildCarBody(spec, 1), buildCarCabin(spec, 1), ...buildMirrors(spec)];
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      if (includeWheels) parts.push(...buildWheelParts(spec, side, true, z));
      else parts.push(buildWheelWell(spec, side, z));
    }
  }
  if (spec.rails) parts.push(...buildRoofRails(spec));
  if (spec.sign) parts.push(...buildTaxiSign(spec));
  return mergeGeometries(parts);
}

// A ~250-triangle stand-in for distant cars (a few pixels tall): the same body & glasshouse lofted from a handful of
// coarse sections, dark wheel blocks and the taxi's roof sign. Same attributes (partId, uv, normal) as the full
// model, so it renders with the same material and per-instance paint.
function buildCarProxyGeometry(spec) {
  const parts = [buildCarBody(spec, 0), buildCarCabin(spec, 0)];
  const r = spec.wheelRadius;
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      parts.push(part(new THREE.BoxGeometry(r * 0.6, r * 1.7, r * 1.7).translate(side * spec.wheelX, r * 0.88, z), CAR_PARTS.TYRE));
    }
  }
  if (spec.sign) {
    const { z, y } = taxiSignPlacement(spec);
    parts.push(part(new THREE.BoxGeometry(0.58, 0.16, 0.16).translate(0, y + 0.1, z), CAR_PARTS.SIGN));
  }
  return mergeGeometries(parts);
}

// NYPD roof light bar (red on the -x half, blue on the +x half) for a body spec's roof, lit by createLightbarMaterial
function buildLightbarGeometry(spec = BODY_SPECS.sedan) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, 0.32);
  const c = L.cabin(z);
  const y = c.railY + c.h;
  const bar = roundedBox(0.13, 0.045, 1.12, 0.04, 0.02).rotateY(Math.PI / 2).translate(0, y + 0.075, z);
  const parts = [part(bar, CAR_PARTS.SIGN)];
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.16).translate(side * 0.42, y + 0.02, z), CAR_PARTS.TRIM));
  }
  return mergeGeometries(parts);
}

let _lightbarMat = null;

// Light bar lenses: red & blue halves flashing in alternation (double strobes), each car on its own phase
function createLightbarMaterial() {
  if (_lightbarMat) return _lightbarMat;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.1 });
  const lightbar = () => {
    const p = attribute('position', 'vec3');
    const partId = attribute('partId', 'float');
    const isLens = step(abs(partId.sub(CAR_PARTS.SIGN)), 0.25);
    const phase = fract(float(instanceIndex).mul(0.61803)).toVar();
    const t = fract(time.mul(1.6).add(phase)).toVar();
    const strobe = step(0.5, fract(t.mul(6.0)));
    const redOn = step(t, 0.5).mul(strobe);
    const blueOn = step(0.5, t).mul(strobe);
    const isRed = step(p.x, -0.035);
    const isBlue = step(0.035, p.x);
    return { isLens, redOn, blueOn, isRed, isBlue };
  };
  mat.colorNode = Fn(() => {
    const s = lightbar();
    const lens = mix(mix(color(0xd8dde2), color(0x8a0d12), s.isRed), color(0x0f3c9a), s.isBlue);
    return mix(color(0x15181b), lens, s.isLens);
  })();
  mat.emissiveNode = Fn(() => {
    const s = lightbar();
    return color(0xff1a22).mul(s.isRed.mul(s.redOn).mul(6.0)).add(color(0x2a6cff).mul(s.isBlue.mul(s.blueOn).mul(7.0))).mul(s.isLens);
  })();
  _lightbarMat = mat;
  return mat;
}

// Filter-width anti-aliased 2D rounded rectangle SDF (ported from CarGenerator.js)
const roundedRect = Fn(([point, halfSize, radiusNode]) => {
  const pt = vec2(point).toVar();
  const hs = vec2(halfSize).toVar();
  const rad = float(radiusNode).toVar();
  const q = abs(pt).sub(hs).add(rad).toVar();
  const dist = length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(rad).toVar();
  const edge = max(fwidth(dist), 0.001).toVar();
  return smoothstep(edge, edge.negate(), dist);
});

// IQ polynomial smooth maximum: rounds the corners of max()-combined half-plane distances
const smax = (a, b, k) => {
  const h = max(float(k).sub(abs(a.sub(b))), 0.0).div(k);
  return max(a, b).add(h.mul(h).mul(k * 0.25));
};

// Signed distance (approximate outside, exact inside) to a convex polygon given as outward half-planes [nx, ny, c]
const polygonDistance = (px, py, planes, k) => {
  let d = null;
  for (const [nx, ny, c] of planes) {
    const e = px.mul(nx).add(py.mul(ny)).sub(c);
    d = d === null ? e : smax(d, e, k);
  }
  return d;
};

// Outward half-planes of a counter-clockwise polygon, each edge moved in by its margin
function polygonPlanes(points, margins) {
  const planes = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    planes.push([nx, ny, ax * nx + ay * ny - margins[i]]);
  }
  return planes;
}

const coverage = (d) => {
  const w = max(fwidth(d), 0.0008);
  return smoothstep(w, w.negate(), d);
};

const _carMaterialCache = new Map();

/**
 * Creates the TSL material for lofted vehicles.
 * Instanced traffic reads the per-instance `paintColor` (vec3) and `carState` (vec4: brake, left (+x) & right (-x)
 * turn signal, livery: 1 = NYPD) attributes; with a fixed `fixedColorHex` (the player's taxi, wheels) the state is the
 * `material.userData.carState` uniform instead.
 * Every mask is built once and shared by the colour, roughness, metalness & emissive graphs (TSL turns nodes used
 * more than once into temporaries), so the fragment shader evaluates each SDF a single time.
 */
function createLoftedCarMaterial(spec, fixedColorHex = null) {
  const cacheKey = `${spec.name}_${fixedColorHex ?? 'instanced'}`;
  if (_carMaterialCache.has(cacheKey)) {
    return _carMaterialCache.get(cacheKey);
  }

  const L = carLayout(spec);
  const cab = spec.cabin;
  const fixed = fixedColorHex !== null;
  const stateUniform = fixed ? uniform(new THREE.Vector4(0, 0, 0, 0)) : null;
  const state = fixed ? stateUniform : attribute('carState', 'vec4');
  const paint = fixed ? color(fixedColorHex) : attribute('paintColor', 'vec3');

  const axleZ = float(spec.wheelZ);
  const wheelR = float(spec.wheelRadius);
  const archR = L.archR;

  // Glass outlines from the glasshouse layout: side windows in side view (z, y), windshield & backlight from above
  // (|x|, z). Each edge is pulled in by its pillar / frame width; the seal outline sits a little further out.
  const bc = L.belt.cowl;
  const bd = L.belt.deck;
  const rf = L.rail.front;
  const rm = L.rail.mid;
  const rr = L.rail.rear;
  const sidePoly = [[cab.cowl, bc.y], [cab.roofFront, rf.y], [L.rail.roofMid, rm.y], [cab.roofRear, rr.y], [cab.deck, bd.y]];
  const sideGlassPlanes = polygonPlanes(sidePoly, [0.05, 0.03, 0.03, 0.065, 0.02]);
  const sideSealPlanes = polygonPlanes(sidePoly, [0.034, 0.016, 0.016, 0.05, 0.004]);
  const frontPoly = [[-1, cab.cowl], [-1, cab.roofFront], [rf.x, cab.roofFront], [bc.x, cab.cowl]];
  const frontGlassPlanes = polygonPlanes(frontPoly, [0, 0.045, 0.06, 0.05]);
  const frontSealPlanes = polygonPlanes(frontPoly, [0, 0.03, 0.045, 0.035]);
  const rearPoly = [[-1, cab.roofRear], [-1, cab.deck], [bd.x, cab.deck], [rr.x, cab.roofRear]];
  const rearGlassPlanes = polygonPlanes(rearPoly, [0, 0.045, 0.065, 0.05]);
  const rearSealPlanes = polygonPlanes(rearPoly, [0, 0.03, 0.05, 0.035]);
  const [hlX, hlY, hlW, hlH] = spec.headlight;
  const [tlX, tlY, tlW, tlH] = spec.taillight;
  const [grY, grW, grH] = spec.grille;
  const [inY, inW, inH] = spec.intake;
  const [plateF, plateR] = spec.plates;
  const frontZone = spec.zFront - 0.55;
  const rearZone = spec.zRear + 0.55;
  const sillY = spec.sill[1][1];
  const rearSill = spec.tail.sill[1];
  const signY = taxiSignPlacement(spec).y + 0.105;
  const one = float(1.0);

  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const isPart = (id) => step(abs(partId.sub(id)), 0.25);
  const isBody = isPart(CAR_PARTS.BODY);
  const isWindow = isPart(CAR_PARTS.WINDOW);
  const isTyre = isPart(CAR_PARTS.TYRE);
  const isAlloy = isPart(CAR_PARTS.ALLOY);
  const isTrim = isPart(CAR_PARTS.TRIM);
  const isMirror = isPart(CAR_PARTS.MIRROR);
  const isSign = isPart(CAR_PARTS.SIGN);
  const ax = abs(p.x);
  const isSide = smoothstep(0.45, 0.7, abs(n.x));
  const front = smoothstep(0.12, 0.38, n.z).mul(step(frontZone, p.z)).mul(isBody);
  const rear = smoothstep(0.12, 0.38, n.z.negate()).mul(step(p.z, rearZone)).mul(isBody);
  const under = smoothstep(-0.25, -0.55, n.y).mul(isBody);
  const belt = mix(float(bd.y), float(bc.y), clamp(p.z.sub(cab.deck).div(cab.cowl - cab.deck), 0.0, 1.0));

  // Glasshouse: side windows (minus the B / C pillars), windshield & backlight, their black seals, chrome sill strip
  let sideG = polygonDistance(p.z, p.y, sideGlassPlanes, 0.07);
  for (const zp of cab.pillars) sideG = max(sideG, float(0.036).sub(abs(p.z.sub(zp))));
  const backlight = coverage(polygonDistance(ax, p.z, rearGlassPlanes, 0.09)).mul(isWindow);
  const glass = max(max(coverage(sideG), coverage(polygonDistance(ax, p.z, frontGlassPlanes, 0.09))), backlight.div(max(isWindow, 1e-4)))
    .mul(isWindow);
  const seal = max(
    coverage(polygonDistance(p.z, p.y, sideSealPlanes, 0.07)),
    max(coverage(polygonDistance(ax, p.z, frontSealPlanes, 0.09)), coverage(polygonDistance(ax, p.z, rearSealPlanes, 0.09)))
  ).mul(isWindow);
  const chromeBelt = spec.chrome
    ? smoothstep(0.003, 0.006, p.y.sub(belt))
      .mul(smoothstep(0.016, 0.012, p.y.sub(belt)))
      .mul(smoothstep(0.5, 0.7, abs(n.x)))
      .mul(step(cab.deck + 0.05, p.z))
      .mul(step(p.z, cab.cowl - 0.08))
      .mul(isWindow)
    : float(0.0);
  const chmsl = roundedRect(vec2(p.x, p.z.sub(cab.roofRear - 0.075)), vec2(0.14, 0.012), 0.005).mul(backlight).mul(step(n.z, -0.1));

  // Wheel arches: distance from the nearest axle in side view (or from the hub of a centred, spinning wheel)
  const isCenteredWheel = step(abs(p.z), wheelR.add(0.05)).mul(max(isTyre, isAlloy));
  const wheelVec = mix(vec2(abs(p.z).sub(axleZ), p.y.sub(wheelR)), vec2(p.z, p.y), isCenteredWheel);
  const wheelDist = length(wheelVec);

  // Lamps, grilles & plates on the nose and tail (projected along z, so the lamps wrap around the corners)
  const hlUV = vec2(ax.sub(hlX), p.y.sub(hlY).sub(ax.sub(hlX).mul(0.1)));
  const headlight = roundedRect(hlUV, vec2(hlW, hlH), hlH * 0.8).mul(smoothstep(0.02, 0.25, n.z)).mul(step(frontZone, p.z)).mul(isBody);
  const headlightLens = roundedRect(vec2(ax.sub(hlX - hlW * 0.3), hlUV.y.sub(hlH * 0.12)), vec2(hlW * 0.42, hlH * 0.4), hlH * 0.38).mul(headlight);
  const drlDist = abs(hlUV.y.add(hlH * 0.6));
  const drlEdge = max(fwidth(drlDist), 0.012);
  const drl = smoothstep(drlEdge, 0.0, drlDist).mul(headlight);
  const turnFront = smoothstep(hlX + hlW * 0.42, hlX + hlW * 0.52, ax).mul(headlight);
  const grille = roundedRect(vec2(p.x, p.y.sub(grY)), vec2(grW, grH), grH * 0.9).mul(front);
  const intake = roundedRect(vec2(p.x, p.y.sub(inY)), vec2(inW, inH), 0.04).mul(front);
  const plateFront = roundedRect(vec2(p.x, p.y.sub(plateF)), vec2(0.155, 0.055), 0.008).mul(front);
  const taillight = roundedRect(vec2(ax.sub(tlX), p.y.sub(tlY)), vec2(tlW, tlH), tlH * 0.6)
    .mul(smoothstep(0.02, 0.25, n.z.negate()))
    .mul(step(p.z, rearZone))
    .mul(isBody);
  const turnRear = smoothstep(tlX - tlW * 0.35, tlX - tlW * 0.45, ax).mul(taillight);
  const plateRear = roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(0.155, 0.06), 0.008).mul(rear);
  const plateRecess = roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(0.185, 0.082), 0.02).mul(rear);
  const diffuser = roundedRect(vec2(p.x, p.y.sub(rearSill + 0.035)), vec2(0.58, 0.028), 0.02).mul(rear);
  const reflector = roundedRect(vec2(ax.sub(tlX + 0.06), p.y.sub(rearSill + 0.1)), vec2(0.065, 0.011), 0.006).mul(rear);
  const bumperSeam = max(
    smoothstep(0.006, 0.0025, abs(p.y.sub(spec.bumperLine[0]))).mul(step(ax, hlX - hlW * 0.6)).mul(front),
    smoothstep(0.006, 0.0025, abs(p.y.sub(spec.bumperLine[1]))).mul(step(ax, tlX)).mul(rear)
  );
  const cowlPanel = smoothstep(cab.cowl + 0.085, cab.cowl + 0.07, p.z)
    .mul(smoothstep(cab.cowl - 0.04, cab.cowl - 0.02, p.z))
    .mul(step(0.6, n.y))
    .mul(isBody);
  const signFace = smoothstep(0.55, 0.75, abs(n.z)).mul(isSign);
  const signGlyph = step(0.42, sin(p.x.mul(90.0))).mul(step(ax, 0.17)).mul(smoothstep(0.045, 0.04, abs(p.y.sub(signY))));
  const mirrorGlass = isMirror.mul(step(0.55, n.z.negate()));
  const lamp = max(headlight, taillight);
  const plates = max(plateFront, plateRear);
  const cladding =
    spec.cladding > 0
      ? max(smoothstep(spec.cladding + 0.01, spec.cladding - 0.01, p.y), smoothstep(archR + 0.075, archR + 0.06, wheelDist))
        .mul(isBody)
        .mul(one.sub(lamp))
        .mul(one.sub(plates))
      : float(0.0);

  // 5-spoke alloys (branchless 5-ray star SDF) with rim ring & hub, lug ribs on the tyre tread
  const wDir = wheelVec.div(max(wheelDist, 0.0001));
  let spokes = float(0.0);
  for (let k = 0; k < 5; k++) {
    const ang = (k * Math.PI * 2) / 5;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const alongSpoke = wDir.x.mul(cs).add(wDir.y.mul(sn));
    const perp = abs(wDir.x.mul(sn).sub(wDir.y.mul(cs))).mul(wheelDist);
    spokes = max(spokes, smoothstep(0.034, 0.018, perp).mul(step(0.0, alongSpoke)));
  }
  const rimRing = smoothstep(wheelR.mul(0.56), wheelR.mul(0.6), wheelDist);
  const centerHub = smoothstep(0.068, 0.042, wheelDist);
  const centerCap = smoothstep(0.03, 0.018, wheelDist);
  const valveDot = smoothstep(0.028, 0.014, length(wheelVec.sub(vec2(0.0, wheelR.mul(-0.48)))));
  const alloyMetal = clamp(max(max(spokes, valveDot), max(rimRing, centerHub)).sub(centerCap.mul(0.85)), 0.0, 1.0);

  // Black plastic & rubber (grilles, seals, trims, tyres, cladding) is matte; lamps, glass & chrome are glossy
  const matte = max(
    max(max(isTyre, isTrim), max(intake, grille)),
    max(max(diffuser, under), max(max(cowlPanel, cladding), seal.mul(one.sub(max(glass, chromeBelt)))))
  );

  // ---- Colour ---------------------------------------------------------------------------------------------------
  // Liveries: NYPD (white with blue & light-blue side stripes, lettering on the front doors); the taxi's door badges
  // and medallion number
  const isNYPD = step(0.5, state.w).mul(isSide).mul(isBody);
  const doorMid = (spec.doors[0] + spec.doors[1]) / 2;
  const along = smoothstep(spec.zRear + 0.22, spec.zRear + 0.3, p.z).mul(smoothstep(spec.zFront - 0.28, spec.zFront - 0.36, p.z));
  const band = smoothstep(0.495, 0.5, p.y).mul(smoothstep(0.645, 0.64, p.y)).mul(along);
  const pin = smoothstep(0.663, 0.667, p.y).mul(smoothstep(0.687, 0.683, p.y)).mul(along);
  const lettering = step(0.45, sin(p.z.mul(70.0)))
    .mul(smoothstep(0.725, 0.73, p.y))
    .mul(smoothstep(0.81, 0.805, p.y))
    .mul(step(abs(p.z.sub(doorMid)), 0.22));
  let painted = mix(mix(paint, color(0x1d3f8f), max(band, lettering).mul(isNYPD)), color(0x6fa8dc), pin.mul(isNYPD));
  if (spec.sign) {
    const badge = roundedRect(vec2(p.z.sub(doorMid), p.y.sub(0.66)), vec2(0.21, 0.052), 0.012).mul(isSide).mul(isBody);
    const emblem = smoothstep(0.042, 0.036, length(vec2(abs(p.z.sub(doorMid)).sub(0.15), p.y.sub(0.66))));
    const letters = step(0.35, sin(p.z.mul(95.0)))
      .mul(step(abs(p.z.sub(doorMid)), 0.1))
      .mul(smoothstep(0.03, 0.026, abs(p.y.sub(0.66))));
    const medallion = step(0.3, sin(p.z.mul(150.0)))
      .mul(step(abs(p.z.sub(spec.zRear + 0.6)), 0.075))
      .mul(smoothstep(0.016, 0.013, abs(p.y.sub(0.8))))
      .mul(isSide)
      .mul(isBody);
    painted = mix(mix(painted, color(0x121417), badge), color(0xffbe14), max(emblem, letters).mul(badge));
    painted = mix(painted, color(0x121417), medallion);
  }

  // Panel shading: soft occlusion low down & under the arch lips; unpainted cladding (SUVs); door shut lines &
  // handles; trunk / hood shut lines; black cowl panel under the windshield
  const archLip = smoothstep(archR + 0.05, archR - 0.005, wheelDist).mul(smoothstep(0.6, 0.9, ax));
  const ao = smoothstep(0.2, 0.62, p.y).mul(0.22).add(0.78).mul(one.sub(archLip.mul(0.55)));
  const onDoors = isSide.mul(smoothstep(sillY + 0.04, sillY + 0.07, p.y)).mul(smoothstep(0.0, -0.015, p.y.sub(belt)));
  let seams = float(0.0);
  for (const zd of spec.doors) seams = max(seams, smoothstep(0.009, 0.003, abs(p.z.sub(zd))));
  for (const zh of spec.handles) {
    seams = max(seams, roundedRect(vec2(p.z.sub(zh), p.y.sub(belt.sub(0.095))), vec2(0.06, 0.011), 0.008));
  }
  let body = mix(painted.mul(ao), color(0x1e2124), cladding);
  body = body.mul(one.sub(seams.mul(onDoors).mul(0.55))).mul(one.sub(bumperSeam.mul(0.5)));
  body = mix(body, color(0x15181b), cowlPanel);

  // Nose: slatted lower grille & upper slot, headlamp housings with projector & LED strip, NY plate
  const slats = step(0.5, fract(p.y.mul(42.0))).mul(0.4).add(0.6);
  body = mix(body, color(0x111417).mul(slats), max(intake, grille));
  body = mix(body, mix(mix(color(0x23292f), color(0xdfe9f2), headlightLens), color(0xffffff), drl), headlight);
  // Tail: diffuser, reflectors, wraparound lamps (amber inner turn signal), plate recess; plates; dark underbody
  body = mix(body, color(0x15181b), diffuser);
  body = mix(body, color(0x7a0a10), reflector);
  body = mix(body, mix(color(0x8c0a12), color(0xc24d10), turnRear), taillight);
  body = mix(body, body.mul(0.55), plateRecess);
  body = mix(body, color(0xf2b718), plates);
  body = mix(body, color(0x0e1013), under);

  // Glasshouse: tinted glass, black seals & B / C pillars, painted roof & A pillars, chrome sill strip, CHMSL
  const glassCol = mix(color(0x0a1016), color(0x1a2632), smoothstep(0.2, 0.9, n.y));
  const windowCol = mix(mix(mix(mix(paint, color(0x111315), seal), glassCol, glass), color(0xc9ced3), chromeBelt), color(0x6a0a0e), chmsl);

  // Mirror caps (paint, glass facing back), taxi roof light, trims, alloys & tyres
  const mirrorCol = mix(paint, color(0x7c8a94), mirrorGlass);
  const signCol = mix(color(0xf3efe2), mix(color(0xfff1b8), color(0x15181b), signGlyph), signFace);
  const alloyCol = mix(color(0x0b0e12), color(0xd8e0e8), alloyMetal);
  const treadZone = smoothstep(wheelR.mul(0.74), wheelR.mul(0.83), wheelDist);
  const tyreBase = smoothstep(wheelR.mul(0.85), wheelR.mul(0.94), wheelDist).mul(0.22).add(0.78);
  const tyreCol = color(0x16181b).mul(tyreBase.add(spokes.mul(treadZone).mul(0.24)));

  let col = mix(body, windowCol, isWindow);
  col = mix(col, mirrorCol, isMirror);
  col = mix(col, signCol, isSign);
  col = mix(col, color(0x1b1e21), isTrim);
  col = mix(col, alloyCol, isAlloy);
  col = mix(col, tyreCol, isTyre);

  // ---- Roughness & metalness ---------------------------------------------------------------------------------------
  const alloySpokes = max(spokes, rimRing).mul(isAlloy);
  const glossy = max(max(max(glass, chromeBelt), mirrorGlass), lamp);
  let rough = mix(float(0.26), float(0.15), glossy);
  rough = mix(rough, float(0.4), plates);
  rough = mix(rough, float(0.35), isSign);
  rough = mix(rough, float(0.82), max(matte, isAlloy.sub(alloySpokes)));

  let metal = mix(float(0.34), float(0.14), glass);
  metal = mix(metal, float(0.6), max(lamp, mirrorGlass));
  metal = mix(metal, float(0.95), chromeBelt);
  metal = mix(metal, float(0.86), alloySpokes);
  metal = mix(metal, float(0.08), plates);
  metal = mix(metal, float(0.04), max(matte, isSign));

  // ---- Emissive: running lights, tail / brake lights & CHMSL, turn signals, taxi roof light -----------------------
  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  const headlamps = color(0xd9efff)
    .mul(headlight.mul(1.15).add(headlightLens.mul(1.15)).add(drl.mul(0.65)))
    .mul(nightHeadlamp)
    .mul(one.sub(turnFront.mul(blink)));
  const tail = color(0xff0a12).mul(taillight.mul(one.sub(turnRear)).mul(brake.mul(1.65).add(0.95)));
  const stop = color(0xff0a12).mul(chmsl.mul(brake).mul(2.1));
  const turn = color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.2));
  const sign = color(0xffe28a).mul(signFace.mul(one.sub(signGlyph.mul(0.9))).mul(1.65));

  const mat = new THREE.MeshStandardNodeMaterial();
  if (fixed) mat.userData.carState = stateUniform;
  mat.colorNode = col;
  mat.roughnessNode = rough;
  mat.metalnessNode = metal;
  mat.emissiveNode = headlamps.add(tail).add(stop).add(turn).add(sign);

  _carMaterialCache.set(cacheKey, mat);
  return mat;
}


// ============================================================================
// 3. TUBE SECTIONS ALONG A POLYLINE (the helicopter's skids; the people are built in pedestrians.js)
// ============================================================================
function ring(center, rx, rz, segments = 6, phase = 0) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2 + phase;
    return new THREE.Vector3(center.x + Math.cos(a) * rx, center.y, center.z + Math.sin(a) * rz);
  });
}

function limbSections(joints, segments = 6, phase = 0) {
  const rotation = new THREE.Quaternion();
  return joints.map(([center, rx, rz], i) => {
    const before = joints[Math.max(0, i - 1)][0];
    const after = joints[Math.min(joints.length - 1, i + 1)][0];
    rotation.setFromUnitVectors(_down, after.clone().sub(before).normalize());
    return ring(new THREE.Vector3(), rx, rz, segments, phase).map((p) =>
      p.applyQuaternion(rotation).add(center)
    );
  });
}

// ============================================================================
// 4. LOFTED MTA BUS GEOMETRY & TSL MATERIAL
// ============================================================================
// A 40-ft low-floor MTA bus lofted with the car body machinery: rounded plan-view corners, a raked windshield, a
// tight roof radius and arches over the wheels; bumpers, the folded front bike rack, stalk mirrors and the roof AC &
// battery pods are separate pieces of the same mesh (partId). Windows, doors, livery & lamps are painted by
// createLoftedBusMaterial(); destination signs are textured panels (buildBusSignGeometry).
const BUS_PARTS = {
  BODY: 0,
  TRIM: 1,
  POD: 2
};

const BUS_SPEC = {
  name: 'bus',
  headlight: [0.79, 0.8], // midpoint of each pair of white lamps; excludes the outer amber indicator
  zFront: 5.78,
  zRear: -5.78,
  wheelRadius: 0.48,
  wheelZ: 3.6,
  wheelX: 1.24,
  archGap: 0.09,
  archFlare: 0,
  tuck: 0.05,
  stationStep: 0.62,
  lowerRound: 2.6,
  upperRound: 6,
  upperSamples: [0.3, 0.56, 0.74, 0.88, 1],
  halfWidth: [[5.78, 1.3], [-5.78, 1.3]],
  sill: [[5.78, 0.36], [-5.78, 0.36]],
  shoulder: [[5.78, 1.05], [-5.78, 1.05]],
  edge: [[5.78, 2.96], [-5.78, 2.96]],
  crown: [[5.78, 0.045], [-5.78, 0.045]],
  tumble: [[5.78, 0.17], [-5.78, 0.17]],
  nose: { halfWidth: [0.28, 1.02, 2], edge: [0.24, 2.68, 2], crown: [0.24, 0.005, 2], sill: [0.07, 0.44, 2], shoulder: [0.2, 0.95, 2] },
  tail: { halfWidth: [0.24, 1.06, 2], edge: [0.2, 2.72, 2], crown: [0.2, 0.005, 2], sill: [0.09, 0.46, 2], shoulder: [0.2, 0.95, 2] },
  rake: 0.15, // how far the top of the windshield leans back
  window: [1.24, 2.44], // side window band (y)
  frontDoor: [4.36, 5.36], // curb-side (-x) doors (z ranges)
  rearDoor: [-1.52, -0.5]
};

// The windshield rake: the upper front leans back by up to BUS_SPEC.rake, fading out along the first metre
function busRake(y, z) {
  const s = BUS_SPEC;
  const along = Math.min(1, Math.max(0, (z - (s.zFront - 1.0)) / 1.0));
  const up = Math.min(1, Math.max(0, (y - 1.0) / 1.75));
  return s.rake * along * along * Math.pow(up, 1.3);
}

function buildLoftedBusBodyGeometry() {
  const s = BUS_SPEC;
  const body = buildBodyLoft(s, 1);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - busRake(pos.getY(i), pos.getZ(i)));
  body.computeVertexNormals();
  const parts = [part(body, BUS_PARTS.BODY)];

  // Bumpers, front bike rack (folded), stalk mirrors
  parts.push(part(roundedBox(1.24, 0.12, 0.24, 0.07, 0.03).translate(0, 0.5, s.zFront - 0.05), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(1.24, 0.11, 0.22, 0.06, 0.03).translate(0, 0.48, s.zRear + 0.05), BUS_PARTS.TRIM));
  const rackZ = s.zFront + 0.13;
  parts.push(part(roundedBox(0.5, 0.024, 0.05, 0.02, 0.008).translate(0, 1.0, rackZ + 0.05), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(0.46, 0.02, 0.05, 0.018, 0.008).translate(0, 0.74, rackZ), BUS_PARTS.TRIM));
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.035, 0.36, 0.035).rotateX(-0.14).translate(side * 0.47, 0.83, rackZ + 0.02), BUS_PARTS.TRIM));
    // Mirror stalk from the roof corner, curving forward & out to a tall mirror head ahead of the windshield corner
    const stalk = new THREE.BoxGeometry(0.035, 0.035, 0.5)
      .rotateX(0.55)
      .rotateY(side * 0.35)
      .translate(side * 1.2, 2.58, s.zFront - 0.12);
    const head = roundedBox(0.075, 0.2, 0.06, 0.03, 0.012).translate(side * 1.36, 2.24, s.zFront + 0.12);
    parts.push(part(stalk, BUS_PARTS.TRIM), part(head, BUS_PARTS.TRIM));
  }

  // Roof equipment: air-conditioning pod at the rear, hybrid battery pod ahead of it
  const roofY = s.edge[0][1] + s.crown[0][1];
  parts.push(part(roundedBox(0.98, 0.15, 2.5, 0.12, 0.05).translate(0, roofY + 0.1, -3.55), BUS_PARTS.POD));
  parts.push(part(roundedBox(0.82, 0.1, 3.0, 0.08, 0.04).translate(0, roofY + 0.06, 1.1), BUS_PARTS.POD));

  // Arch liners
  for (const side of [-1, 1]) {
    for (const z of [-s.wheelZ, s.wheelZ]) {
      const well = new THREE.CircleGeometry(s.wheelRadius + s.archGap + 0.01, 10, 0, Math.PI)
        .rotateY(side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.2), s.wheelRadius, z);
      parts.push(part(well, BUS_PARTS.TRIM));
    }
  }
  return mergeGeometries(parts);
}

/**
 * Destination sign panels for the bus's sign texture (route badge + destination): above the windshield, on the curb
 * side by the front door, and the route badge alone above the rear window. Same object space as the bus body.
 */
function buildBusSignGeometry() {
  const s = BUS_SPEC;
  const panels = [];
  const yF = 2.55;
  const front = new THREE.PlaneGeometry(1.9, 0.27);
  front.rotateX(-Math.atan2(s.rake * 1.3 * 0.62, 1.75));
  front.translate(0, yF, s.zFront - busRake(yF, s.zFront) + 0.012);
  panels.push(front);
  const side = new THREE.PlaneGeometry(1.15, 0.2).rotateY(-Math.PI / 2);
  side.translate(-(carBodyHalfWidthAt(s, 3.9, 2.58) + 0.006), 2.58, 3.9);
  panels.push(side);
  const rear = new THREE.PlaneGeometry(0.52, 0.2);
  const uv = rear.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.29);
  rear.rotateY(Math.PI).translate(0, 2.55, s.zRear - 0.012);
  panels.push(rear);
  return mergeGeometries(panels);
}

// Bus wheel: tall tyre with a deep steel disc, 10 lug nuts and a hub cap on both outer and inner faces (spins about x, centred on the origin)
function buildBusWheelGeo(side) {
  const r = BUS_SPEC.wheelRadius;
  const w = 0.3;
  const tyre = new THREE.LatheGeometry(
    [
      new THREE.Vector2(r * 0.72, -w * 0.5),
      new THREE.Vector2(r * 0.97, -w * 0.38),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.97, w * 0.38),
      new THREE.Vector2(r * 0.72, w * 0.5)
    ],
    20
  );
  const disc = new THREE.LatheGeometry(
    [new THREE.Vector2(r * 0.72, w * 0.5), new THREE.Vector2(r * 0.66, w * 0.4), new THREE.Vector2(r * 0.56, w * 0.18), new THREE.Vector2(0.15, w * 0.16)],
    20
  );
  const backDisc = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, -w * 0.16),
      new THREE.Vector2(0.15, -w * 0.16),
      new THREE.Vector2(r * 0.56, -w * 0.18),
      new THREE.Vector2(r * 0.66, -w * 0.4),
      new THREE.Vector2(r * 0.72, -w * 0.5)
    ],
    20
  );
  const cap = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14).translate(0, w * 0.2, 0);
  const backCap = new THREE.CylinderGeometry(0.13, 0.1, 0.12, 14).translate(0, -w * 0.2, 0);
  const parts = [
    part(tyre, CAR_PARTS.TYRE),
    part(disc, CAR_PARTS.ALLOY),
    part(backDisc, CAR_PARTS.ALLOY),
    part(cap, CAR_PARTS.ALLOY),
    part(backCap, CAR_PARTS.ALLOY)
  ];
  for (const g of parts) g.rotateZ(-side * Math.PI * 0.5);
  return mergeGeometries(parts);
}

let _busWheelMat = null;

function createBusWheelMaterial() {
  if (_busWheelMat) return _busWheelMat;
  const p = attribute('position', 'vec3');
  const partId = attribute('partId', 'float');
  const isTyre = step(abs(partId.sub(CAR_PARTS.TYRE)), 0.25);
  const radial = length(vec2(p.z, p.y));
  const angle = vec2(p.z, p.y).div(max(radial, 0.0001));
  let lugs = float(0.0);
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI * 2) / 10;
    lugs = max(lugs, smoothstep(0.024, 0.014, length(vec2(p.z, p.y).sub(vec2(Math.cos(a) * 0.205, Math.sin(a) * 0.205)))));
  }
  const groove = smoothstep(0.006, 0.0, abs(radial.sub(0.29)));
  const steel = color(0xb9c0c6).mul(float(1.0).sub(groove.mul(0.5)));
  const hub = mix(steel, color(0x6b7176), smoothstep(0.13, 0.1, radial));
  const disc = mix(hub, color(0x2a2e33), lugs.mul(0.8));
  const sidewall = smoothstep(0.37, 0.43, radial).mul(0.25).add(0.75);
  const tread = step(0.5, fract(angle.y.mul(9.0).add(angle.x.mul(9.0)))).mul(0.08);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(disc, color(0x17191c).mul(sidewall.add(tread)), isTyre);
  mat.roughnessNode = mix(float(0.35), float(0.88), isTyre);
  mat.metalnessNode = mix(float(0.75), float(0.0), isTyre);
  _busWheelMat = mat;
  return mat;
}

let _busLoftedMat = null;

/**
 * Creates the TSL procedural material for MTA buses:
 * - Wraparound split windshield with gasket & centre post, destination sign band above it; rear window & engine
 *   louvres on the rear face
 * - Continuous side window band with mullions, the driver's window, glazed curb-side front & rear doors
 * - MTA livery: pearl white with the vivid blue band & cyan ribbon below the windows and a dark skirt
 * - Headlamps, turn signals (per-instance `busState`: brake, left (+x), right (-x)), tail / brake light columns,
 *   NY plates; black trims & light-grey roof pods
 */
function createLoftedBusMaterial() {
  if (_busLoftedMat) return _busLoftedMat;
  const s = BUS_SPEC;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const state = attribute('busState', 'vec4');
  const isBody = step(abs(partId.sub(BUS_PARTS.BODY)), 0.25);
  const isTrim = step(abs(partId.sub(BUS_PARTS.TRIM)), 0.25);
  const isPod = step(abs(partId.sub(BUS_PARTS.POD)), 0.25);
  const ax = abs(p.x);
  const one = float(1.0);

  const front = smoothstep(0.1, 0.35, n.z).mul(step(s.zFront - 0.9, p.z)).mul(isBody);
  const rear = smoothstep(0.1, 0.35, n.z.negate()).mul(step(p.z, s.zRear + 0.9)).mul(isBody);
  const side = smoothstep(0.5, 0.75, abs(n.x)).mul(isBody);
  const curb = step(p.x, 0.0);

  // Windshield (wrapping round the corners), sign band, gasket; rear window & engine louvres
  const frontGlass = roundedRect(vec2(p.x, p.y.sub(1.82)), vec2(1.2, 0.58), 0.14).mul(smoothstep(0.012, 0.024, ax)).mul(front);
  const frontSeal = roundedRect(vec2(p.x, p.y.sub(1.82)), vec2(1.24, 0.62), 0.16).mul(front);
  const signBand = roundedRect(vec2(p.x, p.y.sub(2.55)), vec2(1.02, 0.16), 0.04).mul(front);
  const rearGlass = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.92, 0.36), 0.08).mul(rear);
  const rearSeal = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.96, 0.4), 0.1).mul(rear);
  const louvres = roundedRect(vec2(p.x, p.y.sub(0.98)), vec2(0.78, 0.34), 0.05).mul(rear);
  const slats = step(0.5, fract(p.y.mul(16.0))).mul(0.45).add(0.4);

  // Side window band with mullions; driver's window; curb-side doors (glazed leaves, frames)
  const [wy0, wy1] = s.window;
  const winMid = (wy0 + wy1) / 2;
  const winHalf = (wy1 - wy0) / 2;
  const sideBand = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.82, winHalf), 0.08).mul(side);
  const mullion = smoothstep(0.03, 0.045, abs(fract(p.z.mul(0.8).add(0.35)).sub(0.5).mul(1.25)));
  const sideSeal = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.86, winHalf + 0.04), 0.1).mul(side);
  const driverWin = roundedRect(vec2(p.z.sub(4.86), p.y.sub(winMid + 0.04)), vec2(0.5, winHalf + 0.04), 0.1).mul(side).mul(one.sub(curb));
  const door = (z0, z1) => {
    const zc = (z0 + z1) / 2;
    const hw = (z1 - z0) / 2;
    const frame = roundedRect(vec2(p.z.sub(zc), p.y.sub(1.44)), vec2(hw, 1.0), 0.05);
    const leaves = roundedRect(vec2(abs(p.z.sub(zc)).sub(hw * 0.5), p.y.sub(1.5)), vec2(hw * 0.4, 0.84), 0.035);
    return { frame: frame.mul(side).mul(curb), glass: leaves.mul(side).mul(curb) };
  };
  const d0 = door(s.frontDoor[0], s.frontDoor[1]);
  const d1 = door(s.rearDoor[0], s.rearDoor[1]);
  const doorFrame = max(d0.frame, d1.frame);
  const glass = clamp(max(max(frontGlass, rearGlass), max(max(sideBand.mul(mullion), driverWin), max(d0.glass, d1.glass))), 0.0, 1.0);
  const seal = clamp(max(max(frontSeal, rearSeal), max(max(sideSeal, signBand), doorFrame)), 0.0, 1.0);

  // MTA livery
  const shadeY = smoothstep(0.34, 1.2, p.y).mul(0.2).add(0.8);
  const blueStripe = smoothstep(0.9, 0.93, p.y).mul(smoothstep(1.2, 1.17, p.y));
  const cyanRibbon = smoothstep(0.84, 0.86, p.y).mul(smoothstep(0.885, 0.865, p.y));
  const skirt = smoothstep(0.53, 0.5, p.y);
  const livery = mix(mix(mix(color(0xf0f4f8), color(0x0058b8), blueStripe), color(0x00a8e8), cyanRibbon), color(0x1c2026), skirt).mul(shadeY);

  // Lamps: twin round headlamps & amber turn signals in black pods; red tail / brake light columns, amber turn &
  // white reverse lamps at the rear corners; plates
  const pod = roundedRect(vec2(ax.sub(0.86), p.y.sub(0.8)), vec2(0.27, 0.085), 0.06).mul(front);
  const headLamp = max(
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.72), p.y.sub(0.8)))),
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.86), p.y.sub(0.8))))
  ).mul(pod);
  const turnFront = smoothstep(0.045, 0.035, length(vec2(ax.sub(1.02), p.y.sub(0.8)))).mul(pod);
  const tailCol = roundedRect(vec2(ax.sub(1.04), p.y.sub(0.92)), vec2(0.075, 0.27), 0.05).mul(rear);
  const tailLamp = tailCol.mul(smoothstep(0.93, 0.95, p.y));
  const turnRear = tailCol.mul(smoothstep(0.92, 0.9, p.y)).mul(smoothstep(0.76, 0.78, p.y));
  const reverse = tailCol.mul(smoothstep(0.75, 0.73, p.y));
  const plate = roundedRect(vec2(p.x, p.y.sub(0.77)), vec2(0.16, 0.06), 0.008).mul(max(front.mul(step(ax, 0.3)), rear));

  let body = mix(livery, color(0x15191e), seal);
  body = mix(body, color(0x1a1e23).mul(slats), louvres);
  body = mix(body, color(0x111418), pod);
  body = mix(body, mix(color(0xdcefff), color(0xffa21a), turnFront), max(headLamp, turnFront));
  body = mix(body, color(0x9a0d14), tailLamp);
  body = mix(body, color(0xc8641a), turnRear);
  body = mix(body, color(0xe8eef2), reverse);
  body = mix(body, color(0xf2b718), plate);
  const glassTint = mix(color(0x0e1a26), color(0x1b3046), clamp(p.y.sub(1.3).mul(0.8), 0.0, 1.0));
  body = mix(body, glassTint, glass);

  const col = mix(mix(body, color(0x1b1f24), isTrim), color(0xc9ced3), isPod);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.roughnessNode = mix(mix(mix(float(0.3), float(0.16), max(glass, max(headLamp, tailCol))), float(0.7), max(isTrim, seal.mul(one.sub(glass)))), float(0.45), isPod);
  mat.metalnessNode = mix(mix(float(0.22), float(0.7), glass), float(0.05), max(isTrim, isPod));

  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xd9efff)
    .mul(pod.mul(0.45).add(headLamp.mul(1.35)))
    .mul(nightHeadlamp)
    .add(color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.0)))
    .add(color(0xff0a12).mul(tailLamp.mul(brake.mul(1.5).add(0.75))));

  _busLoftedMat = mat;
  return mat;
}

// ============================================================================
// 5. 3D LOFTED MANHATTAN SIGHTSEEING HELICOPTER GEOMETRY & TSL MATERIAL
// ============================================================================
const HELI_PARTS = {
  FUSELAGE: 0,
  COWLING: 1,
  FIN: 2,
  SKID: 3,
  ROTOR: 4,
  EXHAUST: 5
};

/**
 * Helper to create a 12-point symmetric helicopter fuselage cross-section
 * with flattened belly floor, rounded lower chines, wide panoramic cabin flanks,
 * tumblehome upper glass/shoulder, and crowned roof/tailboom.
 */
function heliFuselageSection(z, halfW, botY, topY, bellyFlat = 0.68, shoulderRatio = 0.52) {
  const h = Math.max(0.08, topY - botY);
  const chineY = botY + h * 0.16;
  const shoulderY = botY + h * shoulderRatio;
  const eaveY = botY + h * 0.86;

  const right = [
    new THREE.Vector3(halfW * bellyFlat * 0.55, botY, z),
    new THREE.Vector3(halfW * 0.92, chineY, z),
    new THREE.Vector3(halfW, shoulderY, z),
    new THREE.Vector3(halfW * 0.88, eaveY, z),
    new THREE.Vector3(halfW * 0.46, topY - h * 0.03, z),
    new THREE.Vector3(0.0, topY, z)
  ];
  const left = right
    .slice(0, 5)
    .reverse()
    .map((p) => new THREE.Vector3(-p.x, p.y, p.z));
  const bottomCenter = [new THREE.Vector3(0.0, botY, z)];
  return [...bottomCenter, ...right, ...left].reverse();
}

/**
 * Helper to create an 8-point symmetric airfoil / cowling cross-section.
 */
function heliAirfoilSection(xCenter, yCenter, zCenter, halfThickX, halfHeightY, chordZ) {
  // Airfoil lying along Z (for vertical fin) or X (for horizontal stabilizer)
  return [
    new THREE.Vector3(xCenter, yCenter, zCenter + chordZ * 0.5),
    new THREE.Vector3(xCenter + halfThickX, yCenter, zCenter + chordZ * 0.18),
    new THREE.Vector3(xCenter + halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter, yCenter, zCenter - chordZ * 0.5),
    new THREE.Vector3(xCenter - halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter - halfThickX, yCenter, zCenter + chordZ * 0.18)
  ];
}

function buildHelicopterBodyGeometry() {
  const parts = [];

  // 1. Continuous 3D Lofted Monocoque Fuselage-to-Tailboom (15 stations from z = +2.82 nose to z = -5.85 tail)
  // [z, halfW, botY, topY, bellyFlat, shoulderRatio]
  const fuselageProfile = [
    [2.82, 0.16, 0.88, 1.02, 0.50, 0.50], // Aerodynamic nose tip
    [2.62, 0.54, 0.72, 1.18, 0.62, 0.48], // Lower nose chin window
    [2.20, 0.88, 0.58, 1.48, 0.72, 0.46], // Lower windshield base
    [1.55, 1.10, 0.52, 1.86, 0.78, 0.44], // Front pilot cabin & wide panoramic windscreen
    [0.75, 1.16, 0.50, 2.02, 0.80, 0.45], // Main sightseeing passenger cabin (widest section)
    [-0.15, 1.14, 0.50, 2.02, 0.80, 0.46], // Rear passenger cabin
    [-0.95, 1.02, 0.54, 1.96, 0.74, 0.50], // Cabin-to-cowling transition
    [-1.65, 0.74, 0.72, 1.84, 0.62, 0.54], // Rear baggage & tapered clamshell bay
    [-2.35, 0.42, 1.12, 1.74, 0.45, 0.55], // Forward tailboom root
    [-3.25, 0.31, 1.24, 1.72, 0.40, 0.55], // Mid tailboom
    [-4.35, 0.24, 1.32, 1.70, 0.38, 0.55], // Stabilizer station
    [-5.35, 0.18, 1.38, 1.68, 0.36, 0.55], // Rear tailboom before fin
    [-5.85, 0.12, 1.43, 1.65, 0.35, 0.55]  // Tailboom tip cap
  ];

  const fuselageSections = fuselageProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(fuselageSections, { capStart: true, capEnd: true }), HELI_PARTS.FUSELAGE));

  // 2. Sculpted Twin-Turbine Upper Engine Cowling & Mast Doghouse (lofted from z = +0.55 to -2.25)
  const cowlingProfile = [
    [0.55, 0.32, 1.94, 2.12, 0.85, 0.45],
    [0.10, 0.56, 1.96, 2.38, 0.85, 0.48],
    [-0.55, 0.62, 1.94, 2.44, 0.85, 0.50],
    [-1.25, 0.56, 1.88, 2.36, 0.82, 0.50],
    [-1.85, 0.38, 1.76, 2.10, 0.78, 0.50],
    [-2.28, 0.20, 1.68, 1.82, 0.70, 0.50]
  ];
  const cowlingSections = cowlingProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(cowlingSections, { capStart: true, capEnd: true }), HELI_PARTS.COWLING));

  // Twin Canted Turbine Exhaust Nozzles tucked cleanly into rear of engine cowling
  for (const side of [-1, 1]) {
    const exhaust = new THREE.CylinderGeometry(0.10, 0.125, 0.34, 14)
      .rotateX(Math.PI * 0.46)
      .rotateY(side * 0.10)
      .translate(side * 0.24, 2.08, -1.72);
    parts.push(part(exhaust, HELI_PARTS.EXHAUST));
  }

  // 3. 3D Lofted Swept Vertical Tail Fin (Airfoil cross-sections sweeping from z = -5.15 to -6.15)
  // Upper swept fin + lower ventral tail bumper fin
  const vFinProfile = [
    [-0.02, 0.88, -5.28, 0.05, 0.0, 0.44], // Ventral tail fin tip
    [0.0,   1.48, -5.25, 0.12, 0.0, 0.88], // Tailboom junction root
    [0.0,   1.95, -5.52, 0.10, 0.0, 0.76], // Mid swept vertical fin
    [0.0,   2.48, -5.82, 0.08, 0.0, 0.60], // Upper swept vertical fin
    [0.0,   2.82, -6.04, 0.05, 0.0, 0.42]  // Top anti-collision beacon tip
  ];
  const vFinSections = vFinProfile.map(([x, y, z, hx, hy, cz]) =>
    heliAirfoilSection(x, y, z, hx, hy, cz).reverse()
  );
  parts.push(part(new LoftGeometry(vFinSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // 4. 3D Lofted Horizontal Stabilizer Wing + Angled Endplate Winglets at z = -4.25
  const hStabSections = [-1.08, -0.55, 0.0, 0.55, 1.08].map((x) => {
    const taper = 1.0 - Math.abs(x) * 0.24;
    const chord = 0.46 * taper;
    const thick = 0.045 * taper;
    const y = 1.54;
    const z = -4.22 - Math.abs(x) * 0.12;
    return [
      new THREE.Vector3(x, y, z + chord * 0.5),
      new THREE.Vector3(x, y + thick, z + chord * 0.15),
      new THREE.Vector3(x, y + thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y, z - chord * 0.5),
      new THREE.Vector3(x, y - thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y - thick, z + chord * 0.15)
    ];
  });
  parts.push(part(new LoftGeometry(hStabSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // Endplate Winglets on Horizontal Stabilizer tips
  for (const side of [-1, 1]) {
    const wx = side * 1.08;
    const wz = -4.35;
    const winglet = [
      [-0.22, 0.028, 0.30],
      [0.0,   0.036, 0.38],
      [0.26,  0.024, 0.26]
    ].map(([dy, hx, cz]) =>
      heliAirfoilSection(wx + side * Math.abs(dy) * 0.12, 1.54 + dy, wz - Math.abs(dy) * 0.15, hx, 0, cz).reverse()
    );
    parts.push(part(new LoftGeometry(winglet, { capStart: true, capEnd: true }), HELI_PARTS.FIN));
  }

  // 5. Tubular Landing Skids (LoftGeometry curved skids with upturned front runners + arched cross-tubes + steps)
  for (const side of [-1, 1]) {
    const sx = side * 1.12;
    // Skid runner tube from upturned front tip (z = +2.15, y = 0.28) along ground (y = 0.07) to rear tip (z = -1.75)
    const skidJoints = [
      [new THREE.Vector3(sx, 0.28, 2.15), 0.036, 0.036],
      [new THREE.Vector3(sx, 0.12, 1.88), 0.045, 0.045],
      [new THREE.Vector3(sx, 0.07, 1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, 0.0),  0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, -1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.12, -1.75), 0.038, 0.038]
    ];
    const skidSections = skidJoints.map(([c, rx, ry]) =>
      Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return new THREE.Vector3(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry, c.z);
      }).reverse()
    );
    parts.push(part(new LoftGeometry(skidSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));

    // Passenger boarding step plate
    const stepBar = new THREE.BoxGeometry(0.14, 0.03, 0.88).translate(side * 1.02, 0.28, 0.42);
    parts.push(part(stepBar, HELI_PARTS.SKID));
  }

  // Front & Rear Arched Skid Cross-Tubes hugging the fuselage belly
  for (const cz of [1.05, -0.82]) {
    const crossPoints = [
      [new THREE.Vector3(-1.12, 0.09, cz), 0.042, 0.042],
      [new THREE.Vector3(-0.92, 0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(-0.62, 0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.62,  0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.92,  0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(1.12,  0.09, cz), 0.042, 0.042]
    ];
    const crossSections = limbSections(crossPoints, 8);
    parts.push(part(new LoftGeometry(crossSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));
  }

  // Wire-strike cutter & pitot tube on nose
  const pitot = new THREE.CylinderGeometry(0.015, 0.025, 0.35, 6)
    .rotateX(Math.PI * 0.5)
    .translate(0, 0.88, 2.88);
  parts.push(part(pitot, HELI_PARTS.SKID));

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Main Rotor Hub, Swashplate, and Tapered Airfoil Rotor Blades.
 */
function buildHelicopterMainRotorGeometry() {
  const parts = [];

  // Rotor mast, swashplate collar & aerodynamic hub dome
  const mast = new THREE.CylinderGeometry(0.11, 0.14, 0.52, 14).translate(0, -0.18, 0);
  const swash = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 16).translate(0, -0.12, 0);
  const hubCap = new THREE.SphereGeometry(0.28, 16, 10)
    .scale(1.0, 0.42, 1.0)
    .translate(0, 0.04, 0);
  parts.push(
    part(mast, HELI_PARTS.SKID),
    part(swash, HELI_PARTS.EXHAUST),
    part(hubCap, HELI_PARTS.ROTOR)
  );

  // 4 Tapered Airfoil Main Rotor Blades with pitch cuff grips
  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const cuff = new THREE.BoxGeometry(0.65, 0.045, 0.14)
      .translate(0.52, 0, 0)
      .rotateY(angle);
    const blade = new THREE.BoxGeometry(4.45, 0.024, 0.26)
      .rotateX(0.08) // Realistic collective blade pitch
      .translate(2.68, 0, 0)
      .rotateY(angle);
    parts.push(part(cuff, HELI_PARTS.SKID), part(blade, HELI_PARTS.ROTOR));
  }

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Tail Rotor Assembly.
 */
function buildHelicopterTailRotorGeometry() {
  const parts = [];
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12)
    .rotateZ(Math.PI * 0.5);
  parts.push(part(hub, HELI_PARTS.EXHAUST));

  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const blade = new THREE.BoxGeometry(0.022, 0.76, 0.13)
      .translate(0, 0.42, 0)
      .rotateX(angle);
    parts.push(part(blade, HELI_PARTS.ROTOR));
  }
  return mergeGeometries(parts);
}

let _heliLoftedMat = null;

/**
 * Creates the TSL procedural material for the 3D Lofted Sightseeing Helicopter:
 * - Renders wrap-around panoramic windscreen, chin bubble windows, sightseeing cabin side windows,
 *   and overhead skylight glass using anti-aliased `roundedRect` SDFs with rubber seals & frame pillars.
 * - Renders a sleek flush executive NYC Sightseeing livery (Pearl Aviation White upper cabin,
 *   Deep Midnight Navy belly/tailboom, and a sweeping Metallic Gold & Crimson accent stripe).
 * - Renders slatted turbine air intakes on the engine cowling and high-visibility yellow tips on rotor blades.
 */
function createLoftedHelicopterMaterial() {
  if (_heliLoftedMat) return _heliLoftedMat;

  const mat = new THREE.MeshStandardNodeMaterial();

  const evaluateHeliSurface = Fn(() => {
    const partId = attribute('partId', 'float');
    const isCowling = step(abs(partId.sub(HELI_PARTS.COWLING)), 0.25);
    const isFin = step(abs(partId.sub(HELI_PARTS.FIN)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);

    const p = attribute('position', 'vec3').toVar();
    const n = attribute('normal', 'vec3').toVar();

    // 1. Panoramic Wrap-Around Cockpit Windscreen & Sightseeing Side Cabin Windows (on Fuselage)
    // Front windscreen: z in [0.95, 2.52], y in [0.98, 1.88], split by narrow center post at x = 0
    const frontGlassOuter = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14)
      .mul(step(0.65, p.z));
    const centerPost = smoothstep(0.022, 0.036, abs(p.x));
    const aPillar = smoothstep(0.028, 0.044, abs(p.z.sub(1.06)));
    const bPillar = smoothstep(0.026, 0.042, abs(p.z.sub(0.08)));

    // Lower nose chin bubble windows (for pilot downward visibility)
    const chinWindow = roundedRect(vec2(abs(p.x).sub(0.28), p.y.sub(0.84)), vec2(0.19, 0.11), 0.04)
      .mul(smoothstep(1.95, 2.15, p.z))
      .mul(smoothstep(2.68, 2.52, p.z));

    // Wide panoramic passenger sightseeing side windows: z in [-0.78, 1.02], y in [1.02, 1.74]
    const sideWindow = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10)
      .mul(step(0.45, abs(n.x)));

    // Overhead cockpit eyebrow skylight windows
    const skylight = roundedRect(vec2(abs(p.x).sub(0.32), p.z.sub(1.25)), vec2(0.20, 0.38), 0.06)
      .mul(step(1.72, p.y));

    const rawWindowMask = max(
      max(frontGlassOuter.mul(centerPost), sideWindow),
      max(chinWindow, skylight)
    )
      .mul(aPillar)
      .mul(bPillar)
      .mul(isFuselage)
      .toVar();

    // Rubber window weatherstripping seal around glass panes
    const rawSealMask = max(
      roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.80, 0.46), 0.15).mul(step(0.60, p.z)),
      roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.92, 0.38), 0.12).mul(step(0.40, abs(n.x)))
    )
      .mul(isFuselage)
      .toVar();

    // 2. Flush Executive NYC Sightseeing Livery (Aviation White + Midnight Navy + Sweeping Gold Ribbon)
    const navyCurveY = float(1.00).add(p.z.mul(-0.085));
    const edgeW = max(fwidth(p.y), 0.008);
    const isLowerNavy = smoothstep(navyCurveY.add(edgeW), navyCurveY.sub(edgeW), p.y);
    const goldStripeDist = abs(p.y.sub(navyCurveY.add(0.065)));
    const isGoldStripe = smoothstep(0.055, 0.038, goldStripeDist);
    const redPinDist = abs(p.y.sub(navyCurveY.add(0.145)));
    const isRedPin = smoothstep(0.022, 0.012, redPinDist);

    // Cabin door panel seams & handles
    const doorSeam1 = smoothstep(0.012, 0.004, abs(p.z.sub(1.06)));
    const doorSeam2 = smoothstep(0.012, 0.004, abs(p.z.sub(0.08)));
    const doorSeam3 = smoothstep(0.012, 0.004, abs(p.z.sub(-0.82)));
    const doorHandle = roundedRect(vec2(p.z.sub(0.24), p.y.sub(0.94)), vec2(0.065, 0.014), 0.006);
    const panelLines = max(max(doorSeam1, max(doorSeam2, doorSeam3)), doorHandle)
      .mul(step(0.55, abs(n.x)))
      .mul(smoothstep(0.55, 0.62, p.y))
      .mul(smoothstep(1.75, 1.65, p.y));

    const whitePaint = color(0xf4f7fb);
    const navyPaint = color(0x132c58);
    const goldPaint = color(0xffbe28);
    const redPaint = color(0xd8222b);

    const baseLivery = mix(
      mix(mix(whitePaint, navyPaint, isLowerNavy), goldPaint, isGoldStripe),
      redPaint,
      isRedPin
    ).mul(float(1.0).sub(panelLines.mul(0.45)));

    const glassCol = mix(color(0x102234), color(0x1e3c58), clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0));
    const fuselageCol = mix(mix(baseLivery, color(0x14181e), rawSealMask), glassCol, rawWindowMask);

    // 3. Engine Cowling: Aviation White with Dark Slatted Turbine Intake Grille
    const intakeGrille = roundedRect(vec2(p.z.sub(-0.45), p.y.sub(2.18)), vec2(0.52, 0.13), 0.04)
      .mul(step(0.35, abs(n.x)));
    const louverSlats = step(0.45, fract(p.y.mul(55.0))).mul(0.4).add(0.35);
    const cowlingCol = mix(
      mix(whitePaint, goldPaint, smoothstep(2.02, 1.97, p.y)),
      color(0x181c22).mul(louverSlats),
      intakeGrille
    );

    // 4. Swept Tail Fin & Stabilizer: Deep Navy with Gold Tip Accent
    const finGoldBand = smoothstep(2.42, 2.45, p.y).mul(smoothstep(2.62, 2.59, p.y));
    const finCol = mix(navyPaint, goldPaint, finGoldBand);

    // 5. Rotor Blades: Matte Anthracite Carbon with High-Visibility Yellow Safety Tips
    const radialDist = length(vec2(p.x, p.z));
    const isBladeTip = smoothstep(4.35, 4.42, radialDist).add(
      smoothstep(0.65, 0.68, abs(p.y)).mul(step(radialDist, 0.35))
    );
    const rotorCol = mix(color(0x1e232a), goldPaint, clamp(isBladeTip, 0.0, 1.0));

    const skidCol = color(0x22272e);
    const exhaustBore = step(0.65, n.z.negate());
    const exhaustCol = mix(color(0x484f58), color(0x101318), exhaustBore);

    return mix(
      mix(
        mix(
          mix(
            mix(fuselageCol, cowlingCol, isCowling),
            finCol,
            isFin
          ),
          skidCol,
          isSkid
        ),
        rotorCol,
        isRotor
      ),
      exhaustCol,
      isExhaust
    );
  });

  mat.colorNode = evaluateHeliSurface();

  mat.roughnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.20), float(0.05), isGlass), float(0.55), max(isSkid, isRotor));
  })();

  mat.metalnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.35), float(0.88), isGlass), float(0.82), isExhaust);
  })();

  _heliLoftedMat = mat;
  return mat;
}

Object.assign(window.NYC, { CAR_PARTS, BODY_SPECS, carLayout, carBodyHalfWidthAt, buildCarSidePatch, buildSteerableWheelGeo, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial, buildLightbarGeometry, createLightbarMaterial, BUS_SPEC, buildLoftedBusBodyGeometry, buildBusSignGeometry, buildBusWheelGeo, createBusWheelMaterial, createLoftedBusMaterial, buildHelicopterBodyGeometry, buildHelicopterMainRotorGeometry, buildHelicopterTailRotorGeometry, createLoftedHelicopterMaterial });
})();
