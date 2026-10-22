(function () {
// js/street-details.js
// Populates Manhattan streets with authentic NYC street furniture using InstancedMesh:
// - Cantilevered NYC Yellow Traffic Signals at all 63 intersections
// - NYC DOT Cobra-head LED Streetlights
// - Con Edison Orange/White Steam Stacks + Volumetric TSL Rising Steam Plumes
// - MTA Subway Stair Entrances with Glowing Green Globe Lamps
// - NYC Hot Dog / Halal Street Carts with Blue & Yellow Umbrellas
// - Fire Hydrants, USPS Mailboxes, Litter Baskets, and Park/Street Trees

const { THREE } = window.NYC;
const {
  Fn,
  float,
  color,
  positionWorld,
  uniform,
  mod,
  fract,
  step,
  smoothstep,
  mix
} = window.NYC.TSL;
const { mergeGeometries } = window.NYC.Addons;
const { AVENUES, ALL_AVENUES, STREETS, streetZ, SIGNAL_TIMING, getBlockBounds, blockAt, cityUniforms, fromOldFrame } = window.NYC;
const {
  createSteamMaterial,
  createTreeGrateMaterial,
  createGodRayMaterial,
  createTreeField
} = window.NYC;

function createStreetSignBladeTexture(label) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d6b3f';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 30px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * TSL 3-Aspect Traffic Signal Lens Material (Red y=5.78, Amber y=5.42, Green y=5.06)
 * Driven by the shared signal clock and SIGNAL_TIMING (city-config.js), which js/traffic.js obeys.
 */
function createTrafficSignalLensMaterial(isAvenueHead, clock) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const wy = positionWorld.y;
    const isTopRed = step(5.60, wy);
    const isBottomGreen = float(1.0).sub(step(5.24, wy));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Avenue phase: Green, then Amber from avenueAmber, Red from avenueRed
    // Street phase: Red until avenueRed, then Green, Amber from streetAmber
    const greenActive = isAvenueHead
      ? float(1.0).sub(step(avenueAmber, t))
      : step(avenueRed, t).mul(float(1.0).sub(step(streetAmber, t)));
    const amberActive = isAvenueHead
      ? step(avenueAmber, t).mul(float(1.0).sub(step(avenueRed, t)))
      : step(streetAmber, t);
    const redActive = isAvenueHead
      ? step(avenueRed, t)
      : float(1.0).sub(step(avenueRed, t));

    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));

    const lensHue = mix(
      mix(color(0x18ff68), color(0xffaa10), isMidAmber),
      color(0xff2424),
      isTopRed
    );
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

// Pedestrian signal for crossing alongside the avenue: WALK, then a flashing hand until the avenue's amber, then a
// steady hand
function createWalkSignalMaterial(clock) {
  const { cycle, avenueAmber, walk } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    const isWalk = float(1.0).sub(step(walk, t));
    const isFlashing = step(walk, t).mul(float(1.0).sub(step(avenueAmber, t)));
    const handLit = float(1.0).sub(isFlashing.mul(step(0.5, fract(t))));
    const hand = mix(color(0x14181e), color(0xff5518), handLit);
    return mix(hand, color(0xf4f9ff), isWalk);
  })();
  return mat;
}

