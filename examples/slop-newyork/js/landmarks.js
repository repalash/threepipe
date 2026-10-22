(function () {
// js/landmarks.js
// Custom architectural 3D models for Midtown Manhattan's iconic landmarks

const { THREE } = window.NYC;
const { getBlockBounds, LANDMARK_SITES, BLOCKS } = window.NYC;
const {
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createFacadeBoxes,
  createChryslerCrownMaterial,
  createBillboardMaterial
} = window.NYC;

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'ManhattanLandmarks';
  const colliders = [];

  const limestoneTrimMat = new THREE.MeshStandardNodeMaterial({
    color: 0xdad0bc,
    roughness: 0.68,
    metalness: 0.12
  });
  const stainlessSteelMat = new THREE.MeshStandardNodeMaterial({
    color: 0xe2ebf4,
    metalness: 0.88,
    roughness: 0.12
  });
  const chryslerCrownMat = createChryslerCrownMaterial();
  const darkBronzeFrameMat = new THREE.MeshStandardNodeMaterial({
    color: 0x26221e,
    roughness: 0.36,
    metalness: 0.72
  });
  const copperRoofMat = new THREE.MeshStandardNodeMaterial({
    color: 0x4b8770,
    roughness: 0.52,
    metalness: 0.28
  });
  const beaconMat = new THREE.MeshBasicNodeMaterial({
    color: 0xff2b2b
  });
  const warmFloodMat = new THREE.MeshStandardNodeMaterial({
    color: 0xffe8be,
    emissive: 0xffc870,
    emissiveIntensity: 1.35,
    roughness: 0.28
  });

  // Illuminated MetLife crown sign canvas texture
  const metlifeSignCanvas = document.createElement('canvas');
  metlifeSignCanvas.width = 512;
  metlifeSignCanvas.height = 128;
  const mlCtx = metlifeSignCanvas.getContext('2d');
  mlCtx.fillStyle = '#24221f';
  mlCtx.fillRect(0, 0, 512, 128);
  mlCtx.strokeStyle = '#6e665c';
  mlCtx.lineWidth = 6;
  mlCtx.strokeRect(4, 4, 504, 120);
  mlCtx.fillStyle = '#fff5dc';
  mlCtx.font = '900 76px Inter, Arial, sans-serif';
  mlCtx.textAlign = 'center';
  mlCtx.textBaseline = 'middle';
  mlCtx.fillText('METLIFE', 256, 68);
  const metlifeSignTex = new THREE.CanvasTexture(metlifeSignCanvas);
  metlifeSignTex.colorSpace = THREE.SRGBColorSpace;
  const metlifeSignMat = new THREE.MeshBasicNodeMaterial({ map: metlifeSignTex });

  // Shared canonical landmark facade TSL materials (avoids compiling 13 separate WGSL pipelines)
  const LIMESTONE_CROWN = {
    stoneColor: 0xdad0bc,
    trimColor: 0xa89e8a,
    windowGlassColor: 0x1a2836,
    windowWidth: 2.5,
    floorHeight: 3.6,
    litProbability: 0.58,
    warmth: 0.82,
    crownGlowHeight: 185.0,
    crownGlowColor: 0xffd584,
    seed: 19.31
  };
  const MARBLE_STONE = {
    stoneColor: 0xe6e0d4,
    trimColor: 0xa09888,
    windowGlassColor: 0x1a2634,
    windowWidth: 2.4,
    floorHeight: 3.6,
    litProbability: 0.60,
    warmth: 0.82,
    crownGlowHeight: 152.0,
    seed: 30.19
  };
  const SILVER_CURTAIN = {
    glassTint: 0x1e3e5a,
    frameTint: 0xc8d2dc,
    windowWidth: 2.8,
    floorHeight: 4.0,
    litProbability: 0.62,
    warmth: 0.52,
    reflectivity: 0.94,
    seed: 77.4
  };
  const BRONZE_CURTAIN = {
    glassTint: 0x242a32,
    frameTint: 0x48423c,
    windowWidth: 2.5,
    floorHeight: 3.7,
    litProbability: 0.66,
    warmth: 0.72,
    reflectivity: 0.88,
    seed: 58.2
  };
  const landmarkLimestoneCrownMat = createPreWarBuildingMaterial(LIMESTONE_CROWN);
  const landmarkMarbleStoneMat = createPreWarBuildingMaterial(MARBLE_STONE);
  const landmarkSilverCurtainMat = createCurtainWallMaterial(SILVER_CURTAIN);
  const landmarkBronzeCurtainMat = createCurtainWallMaterial(BRONZE_CURTAIN);
  // Their box-local twins: box-shaped parts are re-emitted as facade boxes at the end (see below)
  const boxLocalTwins = new Map([
    [landmarkLimestoneCrownMat, createPreWarBuildingMaterial({ ...LIMESTONE_CROWN, boxLocal: true })],
    [landmarkMarbleStoneMat, createPreWarBuildingMaterial({ ...MARBLE_STONE, boxLocal: true })],
    [landmarkSilverCurtainMat, createCurtainWallMaterial({ ...SILVER_CURTAIN, boxLocal: true })],
    [landmarkBronzeCurtainMat, createCurtainWallMaterial({ ...BRONZE_CURTAIN, boxLocal: true })]
  ]);


  // -------------------------------------------------------------------------------------------------------------------
  // Every landmark is modelled around a local origin, then fitted onto its real lot (city-config.js LANDMARK_SITES: the
  // OpenStreetMap outline's grid-aligned box): scaled up to its real height (as wide as the real outline allows, about
  // the model's centre) and moved so its centre stands on the outline's centre. Its colliders follow.
  // -------------------------------------------------------------------------------------------------------------------
  const fitted = [];
  function fitToSite(objs, site, c0, { height, horizontal, stretch = false, offset = [0, 0], name } = {}) {
    if (!site) return;
    const box = new THREE.Box3();
    for (const o of objs) {
      o.updateMatrixWorld(true);
      box.expandByObject(o);
    }
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const sy = height ? height / size.y : 1;
    let sx;
    let sz;
    if (stretch) {
      // fill the site's box exactly (parks & plazas)
      sx = site.w / size.x;
      sz = site.d / size.z;
    } else {
      // as tall as the real building, but never wider than its real outline (+6%) in either direction
      const fit = Math.min(site.w / size.x, site.d / size.z) * 1.06;
      sx = sz = horizontal ?? Math.min(sy, fit);
    }
    const tx = site.x + offset[0];
    const tz = site.z + offset[1];
    for (const o of objs) {
      o.position.set(tx + (o.position.x - c.x) * sx, o.position.y * sy, tz + (o.position.z - c.z) * sz);
      o.scale.multiply(new THREE.Vector3(sx, sy, sz));
    }
    for (let i = c0; i < colliders.length; i++) {
      const k = colliders[i];
      const x0 = tx + (k.minX - c.x) * sx;
      const x1 = tx + (k.maxX - c.x) * sx;
      const z0 = tz + (k.minZ - c.z) * sz;
      const z1 = tz + (k.maxZ - c.z) * sz;
      k.minX = Math.min(x0, x1);
      k.maxX = Math.max(x0, x1);
      k.minZ = Math.min(z0, z1);
      k.maxZ = Math.max(z0, z1);
      k.maxY *= sy;
    }
    fitted.push({ name, sx, sy, sz, w: size.x * sx, d: size.z * sz, h: size.y * sy, x: tx, z: tz });
  }
  const site = (name) => LANDMARK_SITES[name];
  // A site spanning several real outlines (Grand Central + the MetLife Building over it)
  const unionSite = (...names) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const n of names) {
      const t = LANDMARK_SITES[n];
      if (!t) continue;
      x0 = Math.min(x0, t.x - t.w / 2); x1 = Math.max(x1, t.x + t.w / 2);
      z0 = Math.min(z0, t.z - t.d / 2); z1 = Math.max(z1, t.z + t.d / 2);
    }
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
  };
  // A park block's curb island as a site (Bryant Park & the library)
  const blockSite = (parkName) => {
    const b = BLOCKS.filter((q) => q.parkName === parkName && !q.median).sort((p, q) => q.area - p.area)[0];
    return b && { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX - 9.2, d: b.maxZ - b.minZ - 9.2 };
  };

  // =========================================================================
  // 1. EMPIRE STATE BUILDING (Col 2, Row 5: 5th Ave & 34th St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(2, 5);
    const esb = new THREE.Group();
    esb.position.set(b.cx, 0, b.cz);

    const esbMat = landmarkLimestoneCrownMat;

    const podium = new THREE.Mesh(new THREE.BoxGeometry(68, 22, 50), esbMat);
    podium.position.y = 11;
    podium.castShadow = true;
    podium.receiveShadow = true;
    esb.add(podium);

    const portal = new THREE.Mesh(new THREE.BoxGeometry(3.2, 14, 12), limestoneTrimMat);
    portal.position.set(34.2, 7, 0);
    esb.add(portal);

    const tier1 = new THREE.Mesh(new THREE.BoxGeometry(54, 34, 38), esbMat);
    tier1.position.y = 22 + 17;
    tier1.castShadow = true;
    tier1.receiveShadow = true;
    esb.add(tier1);

    const tier2 = new THREE.Mesh(new THREE.BoxGeometry(44, 28, 32), esbMat);
    tier2.position.y = 56 + 14;
    tier2.castShadow = true;
    tier2.receiveShadow = true;
    esb.add(tier2);

    const mainShaft = new THREE.Mesh(new THREE.BoxGeometry(35, 112, 26), esbMat);
    mainShaft.position.y = 84 + 56;
    mainShaft.castShadow = true;
    mainShaft.receiveShadow = true;
    esb.add(mainShaft);

    for (const sx of [-18.5, 18.5]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 96, 16), esbMat);
      wing.position.set(sx, 84 + 48, 0);
      wing.castShadow = true;
      wing.receiveShadow = true;
      esb.add(wing);
    }

    const tier3 = new THREE.Mesh(new THREE.BoxGeometry(29, 24, 21), esbMat);
    tier3.position.y = 196 + 12;
    tier3.castShadow = true;
    esb.add(tier3);

    const tier4 = new THREE.Mesh(new THREE.BoxGeometry(23, 18, 17), esbMat);
    tier4.position.y = 220 + 9;
    tier4.castShadow = true;
    esb.add(tier4);

    // 86th-Floor Outdoor Observation Deck Terrace, Parapet Railing & Mullioned Glass Core
    const obsTerrace = new THREE.Mesh(new THREE.BoxGeometry(23.8, 1.1, 17.8), limestoneTrimMat);
    obsTerrace.position.y = 238.4;
    esb.add(obsTerrace);

    for (const pz of [-8.6, 8.6]) {
      const railZ = new THREE.Mesh(new THREE.BoxGeometry(23.6, 1.25, 0.32), stainlessSteelMat);
      railZ.position.set(0, 239.5, pz);
      esb.add(railZ);
    }
    for (const px of [-11.6, 11.6]) {
      const railX = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.25, 17.6), stainlessSteelMat);
      railX.position.set(px, 239.5, 0);
      esb.add(railX);
    }

    const obsDeck = new THREE.Mesh(new THREE.BoxGeometry(18.6, 6.4, 13.6), warmFloodMat);
    obsDeck.position.y = 238.8 + 3.2;
    esb.add(obsDeck);

    // Architectural window mullions & upper cornice on 86th-floor observatory
    for (let mx = -7.5; mx <= 7.5; mx += 3.0) {
      const mullionZ = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.4, 13.95), darkBronzeFrameMat);
      mullionZ.position.set(mx, 242.0, 0);
      esb.add(mullionZ);
    }
    for (let mz = -5.0; mz <= 5.0; mz += 2.5) {
      const mullionX = new THREE.Mesh(new THREE.BoxGeometry(18.95, 6.4, 0.45), darkBronzeFrameMat);
      mullionX.position.set(0, 242.0, mz);
      esb.add(mullionX);
    }
    const obsCap = new THREE.Mesh(new THREE.BoxGeometry(19.8, 0.9, 14.8), limestoneTrimMat);
    obsCap.position.y = 245.2;
    esb.add(obsCap);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 6.2, 30, 16), stainlessSteelMat);
    mast.position.y = 245 + 15;
    esb.add(mast);

    const ring102 = new THREE.Mesh(new THREE.CylinderGeometry(5.1, 5.1, 3.2, 16), warmFloodMat);
    ring102.position.y = 271;
    esb.add(ring102);

    const dome = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 4.6, 8, 16), stainlessSteelMat);
    dome.position.y = 276.5;
    esb.add(dome);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 1.4, 44, 12), stainlessSteelMat);
    spire.position.y = 280.5 + 22;
    esb.add(spire);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.95, 8, 8), beaconMat);
    beacon.position.y = 325.2;
    esb.add(beacon);

    group.add(esb);
    colliders.push({
      minX: b.cx - 34,
      maxX: b.cx + 34,
      minZ: b.cz - 25,
      maxZ: b.cz + 25,
      maxY: 245
    });
    fitToSite([esb], site('Empire State Building'), c0, { height: 443, name: 'esb' });
  }

  // =========================================================================
  // 2. CHRYSLER BUILDING (Col 5, Row 3: Lexington Ave & 42nd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(5, 3);
    const chrysler = new THREE.Group();
    chrysler.position.set(b.cx - 8, 0, b.cz + 6);

    const chryslerShaftMat = landmarkMarbleStoneMat;
    const crownMat = chryslerCrownMat;

    const base = new THREE.Mesh(new THREE.BoxGeometry(50, 24, 44), chryslerShaftMat);
    base.position.y = 12;
    base.castShadow = true;
    base.receiveShadow = true;
    chrysler.add(base);

    const step1 = new THREE.Mesh(new THREE.BoxGeometry(40, 24, 34), chryslerShaftMat);
    step1.position.y = 24 + 12;
    step1.castShadow = true;
    step1.receiveShadow = true;
    chrysler.add(step1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(31, 22, 28), chryslerShaftMat);
    step2.position.y = 48 + 11;
    step2.castShadow = true;
    step2.receiveShadow = true;
    chrysler.add(step2);

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(24, 102, 24), chryslerShaftMat);
    shaft.position.y = 70 + 51;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    chrysler.add(shaft);

    // 61st floor Silver Eagle Gargoyles at all 4 corners
    for (const gx of [-12.2, 12.2]) {
      for (const gz of [-12.2, 12.2]) {
        const gargoyle = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3.8, 6), stainlessSteelMat);
        gargoyle.position.set(gx * 1.06, 169, gz * 1.06);
        gargoyle.rotation.x = gz > 0 ? Math.PI * 0.38 : -Math.PI * 0.38;
        gargoyle.rotation.z = gx > 0 ? -Math.PI * 0.38 : Math.PI * 0.38;
        chrysler.add(gargoyle);
      }
    }

    // 7-Tier Terraced Art Deco Sunburst Crown with radiating triangular clerestory windows
    const numTiers = 7;
    let curY = 172;
    for (let t = 0; t < numTiers; t++) {
      const u = t / numTiers;
      const w = 22.8 * (1.0 - u * 0.72);
      const h = 6.8 * (1.0 - u * 0.16);

      const tierCore = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.82), crownMat);
      tierCore.position.y = curY + h * 0.5;
      chrysler.add(tierCore);

      const tierCross = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h, w), crownMat);
      tierCross.position.y = curY + h * 0.5;
      chrysler.add(tierCross);

      const rib = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.55, w + 0.7), stainlessSteelMat);
      rib.position.y = curY + h;
      chrysler.add(rib);

      curY += h;
    }

    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.35, 38, 12), stainlessSteelMat);
    needle.position.y = curY + 18;
    chrysler.add(needle);

    const cBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), beaconMat);
    cBeacon.position.y = curY + 37.5;
    chrysler.add(cBeacon);

    group.add(chrysler);
    colliders.push({
      minX: b.cx - 33,
      maxX: b.cx + 17,
      minZ: b.cz - 16,
      maxZ: b.cz + 28,
      maxY: 225
    });
    fitToSite([chrysler], site('Chrysler Building'), c0, { height: 319, name: 'chrysler' });
  }

  // =========================================================================
  // 3. ONE VANDERBILT (Col 3, Row 3: Vanderbilt Ave & 42nd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(3, 3);
    const vanderbilt = new THREE.Group();
    vanderbilt.position.set(b.cx + 12, 0, b.cz + 5);

    const ovMat = landmarkSilverCurtainMat;

    const segments = [
      { w: 40, d: 38, h: 68, y: 0, ox: 0, oz: 0 },
      { w: 35, d: 33, h: 72, y: 66, ox: 1.0, oz: -1.0 },
      { w: 29, d: 28, h: 62, y: 136, ox: -1.0, oz: 1.0 },
      { w: 23, d: 22, h: 42, y: 196, ox: 0.5, oz: 0.5 },
      { w: 15, d: 15, h: 24, y: 236, ox: 0, oz: 0 }
    ];
    for (const seg of segments) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(seg.w, seg.h, seg.d), ovMat);
      m.position.set(seg.ox, seg.y + seg.h * 0.5, seg.oz);
      m.castShadow = true;
      m.receiveShadow = true;
      vanderbilt.add(m);
    }

    // SUMMIT One Vanderbilt cantilevered glass sky-boxes & structural terracotta/steel fins
    const summitCore = new THREE.Mesh(new THREE.BoxGeometry(24.6, 8.2, 23.2), warmFloodMat);
    summitCore.position.set(0.5, 206, 0.5);
    vanderbilt.add(summitCore);

    for (let fx = -11; fx <= 11; fx += 2.75) {
      const finZ = new THREE.Mesh(new THREE.BoxGeometry(0.42, 8.6, 23.8), stainlessSteelMat);
      finZ.position.set(0.5 + fx, 206, 0.5);
      vanderbilt.add(finZ);
    }
    for (let fz = -10; fz <= 10; fz += 2.5) {
      const finX = new THREE.Mesh(new THREE.BoxGeometry(25.2, 8.6, 0.42), stainlessSteelMat);
      finX.position.set(0.5, 206, 0.5 + fz);
      vanderbilt.add(finX);
    }

    const ovSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.95, 30, 8), warmFloodMat);
    ovSpire.position.y = 260 + 15;
    vanderbilt.add(ovSpire);

    group.add(vanderbilt);
    colliders.push({
      minX: b.cx - 10,
      maxX: b.cx + 33,
      minZ: b.cz - 15,
      maxZ: b.cz + 25,
      maxY: 260
    });

    fitToSite([vanderbilt], site('One Vanderbilt'), c0, { height: 427, name: 'vanderbilt' });
  }

  // =========================================================================
  // 4. GRAND CENTRAL TERMINAL, PARK AVE VIADUCT & METLIFE BUILDING (Col 4, Row 3)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(4, 3);
    const gctGroup = new THREE.Group();
    gctGroup.position.set(b.cx, 0, b.cz);

    const gctBody = new THREE.Mesh(new THREE.BoxGeometry(62, 24, 28), landmarkMarbleStoneMat);
    gctBody.position.set(0, 12, 14);
    gctBody.castShadow = true;
    gctBody.receiveShadow = true;
    gctGroup.add(gctBody);

    const gctRoof = new THREE.Mesh(new THREE.BoxGeometry(58, 3.5, 24), copperRoofMat);
    gctRoof.position.set(0, 25.5, 14);
    gctGroup.add(gctRoof);

    // 3 Monumental Beaux-Arts Arched Windows on 42nd St with dark bronze muntin bars & paired Corinthian columns
    for (const wx of [-17, 0, 17]) {
      const archWin = new THREE.Mesh(new THREE.BoxGeometry(9.2, 14.2, 0.8), warmFloodMat);
      archWin.position.set(wx, 11.8, 28.05);
      gctGroup.add(archWin);

      const archTop = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.8, 16), warmFloodMat);
      archTop.rotation.x = Math.PI * 0.5;
      archTop.position.set(wx, 18.9, 28.05);
      gctGroup.add(archTop);

      // Bronze window mullions inside each monumental arch
      for (const mx of [-2.3, 0, 2.3]) {
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 16.5, 0.95), darkBronzeFrameMat);
        vBar.position.set(wx + mx, 13.0, 28.1);
        gctGroup.add(vBar);
      }
      for (const my of [8.5, 13.0, 17.5]) {
        const hBar = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.32, 0.95), darkBronzeFrameMat);
        hBar.position.set(wx, my, 28.1);
        gctGroup.add(hBar);
      }
    }

    // Paired Beaux-Arts Indiana Limestone Corinthian Columns flanking the 3 arches
    for (const cx of [-25.5, -23.0, -9.8, -7.2, 7.2, 9.8, 23.0, 25.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.70, 18.2, 12), limestoneTrimMat);
      col.position.set(cx, 12.2, 28.45);
      col.castShadow = true;
      gctGroup.add(col);
    }

    // Classical cornice entablature & stepped Mercury/Hercules/Minerva clock pediment
    const gctEntablature = new THREE.Mesh(new THREE.BoxGeometry(58, 1.8, 2.2), limestoneTrimMat);
    gctEntablature.position.set(0, 22.4, 28.2);
    gctGroup.add(gctEntablature);

    const pediment = new THREE.Mesh(new THREE.BoxGeometry(16, 4.8, 2.2), limestoneTrimMat);
    pediment.position.set(0, 25.4, 27.6);
    gctGroup.add(pediment);

    const pedimentPeak = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.4, 2.2), limestoneTrimMat);
    pedimentPeak.position.set(0, 28.6, 27.6);
    gctGroup.add(pedimentPeak);

    const clockBezel = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 0.75, 20), darkBronzeFrameMat);
    clockBezel.rotation.x = Math.PI * 0.5;
    clockBezel.position.set(0, 25.8, 28.55);
    gctGroup.add(clockBezel);

    const clockGlow = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.85, 20), warmFloodMat);
    clockGlow.rotation.x = Math.PI * 0.5;
    clockGlow.position.set(0, 25.8, 28.6);
    gctGroup.add(clockGlow);

    const viaductDeck = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 76), limestoneTrimMat);
    viaductDeck.position.set(-55, 9.5, 38);
    viaductDeck.castShadow = true;
    viaductDeck.receiveShadow = true;
    gctGroup.add(viaductDeck);

    for (const vz of [8, 28, 52, 70]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(9.5, 9.0, 3.5), limestoneTrimMat);
      pier.position.set(-55, 4.5, vz);
      pier.castShadow = true;
      pier.receiveShadow = true;
      gctGroup.add(pier);
    }

    const metlifeMat = landmarkBronzeCurtainMat;

    const mlCenter = new THREE.Mesh(new THREE.BoxGeometry(44, 198, 24), metlifeMat);
    mlCenter.position.set(0, 99, -12);
    mlCenter.castShadow = true;
    mlCenter.receiveShadow = true;
    gctGroup.add(mlCenter);

    const mlWingW = new THREE.Mesh(new THREE.BoxGeometry(16, 198, 16), metlifeMat);
    mlWingW.position.set(-24, 99, -12);
    mlWingW.rotation.y = Math.PI * 0.25;
    mlWingW.castShadow = true;
    gctGroup.add(mlWingW);

    const mlWingE = new THREE.Mesh(new THREE.BoxGeometry(16, 198, 16), metlifeMat);
    mlWingE.position.set(24, 99, -12);
    mlWingE.rotation.y = Math.PI * 0.25;
    mlWingE.castShadow = true;
    gctGroup.add(mlWingE);

    const signBand = new THREE.Mesh(new THREE.BoxGeometry(28.5, 6.8, 25.4), metlifeSignMat);
    signBand.position.set(0, 191, -12);
    gctGroup.add(signBand);

    group.add(gctGroup);
    colliders.push({
      minX: b.cx - 34,
      maxX: b.cx + 34,
      minZ: b.cz - 28,
      maxZ: b.cz + 28,
      maxY: 198
    });
    fitToSite([gctGroup], unionSite('Grand Central Terminal', 'MetLife Building'), c0, { height: 246, name: 'gct' });
  }

  // =========================================================================
  // 5. BRYANT PARK & NEW YORK PUBLIC LIBRARY (Col 2, Row 4: 5th Ave & 42nd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(2, 4);
    const bpGroup = new THREE.Group();
    bpGroup.position.set(b.cx, 0, b.cz);

    const nypl = new THREE.Mesh(new THREE.BoxGeometry(26, 21, 56), landmarkMarbleStoneMat);
    nypl.position.set(20, 10.5, 0);
    nypl.castShadow = true;
    nypl.receiveShadow = true;
    bpGroup.add(nypl);

    const nyplRoof = new THREE.Mesh(new THREE.BoxGeometry(22, 3.2, 50), copperRoofMat);
    nyplRoof.position.set(20, 22.5, 0);
    bpGroup.add(nyplRoof);

    // Beaux-Arts 5th Avenue Colonnaded Portico: recessed marble vestibule, 3 arched bronze/glass portals & 6 Corinthian columns
    const porticoBack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 18.5, 22), landmarkMarbleStoneMat);
    porticoBack.position.set(32.2, 9.25, 0);
    porticoBack.castShadow = true;
    porticoBack.receiveShadow = true;
    bpGroup.add(porticoBack);

    for (const pz of [-6.4, 0, 6.4]) {
      const archFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 11.8, 4.2), darkBronzeFrameMat);
      archFrame.position.set(33.3, 8.2, pz);
      bpGroup.add(archFrame);

      const archGlass = new THREE.Mesh(new THREE.BoxGeometry(1.25, 10.6, 3.2), warmFloodMat);
      archGlass.position.set(33.35, 8.0, pz);
      bpGroup.add(archGlass);
    }

    for (const cz of [-9.6, -5.8, -2.2, 2.2, 5.8, 9.6]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.66, 14.2, 12), limestoneTrimMat);
      column.position.set(34.8, 9.5, cz);
      column.castShadow = true;
      column.receiveShadow = true;
      bpGroup.add(column);
    }

    const porticoEntablature = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 22.4), limestoneTrimMat);
    porticoEntablature.position.set(33.6, 17.6, 0);
    porticoEntablature.castShadow = true;
    bpGroup.add(porticoEntablature);

    const porticoAttic = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 16.0), limestoneTrimMat);
    porticoAttic.position.set(33.4, 19.6, 0);
    bpGroup.add(porticoAttic);

    const stairs = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.4, 18), limestoneTrimMat);
    stairs.position.set(35.5, 1.2, 0);
    stairs.receiveShadow = true;
    bpGroup.add(stairs);

    for (const lz of [-10.5, 10.5]) {
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 2.2), limestoneTrimMat);
      pedestal.position.set(35.8, 1.1, lz);
      bpGroup.add(pedestal);
      const lion = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 1.2), limestoneTrimMat);
      lion.position.set(36.0, 2.8, lz);
      bpGroup.add(lion);
    }

    const lawnWall = new THREE.Mesh(new THREE.BoxGeometry(46, 0.85, 60), limestoneTrimMat);
    lawnWall.position.set(-14, 0.42, 0);
    lawnWall.receiveShadow = true;
    bpGroup.add(lawnWall);

    const lawnGrassMat = new THREE.MeshStandardNodeMaterial({
      color: 0x388c42,
      emissive: 0x081e0b,
      roughness: 0.80
    });
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(38, 0.28, 48), lawnGrassMat);
    lawn.position.set(-13, 0.92, 0);
    lawn.receiveShadow = true;
    bpGroup.add(lawn);

    const fountainBasin = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 6.2, 1.1, 20), limestoneTrimMat);
    fountainBasin.position.set(-29, 0.9, 0);
    bpGroup.add(fountainBasin);

    const fountainWater = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 0.16, 20),
      new THREE.MeshStandardNodeMaterial({ color: 0x24789c, emissive: 0x0a2e40, roughness: 0.12, metalness: 0.65 })
    );
    fountainWater.position.set(-29, 1.42, 0);
    bpGroup.add(fountainWater);

    const carouselBase = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.0, 2.8, 14), limestoneTrimMat);
    carouselBase.position.set(-12, 2.2, 21);
    bpGroup.add(carouselBase);
    const carouselRoof = new THREE.Mesh(
      new THREE.ConeGeometry(4.4, 2.2, 14),
      new THREE.MeshStandardNodeMaterial({ color: 0xb83228, roughness: 0.45 })
    );
    carouselRoof.position.set(-12, 4.6, 21);
    bpGroup.add(carouselRoof);

    group.add(bpGroup);
    colliders.push({
      minX: b.cx + 6,
      maxX: b.cx + 35,
      minZ: b.cz - 28,
      maxZ: b.cz + 28,
      maxY: 24
    });
    fitToSite([bpGroup], blockSite('Bryant Park'), c0, { height: 30, stretch: true, name: 'bryant' });
    bpGroup.updateMatrixWorld(true);
    const lb = new THREE.Box3().setFromObject(lawn);
    window.NYC.bryantParkLawn = { minX: lb.min.x, maxX: lb.max.x, minZ: lb.min.z, maxZ: lb.max.z, top: lb.max.y };
  }

  // =========================================================================
  // 6. ONE TIMES SQUARE & BROADWAY LED CANYON (Col 1, Row 3 & Broadway Corridor)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(1, 3);
    const tsGroup = new THREE.Group();
    tsGroup.position.set(b.cx, 0, b.cz);

    const darkFacadeMat = landmarkBronzeCurtainMat;

    const otsW = 18;
    const otsD = 26;
    const otsH = 118;
    const otsX = -16; // b.cx - 16 = -181 (sits right on the Times Square bowtie prow east of Broadway x=-201)
    const otsTower = new THREE.Mesh(new THREE.BoxGeometry(otsW, otsH, otsD), darkFacadeMat);
    otsTower.position.set(otsX, otsH * 0.5, 14);
    otsTower.castShadow = true;
    otsTower.receiveShadow = true;
    tsGroup.add(otsTower);

    for (let s = 0; s < 5; s++) {
      const panelH = 17.5;
      const panelY = 14 + s * 19.5;
      const screenW = new THREE.Mesh(new THREE.PlaneGeometry(otsD - 2, panelH), createBillboardMaterial(s));
      screenW.rotation.y = -Math.PI * 0.5;
      screenW.position.set(otsX - otsW * 0.5 - 0.25, panelY, 14);
      tsGroup.add(screenW);

      const screenS = new THREE.Mesh(new THREE.PlaneGeometry(otsW - 2, panelH), createBillboardMaterial(s + 1));
      screenS.position.set(otsX, panelY, 14 + otsD * 0.5 + 0.25);
      tsGroup.add(screenS);

      const screenN = new THREE.Mesh(new THREE.PlaneGeometry(otsW - 2, panelH), createBillboardMaterial(s + 3));
      screenN.rotation.y = Math.PI;
      screenN.position.set(otsX, panelY, 14 - otsD * 0.5 - 0.25);
      tsGroup.add(screenN);
    }

    const ballMast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 26, 8), stainlessSteelMat);
    ballMast.position.set(otsX, otsH + 13, 14);
    tsGroup.add(ballMast);

    const nyeBall = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 14, 14),
      new THREE.MeshBasicNodeMaterial({ color: 0x88f5ff })
    );
    nyeBall.position.set(otsX, otsH + 22, 14);
    tsGroup.add(nyeBall);

    // (the towers around the bowtie are the procedural blocks' Broadway flush walls & billboards now)
    group.add(tsGroup);
    colliders.push({ minX: b.cx + otsX - 9, maxX: b.cx + otsX + 9, minZ: b.cz + 1, maxZ: b.cz + 27, maxY: otsH });
    fitToSite([tsGroup], site('One Times Square'), c0, { height: 120, name: 'timessquare' });
  }

  // =========================================================================
  // 7. ROCKEFELLER CENTER / 30 ROCK (Col 2, Row 2: 5th-6th Ave, 45th-48th St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(2, 2);
    const rockGroup = new THREE.Group();
    rockGroup.position.set(b.cx, 0, b.cz);

    const rockMat = landmarkLimestoneCrownMat;

    const slabMain = new THREE.Mesh(new THREE.BoxGeometry(24, 212, 56), rockMat);
    slabMain.position.set(-14, 106, 0);
    slabMain.castShadow = true;
    slabMain.receiveShadow = true;
    rockGroup.add(slabMain);

    const slabStep1 = new THREE.Mesh(new THREE.BoxGeometry(34, 135, 44), rockMat);
    slabStep1.position.set(-14, 67.5, 0);
    slabStep1.castShadow = true;
    slabStep1.receiveShadow = true;
    rockGroup.add(slabStep1);

    for (const cz of [-18, 18]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(28, 28, 18), rockMat);
      wing.position.set(18, 14, cz);
      wing.castShadow = true;
      wing.receiveShadow = true;
      rockGroup.add(wing);
    }

    const prometheus = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.45, 10, 20),
      new THREE.MeshStandardNodeMaterial({ color: 0xffc845, metalness: 0.65, roughness: 0.22 })
    );
    prometheus.position.set(1, 3.8, 0);
    prometheus.rotation.y = Math.PI * 0.5;
    rockGroup.add(prometheus);

    group.add(rockGroup);
    colliders.push({
      minX: b.cx - 32,
      maxX: b.cx + 4,
      minZ: b.cz - 28,
      maxZ: b.cz + 28,
      maxY: 212
    });
    fitToSite([rockGroup], site('30 Rockefeller Plaza'), c0, { height: 259, name: 'rockefeller' });
  }

  // =========================================================================
  // 8. CITIGROUP CENTER (Col 5, Row 1: Lexington Ave & 53rd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(5, 1);
    const citiGroup = new THREE.Group();
    citiGroup.position.set(b.cx, 0, b.cz);

    const citiMat = landmarkSilverCurtainMat;

    for (const [sx, sz] of [[-18, 0], [18, 0], [0, -18], [0, 18]]) {
      const stilt = new THREE.Mesh(new THREE.BoxGeometry(7.5, 30, 7.5), stainlessSteelMat);
      stilt.position.set(sx, 15, sz);
      stilt.castShadow = true;
      stilt.receiveShadow = true;
      citiGroup.add(stilt);
    }
    const core = new THREE.Mesh(new THREE.BoxGeometry(16, 30, 16), stainlessSteelMat);
    core.position.set(0, 15, 0);
    core.castShadow = true;
    core.receiveShadow = true;
    citiGroup.add(core);

    const citiShaft = new THREE.Mesh(new THREE.BoxGeometry(42, 145, 42), citiMat);
    citiShaft.position.set(0, 30 + 72.5, 0);
    citiShaft.castShadow = true;
    citiShaft.receiveShadow = true;
    citiGroup.add(citiShaft);

    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(-21, 0);
    wedgeShape.lineTo(21, 0);
    wedgeShape.lineTo(-21, 34);
    wedgeShape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, { depth: 42, bevelEnabled: false });
    wedgeGeo.translate(0, 0, -21);
    const citiCrown = new THREE.Mesh(wedgeGeo, stainlessSteelMat);
    citiCrown.position.set(0, 175, 0);
    citiGroup.add(citiCrown);

    group.add(citiGroup);
    colliders.push({
      minX: b.cx - 21,
      maxX: b.cx + 21,
      minZ: b.cz - 21,
      maxZ: b.cz + 21,
      maxY: 209
    });
    fitToSite([citiGroup], site('Citigroup Center'), c0, { height: 279, name: 'citigroup' });
  }

  // =========================================================================
  // 9. FLATIRON BUILDING (Col 2, Row 7: 5th Ave / Broadway & 23rd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(2, 7);
    const flatironGroup = new THREE.Group();
    // Sits on the triangular island between Broadway (x = -42) and 5th Ave (x = 0)
    flatironGroup.position.set(b.cx + 28, 0, b.cz - 4);

    const flatironMat = landmarkMarbleStoneMat;

    const triShape = new THREE.Shape();
    triShape.moveTo(0, -26);
    triShape.quadraticCurveTo(2.0, -26, 11, 24);
    triShape.lineTo(-13, 24);
    triShape.quadraticCurveTo(-2.5, -26, 0, -26);

    const flatGeo = new THREE.ExtrudeGeometry(triShape, {
      depth: 88,
      bevelEnabled: true,
      bevelThickness: 0.6,
      bevelSize: 0.6,
      bevelSegments: 2
    });
    flatGeo.rotateX(Math.PI * 0.5);
    flatGeo.translate(0, 88, 0);

    const flatironMesh = new THREE.Mesh(flatGeo, flatironMat);
    flatironMesh.castShadow = true;
    flatironMesh.receiveShadow = true;
    flatironGroup.add(flatironMesh);

    const corniceGeo = new THREE.ExtrudeGeometry(triShape, {
      depth: 2.8,
      bevelEnabled: true,
      bevelThickness: 0.8,
      bevelSize: 1.2,
      bevelSegments: 2
    });
    corniceGeo.rotateX(Math.PI * 0.5);
    corniceGeo.translate(0, 89.2, 0);
    const corniceMesh = new THREE.Mesh(corniceGeo, limestoneTrimMat);
    flatironGroup.add(corniceMesh);

    group.add(flatironGroup);
    colliders.push({ minX: b.cx + 15, maxX: b.cx + 39, minZ: b.cz - 30, maxZ: b.cz + 20, maxY: 90 });
    fitToSite([flatironGroup], site('Flatiron Building'), c0, { height: 87, name: 'flatiron' });
  }

  // =========================================================================
  // 10. SEAGRAM BUILDING & GRANITE PLAZA (Col 4, Row 1: Park Ave & 53rd St)
  // =========================================================================
  {
    const c0 = colliders.length;
    const b = getBlockBounds(4, 1);
    const seagramGroup = new THREE.Group();
    seagramGroup.position.set(b.cx, 0, b.cz);

    const seagramMat = landmarkBronzeCurtainMat;

    const tower = new THREE.Mesh(new THREE.BoxGeometry(42, 162, 36), seagramMat);
    tower.position.set(8, 81, 0);
    tower.castShadow = true;
    tower.receiveShadow = true;
    seagramGroup.add(tower);

    const bustle = new THREE.Mesh(new THREE.BoxGeometry(24, 92, 26), seagramMat);
    bustle.position.set(22, 46, 0);
    bustle.castShadow = true;
    bustle.receiveShadow = true;
    seagramGroup.add(bustle);

    const poolMat = new THREE.MeshStandardNodeMaterial({ color: 0x1e5266, roughness: 0.1, metalness: 0.7 });
    for (const pz of [-14, 14]) {
      const pool = new THREE.Mesh(new THREE.BoxGeometry(14, 0.55, 12), poolMat);
      pool.position.set(-22, 0.32, pz);
      seagramGroup.add(pool);
    }

    group.add(seagramGroup);
    colliders.push({
      minX: b.cx - 13,
      maxX: b.cx + 34,
      minZ: b.cz - 18,
      maxZ: b.cz + 18,
      maxY: 162
    });
    fitToSite([seagramGroup], site('Seagram Building'), c0, { height: 157, offset: [-14, 0], name: 'seagram' });
  }

  // =========================================================================
  // 11. ONE WORLD TRADE CENTER (LOWER MANHATTAN · VESEY ST & FULTON ST)
  // =========================================================================
  {
    const c0 = colliders.length;
    const owtcGroup = new THREE.Group();
    owtcGroup.position.set(-260, 0, 1234);

    const owtcMat = landmarkSilverCurtainMat;
    const podiumFinMat = new THREE.MeshStandardNodeMaterial({
      color: 0xc8d4e0,
      roughness: 0.22,
      metalness: 0.85
    });

    // 52m-tall Glass & Steel Podium Base with Vertical Prismatic Louver Fins
    const basePodium = new THREE.Mesh(new THREE.BoxGeometry(48, 52, 48), owtcMat);
    basePodium.position.y = 26;
    basePodium.castShadow = true;
    basePodium.receiveShadow = true;
    owtcGroup.add(basePodium);

    for (let f = -20; f <= 20; f += 5) {
      const finNS = new THREE.Mesh(new THREE.BoxGeometry(0.45, 44, 49.2), podiumFinMat);
      finNS.position.set(f, 28, 0);
      owtcGroup.add(finNS);

      const finEW = new THREE.Mesh(new THREE.BoxGeometry(49.2, 44, 0.45), podiumFinMat);
      finEW.position.set(0, 28, f);
      owtcGroup.add(finEW);
    }

    // Illuminated Vesey St / Fulton St Double-Height Glass Lobby Portals
    const lobbyNS = new THREE.Mesh(new THREE.BoxGeometry(24, 9.5, 48.6), warmFloodMat);
    lobbyNS.position.set(0, 4.8, 0);
    owtcGroup.add(lobbyNS);
    const lobbyEW = new THREE.Mesh(new THREE.BoxGeometry(48.6, 9.5, 24), warmFloodMat);
    lobbyEW.position.set(0, 4.8, 0);
    owtcGroup.add(lobbyEW);

    //Podium Setback Collar at y = 52m
    const podiumCollar = new THREE.Mesh(new THREE.BoxGeometry(49.6, 1.8, 49.6), podiumFinMat);
    podiumCollar.position.y = 52.0;
    owtcGroup.add(podiumCollar);

    // True Flat-Faceted Chamfered Square Antiprism Shaft (8 razor-sharp triangular glass planes)
    const shaft1Geo = new THREE.CylinderGeometry(23.5, 33.9, 235, 4).toNonIndexed();
    shaft1Geo.computeVertexNormals();
    const shaft1 = new THREE.Mesh(shaft1Geo, owtcMat);
    shaft1.rotation.y = Math.PI * 0.25;
    shaft1.position.y = 52 + 117.5;
    shaft1.castShadow = true;
    shaft1.receiveShadow = true;
    owtcGroup.add(shaft1);

    const shaft2Geo = new THREE.CylinderGeometry(33.9, 23.5, 235, 4).toNonIndexed();
    shaft2Geo.computeVertexNormals();
    const shaft2 = new THREE.Mesh(shaft2Geo, owtcMat);
    shaft2.position.y = 52 + 117.5;
    shaft2.castShadow = true;
    shaft2.receiveShadow = true;
    owtcGroup.add(shaft2);

    const parapetRing = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 8, 16), warmFloodMat);
    parapetRing.position.y = 291;
    owtcGroup.add(parapetRing);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 2.2, 68, 12), podiumFinMat);
    spire.position.y = 295 + 34;
    owtcGroup.add(spire);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 10), warmFloodMat);
    beacon.position.y = 364;
    owtcGroup.add(beacon);

    group.add(owtcGroup);
    colliders.push({
      minX: -285,
      maxX: -235,
      minZ: 1209,
      maxZ: 1259,
      maxY: 364
    });
    fitToSite([owtcGroup], site('One World Trade Center'), c0, { height: 541, horizontal: 1.27, name: 'owtc' }); // a 61 m square base
  }

  // Box-shaped facade parts (unrotated) become box-local facade boxes: every wall laid out in whole window bays between
  // solid masonry corners, like the procedural blocks, so no window is cut by a corner. Rotated & non-box parts (MetLife
  // wings, Flatiron prism, One WTC antiprism) keep the world-space window grid.
  group.updateMatrixWorld(true);
  const facadeBoxes = new Map();
  const boxParts = [];
  group.traverse((obj) => {
    if (obj.isMesh && boxLocalTwins.has(obj.material) && obj.geometry.type === 'BoxGeometry') boxParts.push(obj);
  });
  const partPos = new THREE.Vector3();
  const partRot = new THREE.Quaternion();
  const partScale = new THREE.Vector3();
  for (const m of boxParts) {
    m.matrixWorld.decompose(partPos, partRot, partScale);
    if (Math.abs(partRot.w) < 0.99999) continue;
    const { width, height, depth } = m.geometry.parameters;
    const twin = boxLocalTwins.get(m.material);
    if (!facadeBoxes.has(twin)) facadeBoxes.set(twin, []);
    facadeBoxes.get(twin).push({ x: partPos.x, y: partPos.y, z: partPos.z, w: width * partScale.x, h: height * partScale.y, d: depth * partScale.z });
    m.removeFromParent();
  }
  for (const [mat, boxes] of facadeBoxes) {
    const inst = createFacadeBoxes(mat, boxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }

  if (window.NYC.batchStaticGroupMeshes) {
    window.NYC.batchStaticGroupMeshes(group, new Set([stainlessSteelMat]));
  }

  window.NYC.landmarkFits = fitted;
  scene.add(group);
  return { group, colliders };
}

Object.assign(window.NYC, { buildLandmarks });
})();