function buildStreetDetails(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanStreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of
  const footprints = [];
  const addFootprint = (x, z, w, d) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // Signal clock (seconds), set every frame by main.js
  const signalClock = uniform(0);

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3b4046,
    roughness: 0.45,
    metalness: 0.78
  });
  const nycYellowSignalMat = new THREE.MeshStandardNodeMaterial({
    color: 0xe6a817, // Authentic NYC DOT school-bus/marigold yellow housing
    roughness: 0.38,
    metalness: 0.35,
    side: THREE.DoubleSide // the tunnel visors are open half-tubes
  });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  const walkSignalGlow = createWalkSignalMaterial(signalClock);
  // Cobra-head LED streetlight lens & pedestrian post-top globe: pale diffuser by day, warm white after dusk
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const pedGlobeGlow = new THREE.MeshBasicNodeMaterial();
  pedGlobeGlow.colorNode = mix(color(0xd4d2c8), color(0xffe4b0).mul(1.95), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const streetBladeMat = new THREE.MeshStandardNodeMaterial({
    map: createStreetSignBladeTexture('5TH AVE · 42 ST'),
    roughness: 0.32
  });

  // 12-inch three-section signal head (origin at its centre, y = 5.42): yellow housing, a tunnel visor over each lens
  // and a hanger to the mast arm, lenses on both faces (+-z) so it reads from both approaches; the lens material
  // picks red / amber / green from each lens's world height (5.78 / 5.42 / 5.06)
  const HEAD_W = 0.4;
  const HEAD_H = 1.12;
  const HEAD_D = 0.28;
  const LENS_R = 0.145;
  const LENS_Y = [0.36, 0, -0.36];
  const bothFaces = (geo) => [geo, geo.clone().rotateY(Math.PI)];
  const signalHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    new THREE.BoxGeometry(0.07, 0.2, 0.07).translate(0, HEAD_H / 2 + 0.1, 0),
    ...LENS_Y.flatMap((ly) => bothFaces(
      new THREE.CylinderGeometry(LENS_R + 0.03, LENS_R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2).translate(0, ly, HEAD_D / 2 + 0.12)
    ))
  ].map((g) => g.toNonIndexed()));
  const signalLensGeo = mergeGeometries(LENS_Y.flatMap((ly) => bothFaces(new THREE.CircleGeometry(LENS_R, 18).translate(0, ly, HEAD_D / 2 + 0.004))));
  // Pedestrian signal: housing with the WALK / hand face lit on both sides (+-z, toward the crosswalk's far end)
  const walkHousingGeo = new THREE.BoxGeometry(0.34, 0.4, 0.24);
  const walkPanelGeo = mergeGeometries(bothFaces(new THREE.PlaneGeometry(0.27, 0.31).translate(0, 0, 0.125)));
  // Cobra-head luminaire on the end of the arm: flattened grey housing, flat lens underneath
  const lampHousingGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.2, 0.3);
  const lampLensGeo = new THREE.CircleGeometry(1, 16).rotateX(Math.PI / 2).scale(0.6, 1, 0.24).translate(0, -0.005, 0);
  // Classic NYC cast-iron pedestrian post-top globe lightpole (fluted base + shaft + decorative capital + opal globe)
  const pedLampPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, 0.85, 10).translate(0, 0.425, 0),
    new THREE.CylinderGeometry(0.065, 0.085, 2.75, 10).translate(0, 2.22, 0),
    new THREE.CylinderGeometry(0.14, 0.07, 0.16, 10).translate(0, 3.62, 0)
  ].map((g) => g.toNonIndexed()));
  const pedGlobeGeo = new THREE.SphereGeometry(0.23, 12, 10).translate(0, 3.84, 0);

  // =========================================================================
  // 1. NYC CANTILEVERED TRAFFIC SIGNALS, STREET BLADES & WALK SIGNALS
  // =========================================================================
  const poleMatrices = [];
  const armMatrices = [];
  const yellowBoxMatrices = [];
  const aveLensMatrices = [];
  const streetLensMatrices = [];
  const streetBladeMatrices = [];
  const walkBoxMatrices = [];
  const lampHeadMatrices = [];
  const pedPostMatrices = [];
  const cobraLampSites = [];
  const streetPointSites = [];
  const placedPoles = [];

  const plazaRects = window.NYC.pavedPlazaRects || [];
  const inPlaza = (x, z, m = 1.0) =>
    plazaRects.some((r) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m);

  // True only when (x, z) and its surrounding pad-meter footprint sit on a real curb island (never in a road or median)
  const isOnCurbIsland = (x, z, pad = 0.55) => {
    const b = blockAt(x, z);
    if (!b || b.median) return false;
    if (pad <= 0) return true;
    const b1 = blockAt(x - pad, z);
    const b2 = blockAt(x + pad, z);
    const b3 = blockAt(x, z - pad);
    const b4 = blockAt(x, z + pad);
    return !!(b1 && !b1.median && b2 && !b2.median && b3 && !b3.median && b4 && !b4.median);
  };

  // True only when (x, z) is on a non-park, non-median, non-plaza sidewalk with `pad` clearance from all curbs
  const isOnSidewalk = (x, z, pad = 0.55) => {
    if (!isOnCurbIsland(x, z, pad)) return false;
    const b = blockAt(x, z);
    return !(b.park > 0.6) && !inPlaza(x, z, 1.0);
  };

  const isClearOfPoles = (x, z, minDist = 6.0) => {
    const md2 = minDist * minDist;
    for (let i = 0; i < placedPoles.length; i++) {
      const dx = placedPoles[i].x - x;
      const dz = placedPoles[i].z - z;
      if (dx * dx + dz * dz < md2) return false;
    }
    return true;
  };

  for (let a = 0; a < AVENUES.length; a++) {
    const ave = AVENUES[a];
    for (let s = 0; s < STREETS.length; s++) {
      const st = STREETS[s];
      const cornerOffsetX = ave.width * 0.5 + 1.25;
      const cornerOffsetZ = st.width * 0.5 + 1.25;

      // Place diagonal pair of traffic signal masts at NE and SW corners of every intersection
      const corners = [
        { sx: 1, sz: -1, armDir: -1 },
        { sx: -1, sz: 1, armDir: 1 }
      ];

      for (const c of corners) {
        let px = ave.x + c.sx * cornerOffsetX;
        let pz = st.z + c.sz * cornerOffsetZ;
        if (!isOnCurbIsland(px, pz, 0.55) || inPlaza(px, pz, 1.0)) {
          // Try nudging slightly deeper into the block corner if clipped near the curb
          const altX = ave.x + c.sx * (cornerOffsetX + 0.85);
          const altZ = st.z + c.sz * (cornerOffsetZ + 0.85);
          if (isOnCurbIsland(altX, altZ, 0.55) && !inPlaza(altX, altZ, 1.0)) {
            px = altX;
            pz = altZ;
          } else {
            continue;
          }
        }
        // Ensure the cantilevered mast arm actually overhangs the avenue roadway
        if (blockAt(px + c.armDir * 3.1, pz) || !isClearOfPoles(px, pz, 6.0)) continue;
        placedPoles.push({ x: px, z: pz });
        addFootprint(px, pz, 0.5, 0.5);

        // Vertical pole (6.4m tall)
        dummy.position.set(px, 3.3, pz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.14, 6.4, 0.14);
        dummy.updateMatrix();
        poleMatrices.push(dummy.matrix.clone());

        // NYC DOT Green Street Name Sign Blade mounted on pole (y = 4.65m)
        dummy.position.set(px + c.armDir * 0.68, 4.65, pz);
        dummy.scale.set(1.38, 0.34, 0.08);
        dummy.updateMatrix();
        streetBladeMatrices.push(dummy.matrix.clone());

        // Pedestrian "WALK / DON'T WALK" signal on the pole at crosswalk level (y = 3.15m), facing across the street
        dummy.position.set(px + c.armDir * 0.24, 3.15, pz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        walkBoxMatrices.push(dummy.matrix.clone());

        // Cantilever horizontal mast arm reaching 6.5m over the avenue
        const armX = px + c.armDir * 3.25;
        dummy.position.set(armX, 6.1, pz);
        dummy.scale.set(6.5, 0.11, 0.11);
        dummy.updateMatrix();
        armMatrices.push(dummy.matrix.clone());

        // Intersection corner cobra-head luminaire overhanging the crosswalk & corner sidewalk
        const cornerLampX = px + c.armDir * 1.85;
        dummy.position.set(cornerLampX, 6.22, pz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lampHeadMatrices.push(dummy.matrix.clone());
        cobraLampSites.push({
          x: cornerLampX,
          y: 6.18,
          z: pz,
          tx: px + c.armDir * 2.8,
          tz: pz - c.sz * 1.4
        });

        // Two NYC yellow signal heads hanging from the mast arm: the avenue's (3.1 m out, facing up & down the avenue)
        // and the cross street's (5.5 m out, turned to face along the street)
        for (const armDist of [3.1, 5.5]) {
          dummy.position.set(px + c.armDir * armDist, 5.42, pz);
          dummy.rotation.set(0, armDist < 4.0 ? 0 : Math.PI / 2, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          yellowBoxMatrices.push(dummy.matrix.clone());
          (armDist < 4.0 ? aveLensMatrices : streetLensMatrices).push(dummy.matrix.clone());
        }
        dummy.rotation.set(0, 0, 0);
      }
    }
  }

  // =========================================================================
  // 2. MID-BLOCK AVENUE & STREET ORNAMENTAL ACORN & COBRA STREETLIGHTS
  //    Placed directly along the true curb edges of every city block (window.NYC.BLOCKS)
  //    and verified with blockAt(x, z) so no pole ever stands in any roadway.
  // =========================================================================
  const allBlocks = window.NYC.BLOCKS || [];
  const detailZMin = streetZ(61);
  const detailZMax = streetZ(14);

  for (const b of allBlocks) {
    if (!b || !b.poly || b.poly.length < 3 || b.median || b.park > 0.6) continue;
    if (b.cz < detailZMin || b.cz > detailZMax || b.cx < -920 || b.cx > 920) continue;

    const poly = b.poly;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 24) continue;

      const ux = dx / len;
      const uz = dz / len;
      const mx = (p0.x + p1.x) * 0.5;
      const mz = (p0.z + p1.z) * 0.5;

      // Determine inward normal (into the sidewalk block) and outward normal (into the street roadway)
      let inx = -uz;
      let inz = ux;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) {
        inx = uz;
        inz = -ux;
      }
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) continue;
      const outX = -inx;
      const outZ = -inz;
      // Confirm this curb edge fronts an open roadway
      if (blockAt(mx + outX * 2.5, mz + outZ * 2.5)) continue;

      const isAvenueEdge = Math.abs(uz) > 0.65;
      if (isAvenueEdge) {
        const armYaw = Math.atan2(-outZ, outX);
        const cobraFracs = inx > 0 ? [0.26, 0.72] : [0.32, 0.78];
        for (const f of cobraFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const lx = cx + inx * 1.08;
          const lz = cz + inz * 1.08;
          const headX = lx + outX * 2.6;
          const headZ = lz + outZ * 2.6;
          if (
            !isOnSidewalk(lx, lz, 0.55) ||
            blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
            blockAt(headX, headZ) ||
            !isClearOfPoles(lx, lz, 6.5)
          ) {
            continue;
          }
          placedPoles.push({ x: lx, z: lz });
          addFootprint(lx, lz, 0.45, 0.45);

          // Tall ornamental streetlight pole
          dummy.position.set(lx, 4.3, lz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.12, 8.4, 0.12);
          dummy.updateMatrix();
          poleMatrices.push(dummy.matrix.clone());

          // Upper luminaire bracket arm overhanging the street
          dummy.position.set(lx + outX * 1.15, 8.2, lz + outZ * 1.15);
          dummy.rotation.set(0, armYaw, 0);
          dummy.scale.set(2.3, 0.09, 0.09);
          dummy.updateMatrix();
          armMatrices.push(dummy.matrix.clone());

          // NYC DOT cobra-head LED luminaire on the end of the arm, lens facing the street
          dummy.position.set(headX, 8.08, headZ);
          dummy.rotation.set(0, armYaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          lampHeadMatrices.push(dummy.matrix.clone());
          dummy.rotation.set(0, 0, 0);

          cobraLampSites.push({
            x: headX,
            y: 8.02,
            z: headZ,
            tx: lx + outX * 3.4,
            tz: lz + outZ * 3.4
          });
        }

        // Historic NYC cast-iron pedestrian post-top globe lightpoles along avenue sidewalks (with PointLights)
        const pedFracs = len >= 48 ? [0.16, 0.50, 0.84] : [0.24, 0.76];
        for (const f of pedFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.42;
          const pz = cz + inz * 1.42;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.2)
          ) {
            continue;
          }
          placedPoles.push({ x: px, z: pz });
          addFootprint(px, pz, 0.4, 0.4);

          dummy.position.set(px, 0.18, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pedPostMatrices.push(dummy.matrix.clone());
          streetPointSites.push({
            x: px,
            y: 4.02,
            z: pz,
            color: 0xffe0aa,
            intensity: 30,
            dist: 14.5
          });
        }
      } else if (len >= 36) {
        // Cross-street cast-iron pedestrian post-top globe lightpoles along north and south block curbs
        const crossFracs = len >= 115 ? [0.20, 0.40, 0.60, 0.80] : [0.24, 0.50, 0.76];
        for (const f of crossFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.22;
          const pz = cz + inz * 1.22;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.5)
          ) {
            continue;
          }
          placedPoles.push({ x: px, z: pz });
          addFootprint(px, pz, 0.4, 0.4);

          dummy.position.set(px, 0.18, pz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pedPostMatrices.push(dummy.matrix.clone());
          streetPointSites.push({
            x: px,
            y: 4.02,
            z: pz,
            color: 0xffe0aa,
            intensity: 28,
            dist: 14.0
          });
        }
      }
    }
  }

  function addMatrixArrayInstanced(geo, mat, matrices, castShadow = true) {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    if (castShadow && !mat.isMeshBasicNodeMaterial && mat.type !== 'MeshBasicNodeMaterial' && !mat.transparent) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  addMatrixArrayInstanced(unitCyl, poleMetalMat, poleMatrices);
  addMatrixArrayInstanced(unitBox, poleMetalMat, armMatrices);
  addMatrixArrayInstanced(signalHousingGeo, nycYellowSignalMat, yellowBoxMatrices);
  addMatrixArrayInstanced(signalLensGeo, aveSignalLensMat, aveLensMatrices, false);
  addMatrixArrayInstanced(signalLensGeo, streetSignalLensMat, streetLensMatrices, false);
  addMatrixArrayInstanced(unitBox, streetBladeMat, streetBladeMatrices);
  addMatrixArrayInstanced(walkHousingGeo, nycYellowSignalMat, walkBoxMatrices);
  addMatrixArrayInstanced(walkPanelGeo, walkSignalGlow, walkBoxMatrices, false);
  addMatrixArrayInstanced(lampHousingGeo, poleMetalMat, lampHeadMatrices);
  addMatrixArrayInstanced(lampLensGeo, lampBulbGlow, lampHeadMatrices, false);
  addMatrixArrayInstanced(pedLampPostGeo, poleMetalMat, pedPostMatrices);
  addMatrixArrayInstanced(pedGlobeGeo, pedGlobeGlow, pedPostMatrices, false);

  // =========================================================================
  // 2B. VOLUMETRIC GOLDEN-HOUR CANYON SUN SHAFTS (GOD RAYS)
  // =========================================================================
  const godRayMat = createGodRayMaterial();
  const godRayGeo = new THREE.PlaneGeometry(54, 92);
  const canyonShafts = [
    { x: 0,    y: 42, z: 180,  rotY: 0.32,  rotZ: -0.46 }, // 34th St & 5th Ave (Empire State Canyon)
    { x: 0,    y: 44, z: 0,    rotY: 0.28,  rotZ: -0.44 }, // 42nd St & 5th Ave (NYPL / Bryant Park)
    { x: 165,  y: 46, z: 0,    rotY: 0.25,  rotZ: -0.45 }, // 42nd St & Park/Lexington (Grand Central & Chrysler)
    { x: -110, y: 42, z: -90,  rotY: 0.30,  rotZ: -0.44 }, // 47th St & 6th Ave (Rockefeller Center)
    { x: -215, y: 40, z: -45,  rotY: 0.35,  rotZ: -0.42 }, // Times Square / Broadway Canyon
    { x: -55,  y: 48, z: -360, rotY: 0.28,  rotZ: -0.46 }  // 59th St / Central Park South Canyon
  ];
  for (const cs of canyonShafts) {
    const shaft = new THREE.Mesh(godRayGeo, godRayMat);
    const at = fromOldFrame(cs.x, cs.z); // (authored on the former compressed grid)
    shaft.position.set(at.x, cs.y, at.z);
    shaft.rotation.set(0.12, cs.rotY, cs.rotZ);
    group.add(shaft);
  }

  // =========================================================================
  // 3. CON EDISON ORANGE/WHITE STRIPED STEAM STACKS, NYCDOT SAWHORSE BARRICADES
  //    & BILLOWING WIND-DRIFTED VOLUMETRIC STEAM CLOUD TRAILS (REFERENCE PHOTO!)
  // =========================================================================
  const steamLocations = [
    { x: 6.4,   z: 96,   windX: -1.0, windZ: -0.18 }, // 5th Ave & 37th St (Buffer zone clear of green bike lane!)
    { x: -7.5,  z: 148,  windX: 0.95, windZ: -0.22 }, // 5th Ave near 34th St (Empire State Building)
    { x: 6.4,   z: 48,   windX: -1.0, windZ: 0.15  }, // 5th Ave & 40th St (NYPL / Bryant Park)
    { x: -8.0,  z: -18,  windX: 0.92, windZ: -0.20 }, // 5th Ave & 43rd St
    { x: -206,  z: -32,  windX: 0.95, windZ: 0.22  }, // Broadway / Times Square
    { x: -228,  z: -98,  windX: 1.0,  windZ: -0.15 }, // 7th Ave & 45th St
    { x: -102,  z: 22,   windX: -0.9, windZ: 0.20  }, // 6th Ave & Bryant Park
    { x: 118,   z: -12,  windX: -1.0, windZ: -0.15 }, // Park Ave & 42nd St (Grand Central)
    { x: 212,   z: -26,  windX: 0.92, windZ: 0.18  }, // Lexington Ave & 42nd St (Chrysler Building)
    { x: 228,   z: -195, windX: -0.9, windZ: 0.16  }, // Lexington Ave & 51st St
    { x: -118,  z: -148, windX: 0.95, windZ: -0.18 }, // 6th Ave & 48th St (Rockefeller Center)
    { x: 6.4,   z: 285,  windX: -0.9, windZ: -0.22 }, // 5th Ave & 26th St (Flatiron)
    { x: 6.4,   z: 615,  windX: -0.9, windZ: 0.18  }, // 5th Ave & Washington Square
    { x: -212,  z: 1255, windX: 0.95, windZ: -0.20 }  // One WTC / Financial District
  ];
  // (authored on the former compressed grid: carried onto the real streets; the Financial District one by One WTC)
  for (const st of steamLocations) {
    const wtc = window.NYC.LANDMARK_SITES['One World Trade Center'];
    const at = st.z > 1000 && wtc ? { x: wtc.x + 48, z: wtc.z - 40 } : fromOldFrame(st.x, st.z);
    st.x = at.x;
    st.z = at.z;
  }

  const steamOrangeMat = new THREE.MeshStandardNodeMaterial({
    color: 0xff5518, // High-visibility ConEd safety orange
    roughness: 0.42
  });
  const steamWhiteMat = new THREE.MeshStandardNodeMaterial({
    color: 0xf4f6f8,
    roughness: 0.45
  });
  const steamMat = createSteamMaterial();
  const puffsPerStack = 36;
  const totalSteamSprites = steamLocations.length * puffsPerStack;
  const smokeOriginArr = new Float32Array(totalSteamSprites * 3);
  const smokeWindArr = new Float32Array(totalSteamSprites * 3);
  const smokeParamsArr = new Float32Array(totalSteamSprites * 4);
  let spriteCursor = 0;

  const orangeMatrices = [];
  const whiteMatrices = [];
  const barricadeOrangeMatrices = [];
  const barricadeWhiteMatrices = [];

  for (let sIdx = 0; sIdx < steamLocations.length; sIdx++) {
    const { x: sx, z: sz, windX, windZ } = steamLocations[sIdx];
    addFootprint(sx, sz, 2, 2); // stack + sawhorse barricades

    // 5-Band Alternating Orange & White Candy-Cane ConEd Steam Stack (height = 2.85m)
    for (let b = 0; b < 5; b++) {
      const bandH = 0.56;
      const by = 0.28 + b * bandH;
      const rScale = 0.36 - b * 0.025;
      dummy.position.set(sx, by, sz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(rScale, bandH, rScale);
      dummy.updateMatrix();
      if (b % 2 === 0) {
        orangeMatrices.push(dummy.matrix.clone());
      } else {
        whiteMatrices.push(dummy.matrix.clone());
      }
    }

    // 4-Sided NYCDOT Orange-and-White Striped Wooden Sawhorse Barricades around base of stack
    const bHalf = 0.92;
    const sides = [
      { ox: 0, oz: bHalf, rotY: 0 },
      { ox: 0, oz: -bHalf, rotY: 0 },
      { ox: bHalf, oz: 0, rotY: Math.PI * 0.5 },
      { ox: -bHalf, oz: 0, rotY: Math.PI * 0.5 }
    ];
    for (const side of sides) {
      // Barricade vertical legs
      for (const legOff of [-0.72, 0.72]) {
        const lx = sx + side.ox + (side.rotY === 0 ? legOff : 0);
        const lz = sz + side.oz + (side.rotY !== 0 ? legOff : 0);
        dummy.position.set(lx, 0.48, lz);
        dummy.rotation.set(0, side.rotY, 0);
        dummy.scale.set(0.08, 0.96, 0.08);
        dummy.updateMatrix();
        barricadeWhiteMatrices.push(dummy.matrix.clone());
      }
      // Top & middle striped horizontal rails
      for (const railY of [0.82, 0.46]) {
        for (let seg = -2; seg <= 2; seg++) {
          const segOff = seg * 0.34;
          const rx = sx + side.ox + (side.rotY === 0 ? segOff : 0);
          const rz = sz + side.oz + (side.rotY !== 0 ? segOff : 0);
          dummy.position.set(rx, railY, rz);
          dummy.rotation.set(0, side.rotY, 0);
          dummy.scale.set(0.34, 0.16, 0.06);
          dummy.updateMatrix();
          if (Math.abs(seg) % 2 === 0) {
            barricadeOrangeMatrices.push(dummy.matrix.clone());
          } else {
            barricadeWhiteMatrices.push(dummy.matrix.clone());
          }
        }
      }
    }

    // 36 Camera-Facing Volumetric Smoke Sprites per ConEd Steam Stack (SpriteNodeMaterial)
    for (let p = 0; p < puffsPerStack; p++) {
      const idx3 = spriteCursor * 3;
      const idx4 = spriteCursor * 4;
      const phaseOffset = (p + ((sIdx * 0.37) % 1.0)) / puffsPerStack;
      const spinDir = p % 2 === 0 ? 1.0 : -1.0;
      const spinSpeed = spinDir * (0.28 + ((p * 0.19 + sIdx * 0.13) % 0.45));
      const curlSeed = (p * 1.73 + sIdx * 2.41) % (Math.PI * 2);
      const scaleMul = 0.86 + ((p * 0.31 + sIdx * 0.17) % 0.36);

      smokeOriginArr[idx3] = sx;
      smokeOriginArr[idx3 + 1] = 2.75;
      smokeOriginArr[idx3 + 2] = sz;

      smokeWindArr[idx3] = windX;
      smokeWindArr[idx3 + 1] = 7.4;
      smokeWindArr[idx3 + 2] = windZ;

      smokeParamsArr[idx4] = phaseOffset;
      smokeParamsArr[idx4 + 1] = spinSpeed;
      smokeParamsArr[idx4 + 2] = curlSeed;
      smokeParamsArr[idx4 + 3] = scaleMul;
      spriteCursor++;
    }
  }

  addMatrixArrayInstanced(unitCyl, steamOrangeMat, orangeMatrices);
  addMatrixArrayInstanced(unitCyl, steamWhiteMat, whiteMatrices);
  addMatrixArrayInstanced(unitBox, steamOrangeMat, barricadeOrangeMatrices);
  addMatrixArrayInstanced(unitBox, steamWhiteMat, barricadeWhiteMatrices);

  const steamSpriteGeo = new THREE.PlaneGeometry(1, 1);
  steamSpriteGeo.setAttribute('aSmokeOrigin', new THREE.InstancedBufferAttribute(smokeOriginArr, 3));
  steamSpriteGeo.setAttribute('aSmokeWind', new THREE.InstancedBufferAttribute(smokeWindArr, 3));
  steamSpriteGeo.setAttribute('aSmokeParams', new THREE.InstancedBufferAttribute(smokeParamsArr, 4));
  const steamInstancedSprites = new THREE.InstancedMesh(steamSpriteGeo, steamMat, totalSteamSprites);
  steamInstancedSprites.count = totalSteamSprites;
  steamInstancedSprites.frustumCulled = false;
  steamInstancedSprites.renderOrder = 2;
  group.add(steamInstancedSprites);

  // =========================================================================
  // 4. MTA SUBWAY ENTRANCES WITH GLOWING GREEN GLOBE LAMPS
  // =========================================================================
  const subwayRailingMat = new THREE.MeshStandardNodeMaterial({
    color: 0x1a3826, // Classic MTA Subway forest green ironwork
    roughness: 0.5,
    metalness: 0.65
  });
  const mtaGlobeMat = new THREE.MeshBasicNodeMaterial({ color: 0x55ff88 });

  const subwayLocations = [
    [-16.5, 162],  // 34th St - Herald Sq / 5th Ave
    [16.5, 162],
    [-16.5, 16],   // 42nd St - Bryant Park / 5th Ave
    [-126.5, 16],  // 42nd St - 6th Ave
    [-203.5, -16], // Times Sq - 42nd St
    [-236.5, -74], // Times Sq - 45th St
    [126.5, -16],  // Grand Central - 42nd St
    [203.5, -16],  // Lexington Ave / Chrysler
    [203.5, -252], // 53rd St - Lex Ave (Citigroup)
    [-16.5, -162], // 47th-50th Sts Rockefeller Ctr
    [-16.5, 342]   // 23rd St - Flatiron
  ];

  const subwayRailMatrices = [];
  const subwayPostMatrices = [];
  const subwayGlobeMatrices = [];

  const snapToCurbIsland = (x, z, pad = 1.1) => {
    if (isOnCurbIsland(x, z, pad)) return { x, z };
    for (let r = 2; r <= 18; r += 2) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r;
        const nz = z + Math.sin(ang) * r;
        if (isOnCurbIsland(nx, nz, pad)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  };

  for (const [oldX, oldZ] of subwayLocations) {
    const raw = fromOldFrame(oldX, oldZ); // (authored on the former compressed grid)
    const { x: subX, z: subZ } = snapToCurbIsland(raw.x, raw.z, 1.2);
    // Iron railing enclosure around sidewalk stairs
    dummy.position.set(subX, 0.8, subZ);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(2.1, 1.15, 6.2);
    dummy.updateMatrix();
    subwayRailMatrices.push(dummy.matrix.clone());
    addFootprint(subX, subZ, 2.1, 6.2);

    // Twin MTA Green Globe Post Lamps at stair entrance
    for (const ox of [-0.85, 0.85]) {
      dummy.position.set(subX + ox, 1.9, subZ + 2.9);
      dummy.scale.set(0.09, 1.4, 0.09);
      dummy.updateMatrix();
      subwayPostMatrices.push(dummy.matrix.clone());

      dummy.position.set(subX + ox, 2.7, subZ + 2.9);
      dummy.scale.set(0.26, 0.26, 0.26);
      dummy.updateMatrix();
      subwayGlobeMatrices.push(dummy.matrix.clone());
    }
    streetPointSites.push({ x: subX, y: 2.75, z: subZ + 2.9, color: 0x48ff80, intensity: 18, dist: 8.5 });
  }
  addMatrixArrayInstanced(unitBox, subwayRailingMat, subwayRailMatrices);
  addMatrixArrayInstanced(unitCyl, subwayRailingMat, subwayPostMatrices);
  addMatrixArrayInstanced(new THREE.SphereGeometry(1, 10, 10), mtaGlobeMat, subwayGlobeMatrices, false);

  // =========================================================================
  // 5. NYC HOT DOG / HALAL FOOD CARTS WITH UMBRELLAS & SIDEWALK PROPS
  // =========================================================================
  const cartSteelMat = new THREE.MeshStandardNodeMaterial({
    color: 0xd0d8e0,
    roughness: 0.25,
    metalness: 0.88
  });
  const umbrellaMat = new THREE.MeshStandardNodeMaterial({
    color: 0x1e64d8, // Classic NYC blue & yellow umbrella
    roughness: 0.6
  });

  const cartLocations = [
    [-17, 152],   // Empire State corner
    [-17, 25],    // NYPL / Bryant Park
    [-127, 25],   // 6th Ave & 42nd
    [-202, -28],  // Times Square
    [-202, -108], // Duffy Square
    [127, -25],   // Grand Central
    [237, -25],   // Chrysler Building corner
    [-17, -148],  // Rockefeller Center
    [127, -205],  // Seagram Plaza corner
    [-17, 325]    // Flatiron Plaza
  ];

  const cartBoxMatrices = [];
  const umbrellaMatrices = [];
  for (const [ox, oz] of cartLocations) {
    const raw = fromOldFrame(ox, oz); // (authored on the former compressed grid)
    const { x: cx, z: cz } = snapToCurbIsland(raw.x, raw.z, 1.1);
    dummy.position.set(cx, 0.85, cz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.5, 1.25, 2.2);
    dummy.updateMatrix();
    cartBoxMatrices.push(dummy.matrix.clone());

    dummy.position.set(cx, 2.55, cz);
    dummy.scale.set(1.7, 0.75, 1.7);
    dummy.updateMatrix();
    umbrellaMatrices.push(dummy.matrix.clone());
    streetPointSites.push({ x: cx, y: 2.15, z: cz, color: 0xffdf9e, intensity: 28, dist: 9.5 });
  }
  addMatrixArrayInstanced(unitBox, cartSteelMat, cartBoxMatrices);
  addMatrixArrayInstanced(new THREE.ConeGeometry(1, 1, 8), umbrellaMat, umbrellaMatrices);

  // =========================================================================
  // 6. FIRE HYDRANTS & USPS BLUE MAILBOXES ALONG CURBS (INSTANCED)
  // =========================================================================
  const hydrantPositions = [];
  const mailboxPositions = [];
  for (const ave of AVENUES) {
    for (let row = 0; row < STREETS.length - 1; row++) {
      const zMid = (STREETS[row].z + STREETS[row + 1].z) * 0.5;
      const h1 = [ave.x - ave.width * 0.5 - 0.8, zMid - 16];
      const h2 = [ave.x + ave.width * 0.5 + 0.8, zMid + 16];
      const mb = [ave.x + ave.width * 0.5 + 1.2, zMid - 22];
      if (isOnSidewalk(h1[0], h1[1], 0.45)) hydrantPositions.push(h1);
      if (isOnSidewalk(h2[0], h2[1], 0.45)) hydrantPositions.push(h2);
      if (isOnSidewalk(mb[0], mb[1], 0.45)) mailboxPositions.push(mb);
    }
  }

  const hydrantMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8241e, roughness: 0.5, metalness: 0.4 });
  const hydrantInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.85, 8), hydrantMat, hydrantPositions.length);
  hydrantPositions.forEach(([hx, hz], i) => {
    dummy.position.set(hx, 0.64, hz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydrantInst.setMatrixAt(i, dummy.matrix);
  });
  hydrantInst.instanceMatrix.needsUpdate = true;
  group.add(hydrantInst);

  const uspsMat = new THREE.MeshStandardNodeMaterial({ color: 0x183c7a, roughness: 0.45, metalness: 0.35 });
  const mailboxInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.65, 1.25, 0.65), uspsMat, mailboxPositions.length);
  mailboxPositions.forEach(([mx, mz], i) => {
    dummy.position.set(mx, 0.84, mz);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mailboxInst.setMatrixAt(i, dummy.matrix);
  });
  mailboxInst.instanceMatrix.needsUpdate = true;
  group.add(mailboxInst);

  // =========================================================================
  // 7. LUSH TREES: PARKS & PLAZAS, CENTRAL PARK WOODLANDS, AVENUE & CROSS-STREET TREES
  //    London planes, honey locusts & American elms (one unified trunk + crown instanced mesh per species & band)
  // =========================================================================
  const treePositions = []; // { x, y, z, scale, species (0 plane, 1 honey locust, 2 elm / oak) }
  const CP_LAWN_Y = 1.19;
  const mixSpecies = (r, plane, locust) => (r < plane ? 0 : (r < plane + locust ? 1 : 2));

  const { CENTRAL_PARK_BOUNDS: CPB } = window.NYC;

  // A. Bryant Park: double allées of London planes on the raised terraces along the Great Lawn's north & south sides
  //    and its west end, framing the lawn the library's terrace looks out over (the lawn as fitted by landmarks.js)
  const bpl = window.NYC.bryantParkLawn;
  if (bpl) {
    const ty = bpl.top - 0.2;
    for (let tx = bpl.minX - 6; tx <= bpl.maxX + 6; tx += 6.5) {
      for (const tz of [bpl.minZ - 5, bpl.minZ - 11.5, bpl.maxZ + 5, bpl.maxZ + 11.5]) {
        treePositions.push({ x: tx, y: ty, z: tz, scale: 0.8, species: 0 });
      }
    }
    for (let tz = bpl.minZ; tz <= bpl.maxZ; tz += 6.5) {
      treePositions.push({ x: bpl.minX - 6, y: ty, z: tz, scale: 0.82, species: 0 });
      treePositions.push({ x: bpl.minX - 12.5, y: ty, z: tz, scale: 0.76, species: 0 });
    }
  }

  // B. Central Park (59th to 110th St, 5th Ave to Central Park West; city-config.js CENTRAL_PARK_BOUNDS), on the lawn
  const cp = CPB;
  // B1. Central Park South (59th St) dense woodland border
  for (let tx = cp.minX + 8; tx <= cp.maxX - 8; tx += 9.5) {
    treePositions.push({ x: tx, y: CP_LAWN_Y, z: cp.maxZ - 5, scale: 0.95, species: 0 });
    treePositions.push({ x: tx + 3.5, y: CP_LAWN_Y, z: cp.maxZ - 16, scale: 1.0, species: mixSpecies(hashPos(tx, 1, 2), 0.5, 0.1) });
    if (hashPos(tx, 7, 3) > 0.35) {
      treePositions.push({ x: tx - 2.5, y: CP_LAWN_Y, z: cp.maxZ - 31, scale: 1.05, species: mixSpecies(hashPos(tx, 3, 4), 0.4, 0.15) });
    }
  }

  // B2. 5th Avenue & Central Park West perimeter rows inside the park wall
  for (let tz = cp.maxZ - 10; tz >= cp.minZ + 10; tz -= 14) {
    treePositions.push({ x: cp.maxX - 5, y: CP_LAWN_Y, z: tz, scale: 0.92, species: mixSpecies(hashPos(tz, 1, 1), 0.55, 0.1) });
    treePositions.push({ x: cp.maxX - 15, y: CP_LAWN_Y, z: tz - 6, scale: 0.98, species: mixSpecies(hashPos(tz, 2, 1), 0.3, 0.1) });
    treePositions.push({ x: cp.minX + 5, y: CP_LAWN_Y, z: tz, scale: 0.92, species: mixSpecies(hashPos(tz, 3, 1), 0.55, 0.1) });
    treePositions.push({ x: cp.minX + 15, y: CP_LAWN_Y, z: tz - 6, scale: 0.98, species: mixSpecies(hashPos(tz, 4, 1), 0.3, 0.1) });
  }

  // B3. The Mall & Literary Walk quadruple row of towering American Elms (66th to 72nd St)
  const cpClear = window.NYC.centralParkClearings;
  const mall = cpClear && cpClear.mall;
  if (mall) {
    for (let tz = mall.z0 + 4; tz <= mall.z1 - 4; tz += 9.5) {
      for (const [dx, sc] of [[-16, 1.08], [-9, 1.0], [9, 1.0], [16, 1.08]]) treePositions.push({ x: mall.x + dx, y: CP_LAWN_Y, z: tz, scale: sc, species: 2 });
    }
  }

  // B4. Woodlands: a jittered grid over the park kept clear of the meadows, water, drives, transverses, rock outcrops
  //     & terraces (laid out by city-grid.js), densest in the Ramble (between the Lake & the 79th St transverse) & the
  //     North Woods (north of 102nd St), with glades
  if (cpClear) {
    const withBox = (pts) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      return { pts, x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
    };
    const polys = cpClear.polygons.map(withBox);
    const drives = cpClear.drives.map((wp) => {
      const b = withBox(wp.map(([x, z]) => ({ x, z })));
      return { wp, x0: b.x0 - 4, x1: b.x1 + 4, z0: b.z0 - 4, z1: b.z1 + 4 };
    });
    const inPoly = (x, z, pts) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const segDist = (px, pz, [ax, az], [bx, bz]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - ax - dx * t, pz - az - dz * t);
    };
    const blocked = (x, z) => {
      for (const P of polys) {
        if (x < P.x0 || x > P.x1 || z < P.z0 || z > P.z1) continue;
        for (const [ox, oz] of [[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5]]) if (inPoly(x + ox, z + oz, P.pts)) return true;
      }
      for (const D of drives) {
        if (x < D.x0 || x > D.x1 || z < D.z0 || z > D.z1) continue;
        for (let i = 0; i < D.wp.length - 1; i++) if (segDist(x, z, D.wp[i], D.wp[i + 1]) < 7.5) return true;
      }
      for (const r of cpClear.rects) if (x > r.minX - 2.5 && x < r.maxX + 2.5 && z > r.minZ - 2.5 && z < r.maxZ + 2.5) return true;
      for (const c of cpClear.circles) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
      return false;
    };
    const SP = 13;
    const z79 = window.NYC.streetZ(79);
    const z102 = window.NYC.streetZ(102);
    for (let gz = cp.maxZ - 24; gz >= cp.minZ + 12; gz -= SP) {
      for (let gx = cp.minX + 22; gx <= cp.maxX - 22; gx += SP) {
        const tx = gx + (hashPos(gx, 2.1, gz) - 0.5) * SP * 0.95;
        const tz = gz + (hashPos(gz, 5.7, gx) - 0.5) * SP * 0.95;
        const woods = (tz > z79 && tz < z79 + 300 && tx > cp.minX + 120 && tx < cp.minX + 480) || (tz < z102 && tx < cp.minX + 520);
        const glade = Math.sin(tx * 0.019 + 1.3) * Math.sin(tz * 0.016 + 0.4) > 0.6;
        const grove = Math.sin(tx * 0.009 + tz * 0.004) + Math.sin(tz * 0.011 - tx * 0.006 + 2.0); // dense groves vs open scatter
        const skip = grove > 0.6 ? 0.05 : (grove < -0.8 ? 0.55 : 0.2);
        if (!woods && (glade || hashPos(tx, 9.1, tz) < skip)) continue;
        if (blocked(tx, tz)) continue;
        const r = hashPos(tz, 6.6, tx);
        const scale = r < 0.18 ? 0.55 + r * 0.8 : 0.72 + Math.pow(r, 0.8) * 0.72; // some young understory trees
        treePositions.push({ x: tx, y: CP_LAWN_Y, z: tz, scale, species: mixSpecies(hashPos(tx, 4.4, tz), 0.4, 0.15) });
      }
    }
  }

  // B5. The squares, the other parks & the plazas (sites laid out by city-grid.js)
  for (const s of window.NYC.parkTreeSites || []) treePositions.push(s);

  // C & D. Street trees on the raised sidewalks of every real block (city-config.js BLOCKS via the slabs city-grid.js
  //        laid): along the avenue fronts (w / e edges) and, in the residential neighbourhoods, both curbs of the side
  //        streets (n / s edges) — honey locusts on the narrow streets, planes, locusts & elms on the wider ones, with
  //        random missing trees & the odd unplanted block. Never in plazas or parks.
  const sidewalkTreePositions = [];
  const SIDEWALK_Y = 0.22;
  const swBlocks = window.NYC.sidewalkBlocks || [];
  const onSidewalk = (x, z) => {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6) && !b.median;
  };
  // Street trees turn in 90° steps with the crown squeezed across the sidewalk, away from the facades
  function addStreetTree(x, z, scale, species, acrossX, extra = {}) {
    if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2)) return;
    const q = Math.floor(hashPos(x, 8.8, z) * 3.999);
    const t = { x, y: SIDEWALK_Y, z, scale, species, yaw: q * Math.PI * 0.5, tier: acrossX ? 1 : 2, ...extra };
    if (acrossX === (q % 2 === 0)) t.sx = extra.squeeze || 0.82;
    else t.sz = extra.squeeze || 0.82;
    treePositions.push(t);
    sidewalkTreePositions.push(t);
  }
  const RESIDENTIAL = new Set(['uws', 'ues', 'harlem', 'morningside', 'east_harlem', 'chelsea', 'west_chelsea', 'gramercy', 'murray_hill',
    'west_village', 'village', 'east_village', 'lower_east_side', 'turtle_bay', 'hells_kitchen', 'stuy_town', 'tribeca', 'battery_park_city',
    'little_italy', 'chinatown', 'soho', 'hudson_square']);
  const COMMERCIAL = new Set(['midtown', 'billionaires_row', 'garment', 'fidi', 'civic_center', 'hudson_yards', 'flatiron', 'nomad']);
  const AVE_SP = 17;
  const CROSS_SP = 14;
  for (const s of swBlocks) {
    const b = s.block;
    if (!b || b.median || b.park > 0.6) continue;
    const res = RESIDENTIAL.has(b.district);
    const x0 = s.cx - s.w * 0.5;
    const x1 = s.cx + s.w * 0.5;
    const z0 = s.cz - s.d * 0.5;
    const z1 = s.cz + s.d * 0.5;
    // C. avenue fronts (the slab's short w / e edges on a grid block)
    if (s.d >= 20) {
      const thin = COMMERCIAL.has(b.district) ? 0.55 : 0.3;
      for (const [x, side] of [[x0 + 1.3, -1], [x1 - 1.3, 1]]) {
        const n = Math.floor((s.d - 10) / AVE_SP) + 1;
        const zs = z0 + (s.d - (n - 1) * AVE_SP) * 0.5;
        for (let i = 0; i < n; i++) {
          const tz = zs + i * AVE_SP;
          if (hashPos(x, 3.1, tz) < thin) continue;
          addStreetTree(x, tz, 0.66 + hashPos(tz, 3.1, x) * 0.14, mixSpecies(hashPos(x, side, tz), 0.4, 0.35), true);
        }
      }
    }
    // D. side-street curbs (residential neighbourhoods)
    if (!res || s.w < 24 || hashPos(s.cx, 4.2, s.cz) < 0.22) continue;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? z0 : z1;
      const narrow = !!blockAt(s.cx, edge + side * 14); // a block across within ~14 m: a narrow side street
      const z = edge - side * (narrow ? 0.9 : 1.25);
      const n = Math.floor((s.w - 7) / CROSS_SP) + 1;
      const xs = s.cx - ((n - 1) * CROSS_SP) * 0.5;
      for (let i = 0; i < n; i++) {
        const x = xs + i * CROSS_SP + (hashPos(i, s.cz, side) - 0.5) * 1.6;
        const r = hashPos(x, 6.1, z);
        if (r < 0.32) continue;
        const species = narrow ? 1 : mixSpecies(hashPos(z, 2.9, x), 0.4, 0.35);
        const scale = narrow ? 0.54 + r * 0.1 : 0.6 + r * 0.24;
        addStreetTree(x, z, scale, species, false, { pitRot: Math.PI / 2, grate: false, pitS: narrow ? 0.7 : 1, squeeze: narrow ? 0.7 : 0.82 });
      }
    }
  }
  console.info(`[streetDetails] ${treePositions.length} trees (${sidewalkTreePositions.length} street trees)`);

  const grateMat = createTreeGrateMaterial();
  const pitCurbMat = new THREE.MeshStandardNodeMaterial({ color: 0x484642, roughness: 0.88 });
  const pitSoilMat = new THREE.MeshStandardNodeMaterial({ color: 0x241c14, roughness: 0.96 });

  // Curbside tree pit surrounds & dark soil beds, with concentric cast-iron grates on the Midtown avenues
  // (pits run along the curb: t.pitRot = PI/2 on cross streets)
  const pitCurbGeo = new THREE.BoxGeometry(1.7, 0.22, 2.6);
  const pitSoilGeo = new THREE.BoxGeometry(1.35, 0.23, 2.25);
  const pitGrateGeo = new THREE.RingGeometry(0.24, 0.82, 12, 1).rotateX(-Math.PI / 2);
  const gratedTrees = sidewalkTreePositions.filter((t) => t.grate !== false);

  const pitCurbInst = new THREE.InstancedMesh(pitCurbGeo, pitCurbMat, sidewalkTreePositions.length);
  const pitSoilInst = new THREE.InstancedMesh(pitSoilGeo, pitSoilMat, sidewalkTreePositions.length);
  const pitGrateInst = new THREE.InstancedMesh(pitGrateGeo, grateMat, Math.max(1, gratedTrees.length));
  pitCurbInst.receiveShadow = true;
  pitSoilInst.receiveShadow = true;
  pitGrateInst.receiveShadow = true;
  pitGrateInst.count = gratedTrees.length;

  sidewalkTreePositions.forEach((t, i) => {
    dummy.rotation.set(0, t.pitRot || 0, 0);
    dummy.scale.set(t.pitS || 1, 1, 1);
    dummy.position.set(t.x, 0.19, t.z);
    dummy.updateMatrix();
    pitCurbInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, 0.20, t.z);
    dummy.updateMatrix();
    pitSoilInst.setMatrixAt(i, dummy.matrix);
  });
  gratedTrees.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, 0.225, t.z);
    dummy.updateMatrix();
    pitGrateInst.setMatrixAt(i, dummy.matrix);
  });
  pitCurbInst.instanceMatrix.needsUpdate = true;
  pitSoilInst.instanceMatrix.needsUpdate = true;
  pitGrateInst.instanceMatrix.needsUpdate = true;
  for (const pit of [pitCurbInst, pitSoilInst, pitGrateInst]) pit.computeBoundingSphere();
  group.add(pitCurbInst, pitSoilInst, pitGrateInst);

  function hashPos(x, y, z) {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // Procedural trees (js/trees.js): species skeletons with leaf-spray cards, one instanced mesh per species, variant &
  // level of detail, each tree's level following the camera
  const treeField = createTreeField(scene, treePositions);
  group.add(treeField.group);

  // =========================================================================
  // 8. CLUSTERED STREETLIGHTS & STREET FURNITURE LIGHT POOLS
  // =========================================================================
  for (const s of window.NYC.parkLampSites || []) {
    streetPointSites.push({ x: s.x, y: s.y, z: s.z, color: 0xffe4b4, intensity: 32, dist: 14.0 });
  }

  const STREETLIGHT_SPOT_POOL = 4; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const STREET_POINT_POOL = 4; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const STREETLIGHT_DIST = 115;
  const STREETLIGHT_DIST_SQ = STREETLIGHT_DIST * STREETLIGHT_DIST;
  const STREET_POINT_DIST = 110;
  const STREET_POINT_DIST_SQ = STREET_POINT_DIST * STREET_POINT_DIST;

  const streetLightsGroup = new THREE.Group();
  streetLightsGroup.name = 'StreetClusteredLights';
  scene.add(streetLightsGroup);

  const streetlightSpotPool = [];
  for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
    // Cobra-head LED luminaire: wide downward spread (0.96 rad half-angle) illuminating both road and sidewalk
    const spot = new THREE.SpotLight(0xffe8c2, 0, 25, 0.96, 0.82, 1.25);
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    streetLightsGroup.add(spot, spot.target);
    streetlightSpotPool.push(spot);
  }

  const streetPointPool = [];
  for (let i = 0; i < STREET_POINT_POOL; i++) {
    const pt = new THREE.PointLight(0xffe4b4, 0, 12, 1.35);
    pt.position.set(0, -1000, 0);
    streetLightsGroup.add(pt);
    streetPointPool.push(pt);
  }

  const activeCobras = [];
  const activePoints = [];

  function smoothFade(d, start, end) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function update(camera) {
    if (!camera) return;
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    // Streetlights fade in smoothly as dusk approaches (matching lampBulbGlow smoothstep(0.4, 1.1, uInteriorGlow))
    const lampScale = Math.min(1.25, Math.max(0.0, (glow - 0.36) * 1.15));
    if (lampScale <= 0.001) {
      for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
        streetlightSpotPool[i].intensity = 0;
        streetlightSpotPool[i].position.set(0, -1000, 0);
      }
      for (let i = 0; i < STREET_POINT_POOL; i++) {
        streetPointPool[i].intensity = 0;
        streetPointPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const me = camera.matrixWorld.elements;
    const fwdX = -me[8];
    const fwdZ = -me[10];

    let cobraCount = 0;
    for (let i = 0; i < cobraLampSites.length; i++) {
      const s = cobraLampSites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const d2 = dx * dx + dz * dz + cy * cy;
      if (d2 > STREETLIGHT_DIST_SQ) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STREETLIGHT_DIST) continue;
      s._effDist = effDist;
      activeCobras[cobraCount++] = s;
    }
    activeCobras.length = cobraCount;
    if (cobraCount > 1) activeCobras.sort((a, b) => a._effDist - b._effDist);

    const cobraCutoff = cobraCount > STREETLIGHT_SPOT_POOL
      ? Math.min(STREETLIGHT_DIST, activeCobras[STREETLIGHT_SPOT_POOL]._effDist)
      : STREETLIGHT_DIST;
    const spotUsed = Math.min(cobraCount, STREETLIGHT_SPOT_POOL);
    for (let i = 0; i < spotUsed; i++) {
      const s = activeCobras[i];
      const fade = smoothFade(s._effDist, cobraCutoff * 0.62, cobraCutoff);
      const spot = streetlightSpotPool[i];
      spot.position.set(s.x, s.y, s.z);
      spot.target.position.set(s.tx, 0.0, s.tz);
      spot.target.updateMatrixWorld();
      spot.intensity = 88.0 * lampScale * fade;
    }
    for (let i = spotUsed; i < STREETLIGHT_SPOT_POOL; i++) {
      streetlightSpotPool[i].intensity = 0;
      streetlightSpotPool[i].position.set(0, -1000, 0);
    }

    let ptCount = 0;
    for (let i = 0; i < streetPointSites.length; i++) {
      const s = streetPointSites[i];
      const dx = s.x - cx;
      const dz = s.z - cz;
      const d2 = dx * dx + dz * dz + cy * cy;
      if (d2 > STREET_POINT_DIST_SQ) continue;
      const d = Math.sqrt(d2);
      const forwardDot = dx * fwdX + dz * fwdZ;
      const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
      if (effDist >= STREET_POINT_DIST) continue;
      s._effDist = effDist;
      activePoints[ptCount++] = s;
    }
    activePoints.length = ptCount;
    if (ptCount > 1) activePoints.sort((a, b) => a._effDist - b._effDist);

    const ptCutoff = ptCount > STREET_POINT_POOL
      ? Math.min(STREET_POINT_DIST, activePoints[STREET_POINT_POOL]._effDist)
      : STREET_POINT_DIST;
    const ptUsed = Math.min(ptCount, STREET_POINT_POOL);
    for (let i = 0; i < ptUsed; i++) {
      const s = activePoints[i];
      const fade = smoothFade(s._effDist, ptCutoff * 0.62, ptCutoff);
      const pt = streetPointPool[i];
      pt.color.setHex(s.color);
      pt.position.set(s.x, s.y, s.z);
      pt.distance = s.dist;
      pt.intensity = s.intensity * lampScale * fade;
    }
    for (let i = ptUsed; i < STREET_POINT_POOL; i++) {
      streetPointPool[i].intensity = 0;
      streetPointPool[i].position.set(0, -1000, 0);
    }
  }

  scene.add(group);
  return { group, footprints, signalClock, update };
}

Object.assign(window.NYC, { buildStreetDetails });
})();
