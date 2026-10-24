(function () {
// js/controllers.js
// Sculpted, non-blocky GTA 6-style 3D models, animations, and physics controllers
// for Third-Person Navigation:
// 1. Person (Skinned Pedestrian: planted-footstep IK walk/run/jump, see pedestrians.js)
// 2. Car (Aerodynamic Sculpted NYC Medallion Yellow Taxi with Sloped Windshield & Clearcoat)
// 3. Cyclist (Sculpted Road Cyclist with Drop-Bar Frame & Aero Helmet)
// 4. Helicopter (Manhattan Sightseeing Twin-Turbine Chopper)

const { THREE } = window.NYC;
const { ISLAND_BOUNDS, CENTRAL_PARK_BOUNDS, LANDMARK_SITES, getIslandBoundsAtZ, isTypingInField, blockAt, streetZ } = window.NYC;
// Spawn on 5th Ave at 37th St, facing south down the avenue toward the Empire State Building (34th St)
const SPAWN_Z = streetZ(37);
const {
  cityUniforms,
  createCarPaintMaterial,
  createContactShadowMaterial
} = window.NYC;
const {
  BODY_SPECS,
  buildCarGeometry,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  createLoftedCarMaterial,
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} = window.NYC;
const { PersonCrowd, PersonRig } = window.NYC;
const { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } = window.NYC;
// Walking surface for the player's pedestrian (its rig samples it around its feet)
const personGround = (controllers, x, z) => controllers.getGroundHeight(x, z, 'person');

function createTaxiDoorDecalTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffbe14';
  ctx.fillRect(0, 0, 256, 128);
  // Black T&LC circle emblem
  ctx.fillStyle = '#111317';
  ctx.beginPath();
  ctx.arc(58, 64, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffbe14';
  ctx.font = '900 32px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', 58, 66);
  // NYC TAXI typography & Fare Rate
  ctx.fillStyle = '#111317';
  ctx.textAlign = 'left';
  ctx.font = '900 26px Inter, Arial, sans-serif';
  ctx.fillText('NYC TAXI', 112, 42);
  ctx.font = '700 15px JetBrains Mono, monospace';
  ctx.fillText('7Y48 · MEDALLION', 112, 68);
  ctx.font = '600 13px Inter, Arial, sans-serif';
  ctx.fillText('$3.00 INITIAL FARE', 112, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNYLicensePlateTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffb81c';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0d2244';
  ctx.fillRect(6, 6, 244, 24);
  ctx.fillStyle = '#ffb81c';
  ctx.font = '800 15px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NEW YORK', 128, 23);
  ctx.fillStyle = '#0d2244';
  ctx.font = '900 48px JetBrains Mono, monospace';
  ctx.fillText('7Y48A', 128, 82);
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.fillText('NYC T&LC', 128, 114);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class ThirdPersonControllerManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this._colliderCells = null; // built on first use, see nearColliders()
    this.activeMode = 'car'; // 'person' | 'car' | 'cyclist' | 'helicopter'

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false
    };

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity(),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity()
    };

    Object.values(this.entities).forEach((ent) => {
      if (ent.mesh) {
        ent.mesh.traverse((child) => {
          if (
            child.isMesh &&
            !child.material?.isMeshBasicNodeMaterial &&
            child.material?.type !== 'MeshBasicNodeMaterial' &&
            !child.material?.transparent
          ) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    });

    this.bindKeyboard();
  }

  bindKeyboard() {
    const bindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space', 'KeyE'],
      down: ['KeyQ', 'KeyC'],
      boost: ['ShiftLeft', 'ShiftRight']
    };
    const actionsByCode = new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map((code) => [code, action])));
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};

    const onKey = (e, isDown) => {
      const action = actionsByCode.get(e.code);
      if (!action || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      // Releasing one binding must not cancel another key held for the same action.
      this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
      this.keys[action] = this._keyboardKeys[action] || this._touchKeys[action] || false;
    };

    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  setTouchInput(action, value) {
    if (!Object.hasOwn(this.keys, action)) return;
    this._touchKeys[action] = typeof value === 'boolean' ? value : Math.max(0, Math.min(1, Number(value) || 0));
    this.keys[action] = this._keyboardKeys[action] || this._touchKeys[action] || false;
  }

  clearTouchInput() {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys)) this.keys[action] = this._keyboardKeys[action] || false;
  }

  resetInput() {
    this._pressedCodes.clear();
    this._keyboardKeys = {};
    this.clearTouchInput();
  }

  setMode(mode) {
    if (!this.entities[mode]) return;
    this.activeMode = mode;
  }

  getActiveEntity() {
    return this.entities[this.activeMode];
  }

  teleportActiveTo(x, z, heading = Math.PI) {
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    const heli = this.activeMode === 'helicopter';
    const altitude = heli ? Math.max(92, Math.min(380, ent.position.y)) : 0;
    const destination = this.findTeleportPosition(x, z, heading, altitude);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode);
    }
    ent.speed = 0;
    if (this.activeMode === 'person') {
      ent.verticalVel = 0;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (this.activeMode === 'car') {
      ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
      ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
      ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
      ent.chassisPivot.position.y = 0;
      ent.lastCollisionSpark = null;
      for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
      if (ent.carState) ent.carState.value.x = 1;
    } else if (this.activeMode === 'cyclist') {
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
    } else if (heli) {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
    return { x: ent.position.x, z: ent.position.z };
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
  findTeleportPosition(x, z, heading, altitude) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = this.activeMode === 'helicopter';
    const car = this.activeMode === 'car';
    const radius = heli ? 4.5 : this.activeMode === 'person' ? 0.48 : 0.65;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const extX = (car ? Math.abs(cosH) * 0.86 + Math.abs(sinH) * 2.18 : radius) + 0.1;
    const extZ = (car ? Math.abs(sinH) * 0.86 + Math.abs(cosH) * 2.18 : radius) + 0.1;
    const reach = Math.max(extX, extZ);
    const margin = heli ? 6000 : 0;
    const entity = this.getActiveEntity();
    // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
    const body = { person: [0.48, 1.9], car: [2.4, 1.9], cyclist: [1.0, 1.9], helicopter: [6.2, 3.2] };
    const others = Object.values(this.entities).filter(e => e !== entity).map(e => ({
      x: e.position.x, z: e.position.z, radius: body[e.type][0],
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + body[e.type][1]
    }));
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px, pz) => {
      pz = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + margin, pz));
      px = Math.max(ISLAND_BOUNDS.minX - margin, Math.min(ISLAND_BOUNDS.maxX + margin, px));
      if (!heli && getIslandBoundsAtZ) {
        const shore = getIslandBoundsAtZ(pz);
        const west = shore.westX + 8, east = shore.eastX - 8;
        if (west > east) return null;
        px = Math.max(west, Math.min(east, px));
      }
      return { x: px, z: pz };
    };
    const clear = (p) => {
      if (!p) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, this.activeMode);
      const y = heli ? altitude : this.activeMode === 'person' ? baseY + 1 : 1;
      // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
      // parked car between camera and character from hiding the character even when the camera itself is outside it.
      const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
      }
      for (const c of this.nearColliders(p.x, p.z, reach)) {
        if (y > c.maxY + 1.5) continue;
        if (p.x + extX <= c.minX || p.x - extX >= c.maxX || p.z + extZ <= c.minZ || p.z - extZ >= c.maxZ) continue;
        if (c.obb) {
          const o = c.obb, dx = p.x - o.cx, dz = p.z - o.cz;
          const ls = sinH * o.cs - cosH * o.sn, lc = sinH * o.sn + cosH * o.cs;
          const ex = (car ? Math.abs(lc) * 0.86 + Math.abs(ls) * 2.18 : radius) + 0.1;
          const ez = (car ? Math.abs(ls) * 0.86 + Math.abs(lc) * 2.18 : radius) + 0.1;
          if (Math.abs(dx * o.cs - dz * o.sn) >= o.hx + ex || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + ez) continue;
        }
        return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    const cx = origin ? origin.x : Math.max(ISLAND_BOUNDS.minX, Math.min(ISLAND_BOUNDS.maxX, x));
    const cz = origin ? origin.z : Math.max(ISLAND_BOUNDS.minZ + 30, Math.min(ISLAND_BOUNDS.maxZ, z));
    for (let distance = 4; distance <= 256; distance += 4) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // =========================================================================
  // 1. PERSON (SKINNED NYC PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.js)
  // =========================================================================
  createPersonEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';

    // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });

    // Soft Under-Foot Contact Shadow (AO)
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const pedShadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    pedShadow.position.y = 0.02;
    pedShadow.renderOrder = 998;
    root.add(pedShadow);

    this.scene.add(root);

    return {
      type: 'person',
      label: 'Pedestrian',
      mesh: root,
      crowd,
      rig,
      position: new THREE.Vector3(-11.6, ISLAND_BOUNDS.sidewalkHeight, SPAWN_Z + 12),
      heading: 0,
      speed: 0,
      verticalVel: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 4.3,
      chaseHeight: 1.95
    };
  }

  // =========================================================================
  // 2. CAR (3D LOFTED SCULPTED NYC MEDALLION YELLOW TAXI SEDAN)
  // =========================================================================
  createCarEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerTaxiCar';

    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);

    const spec = BODY_SPECS.taxi;
    const taxiLoftMat = createLoftedCarMaterial(spec, 0xffbe14);

    // 1. 3D Lofted Taxi Body + Curved Windscreens + Crowned Roof + Side Mirrors + Roof Sign
    const carBodyGeo = buildCarGeometry(spec, false);
    const carBodyMesh = new THREE.Mesh(carBodyGeo, taxiLoftMat);
    carBodyMesh.castShadow = true;
    carBodyMesh.receiveShadow = true;
    chassisPivot.add(carBodyMesh);

    // 2. Authentic NYC Taxi Side Door T&LC Medallion & Fare Tariff Emblem Decals, hugging the curved front doors
    const doorDecalTex = createTaxiDoorDecalTexture();
    const doorDecalMat = new THREE.MeshStandardNodeMaterial({
      map: doorDecalTex,
      roughness: 0.24,
      metalness: 0.34,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const doorMid = (spec.doors[0] + spec.doors[1]) / 2;
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(buildCarSidePatch(spec, side, doorMid - 0.36, doorMid + 0.36, 0.53, 0.81, 0.003), doorDecalMat);
      chassisPivot.add(decal);
    }

    // 3. High-Detail NY Empire Gold License Plates on the bumpers
    const nyPlateTex = createNYLicensePlateTexture();
    const nyPlateMat = new THREE.MeshStandardNodeMaterial({ map: nyPlateTex, roughness: 0.28 });
    const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), nyPlateMat);
    rearPlate.position.set(0, spec.plates[1], spec.zRear - 0.006);
    chassisPivot.add(rearPlate);

    const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), nyPlateMat);
    frontPlate.position.set(0, spec.plates[0], spec.zFront + 0.006);
    chassisPivot.add(frontPlate);

    // 3b. Brake lights, CHMSL & turn signals are lit by the taxi material from its carState uniform (see updateCar)
    const carState = taxiLoftMat.userData.carState;

    // 4. Steerable & Spinning 3D LatheGeometry Tyres + Recessed 5-Spoke Alloy Wheels
    const leftWheelGeo = buildSteerableWheelGeo(spec, -1);
    const rightWheelGeo = buildSteerableWheelGeo(spec, 1);

    const wheels = [];
    const wheelCoords = [
      { side: -1, z: spec.wheelZ, isFront: true },
      { side: 1, z: spec.wheelZ, isFront: true },
      { side: -1, z: -spec.wheelZ, isFront: false },
      { side: 1, z: -spec.wheelZ, isFront: false }
    ];
    for (const wc of wheelCoords) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wc.side * spec.wheelX, spec.wheelRadius, wc.z);
      const tire = new THREE.Mesh(wc.side < 0 ? leftWheelGeo : rightWheelGeo, taxiLoftMat);
      tire.castShadow = true;
      tire.receiveShadow = true;
      steerPivot.add(tire);
      root.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: wc.isFront });
    }

    // 5. Soft Under-Car Contact Shadow (AO) + Clustered Dual LED Headlight SpotLights & Rear Brake PointLight
    const carShadowGeo = new THREE.PlaneGeometry(2.22, 5.05);
    carShadowGeo.rotateX(-Math.PI * 0.5);
    const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
    carShadow.position.set(0, 0.02, 0.0);
    carShadow.renderOrder = 998;
    root.add(carShadow);

    const headLights = [];
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }

    this.scene.add(root);

    return {
      type: 'car',
      label: 'NYC Yellow Taxi',
      mesh: root,
      chassisPivot,
      carState,
      headLights,
      wheels,
      position: new THREE.Vector3(3.6, 0.0, SPAWN_Z + 12),
      heading: 0,
      speed: 0,
      vx: 0,
      vz: 0,
      angularVel: 0,
      pitchVel: 0,
      rollVel: 0,
      heaveY: 0,
      heaveVel: 0,
      lastCollisionSpark: null,
      steerAngle: 0,
      wheelSpin: 0,
      cameraTargetOffset: new THREE.Vector3(0, 0.96, 0),
      chaseDistance: 6.9,
      chaseHeight: 2.12
    };
  }

  // =========================================================================
  // 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
  // =========================================================================
  createCyclistEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerCyclist';

    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const frameMat = createCarPaintMaterial(0x0078e8);
    const tireMat = new THREE.MeshStandardNodeMaterial({
      color: 0x181a1e,
      roughness: 0.60
    });
    const chromeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xe0e8f0,
      roughness: 0.16,
      metalness: 0.78
    });
    const shortsMat = new THREE.MeshStandardNodeMaterial({
      color: 0x1c2028,
      roughness: 0.55
    });
    const helmetMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf4f7fb,
      emissive: 0x181c22,
      roughness: 0.22,
      metalness: 0.25
    });

    const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
    wheelTorusGeo.rotateY(Math.PI * 0.5);
    const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
    rimTorusGeo.rotateY(Math.PI * 0.5);

    const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    frontWheel.position.set(0, 0.38, 0.58);
    leanPivot.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    rearWheel.position.set(0, 0.38, -0.58);
    leanPivot.add(rearWheel);

    // Rear red LED safety strobe on seatpost
    const tailLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
    );
    tailLed.position.set(0, 0.86, -0.32);
    leanPivot.add(tailLed);

    const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
    topTube.rotation.x = Math.PI * 0.46;
    topTube.position.set(0, 0.78, 0.04);
    leanPivot.add(topTube);

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
    downTube.rotation.x = Math.PI * 0.28;
    downTube.position.set(0, 0.58, 0.16);
    leanPivot.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
    seatTube.rotation.x = -0.22;
    seatTube.position.set(0, 0.66, -0.22);
    leanPivot.add(seatTube);

    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
    saddle.rotation.x = Math.PI * 0.5;
    saddle.scale.set(1.15, 1.0, 0.55);
    saddle.position.set(0, 0.96, -0.28);
    leanPivot.add(saddle);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
    fork.rotation.x = -0.24;
    fork.position.set(0, 0.68, 0.48);
    leanPivot.add(fork);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
    handlebar.rotation.z = Math.PI * 0.5;
    handlebar.position.set(0, 0.98, 0.40);
    leanPivot.add(handlebar);

    // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.98, -0.28),
      bars: new THREE.Vector3(0, 0.98, 0.4),
      gripHalf: 0.22,
      bracket: new THREE.Vector3(0, 0.34, -0.145),
      crankLength: 0.17
    };
    const crankPivot = new THREE.Group();
    crankPivot.position.copy(bikeFrame.bracket);
    const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
    const pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.x = side > 0 ? 0 : Math.PI;
      const crank = new THREE.Mesh(crankGeo, chromeMat);
      crank.position.x = side * 0.065;
      const pedal = new THREE.Mesh(pedalGeo, tireMat);
      pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
      arm.add(crank, pedal);
      crankPivot.add(arm);
      pedals.push(pedal);
    }
    leanPivot.add(crankPivot);

    // Skinned rider (see pedestrians.js), posed every frame with its hands on the grips and feet on the pedals; the
    // helmet rides on its head
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
    helmet.scale.set(0.95, 0.68, 1.28);
    this.scene.add(helmet);

    const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
    bikeShadowGeo.rotateX(-Math.PI * 0.5);
    const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
    bikeShadow.position.set(0, 0.02, 0.0);
    bikeShadow.renderOrder = 998;
    root.add(bikeShadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
    headLight.position.set(0, 1.32, 0.62);
    headLight.target.position.set(0, 0.0, 7.6);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);

    return {
      type: 'cyclist',
      label: 'NYC Bike Lane Cyclist',
      mesh: root,
      leanPivot,
      frontWheel,
      rearWheel,
      crankPivot,
      pedals,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      headLight,
      position: new THREE.Vector3(5.2, 0.0, SPAWN_Z - 8),
      heading: 0,
      speed: 0,
      leanAngle: 0,
      pedalPhase: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
      chaseDistance: 4.8,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 4. HELICOPTER (3D LOFTED MANHATTAN SIGHTSEEING TWIN-TURBINE CHOPPER)
  // =========================================================================
  createHelicopterEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerHelicopter';

    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const heliLoftMat = createLoftedHelicopterMaterial();
    const blurDiscMat = new THREE.MeshBasicNodeMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
    const heliBodyGeo = buildHelicopterBodyGeometry();
    const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
    heliBodyMesh.castShadow = true;
    heliBodyMesh.receiveShadow = true;
    tiltPivot.add(heliBodyMesh);

    // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
    const mainRotorPivot = new THREE.Group();
    mainRotorPivot.position.set(0, 2.66, -0.35);
    const mainRotorGeo = buildHelicopterMainRotorGeometry();
    const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
    mainRotorMesh.castShadow = true;
    mainRotorPivot.add(mainRotorMesh);

    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
    mainRotorPivot.add(blurDisc);
    tiltPivot.add(mainRotorPivot);

    // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
    const tailRotorPivot = new THREE.Group();
    tailRotorPivot.position.set(0.18, 2.02, -5.62);
    const tailRotorGeo = buildHelicopterTailRotorGeometry();
    const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
    tailRotorPivot.add(tailRotorMesh);
    tiltPivot.add(tailRotorPivot);

    // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
    );
    navRed.position.set(-1.09, 1.54, -4.35);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
    );
    navGreen.position.set(1.09, 1.54, -4.35);
    const navTail = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
    );
    navTail.position.set(0, 2.84, -6.04);
    tiltPivot.add(navRed, navGreen, navTail);

    this.scene.add(root);

    return {
      type: 'helicopter',
      label: 'Sightseeing Helicopter',
      mesh: root,
      tiltPivot,
      mainRotorPivot,
      tailRotorPivot,
      position: new THREE.Vector3(-110, 96, SPAWN_Z - 60),
      heading: 0.62,
      speed: 0,
      verticalSpeed: 0,
      pitchAngle: 0,
      rollAngle: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 11.4,
      chaseHeight: 3.3
    };
  }

  // On a raised curb island (city-config.js BLOCKS: the real blocks, malls & plazas), not in a park
  isPointOnSidewalk(x, z) {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6 && !b.median);
  }

  getGroundHeight(x, z, mode = 'person') {
    // Inside Central Park (5th Ave to Central Park West, 59th St to 110th St)
    const cp = CENTRAL_PARK_BOUNDS;
    if (x > cp.minX && x < cp.maxX && z > cp.minZ && z < cp.maxZ) {
      return 1.24;
    }
    // Inside Bryant Park's Great Lawn (west of the New York Public Library, 40th-42nd St)
    const lawn = window.NYC.bryantParkLawn;
    if (lawn && x > lawn.minX && x < lawn.maxX && z > lawn.minZ && z < lawn.maxZ) {
      return lawn.top;
    }
    if (mode === 'person') {
      return this.isPointOnSidewalk(x, z) ? ISLAND_BOUNDS.sidewalkHeight : 0.0;
    }
    return 0.0;
  }

  // The colliders whose bounds come within `r` of (x, z), in their original order. They never move, so they are
  // bucketed once into 48 m cells (tens of thousands of buildings: testing them all every frame cost ~0.5 ms)
  nearColliders(x, z, r) {
    const CELL = 48;
    const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    if (!this._colliderCells) {
      this._colliderCells = new Map();
      this.colliders.forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = this._colliderCells.get(k);
            if (!list) this._colliderCells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp) continue;
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a._order - b._order);
    return out;
  }

  resolveHorizontalCollision(pos, radius, yHeight = 1.0, carEntity = null) {
    // The detailed island (the helicopter may roam out over the harbour & the boroughs)
    const heli = this.activeMode === 'helicopter';
    const m = heli ? 6000 : 0;
    pos.x = Math.max(ISLAND_BOUNDS.minX - m, Math.min(ISLAND_BOUNDS.maxX + m, pos.x));
    pos.z = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + m, pos.z));
    if (this.activeMode !== 'helicopter' && getIslandBoundsAtZ) {
      const shore = getIslandBoundsAtZ(pos.z);
      const minShoreX = shore.westX + 8.0;
      const maxShoreX = shore.eastX - 8.0;
      if (pos.x < minShoreX) {
        pos.x = minShoreX;
        if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      } else if (pos.x > maxShoreX) {
        pos.x = maxShoreX;
        if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      }
    }

    const sinH = carEntity ? Math.sin(carEntity.heading) : 0;
    const cosH = carEntity ? Math.cos(carEntity.heading) : 1;
    const extX = carEntity ? (Math.abs(cosH) * 0.86 + Math.abs(sinH) * 2.18) : radius;
    const extZ = carEntity ? (Math.abs(sinH) * 0.86 + Math.abs(cosH) * 2.18) : radius;

    const reach = Math.max(extX, extZ) + 6;
    let gx = pos.x;
    let gz = pos.z;
    let near = this.nearColliders(gx, gz, reach);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (yHeight > c.maxY + 1.5) continue;

      if (
        pos.x + extX > c.minX &&
        pos.x - extX < c.maxX &&
        pos.z + extZ > c.minZ &&
        pos.z - extZ < c.maxZ
      ) {
        let nx = 0;
        let nz = 0;
        if (c.obb) {
          // Oriented box (buildings along a non-grid street; min/max are its world bounds): push out in its own frame
          const o = c.obb;
          const dx = pos.x - o.cx;
          const dz = pos.z - o.cz;
          const lx = dx * o.cs - dz * o.sn;
          const lz = dx * o.sn + dz * o.cs;
          const ls = sinH * o.cs - cosH * o.sn; // heading in the box's frame
          const lc = sinH * o.sn + cosH * o.cs;
          const ex = carEntity ? (Math.abs(lc) * 0.86 + Math.abs(ls) * 2.18) : radius;
          const ez = carEntity ? (Math.abs(ls) * 0.86 + Math.abs(lc) * 2.18) : radius;
          if (lx + ex <= -o.hx || lx - ex >= o.hx || lz + ez <= -o.hz || lz - ez >= o.hz) continue;
          const oL = lx + ex + o.hx;
          const oR = o.hx - (lx - ex);
          const oT = lz + ez + o.hz;
          const oB = o.hz - (lz - ez);
          const m = Math.min(oL, oR, oT, oB);
          let qx = lx;
          let qz = lz;
          let mx = 0;
          let mz = 0;
          if (m === oL) { qx = -o.hx - ex; mx = -1; }
          else if (m === oR) { qx = o.hx + ex; mx = 1; }
          else if (m === oT) { qz = -o.hz - ez; mz = -1; }
          else { qz = o.hz + ez; mz = 1; }
          pos.x = o.cx + qx * o.cs + qz * o.sn;
          pos.z = o.cz - qx * o.sn + qz * o.cs;
          nx = mx * o.cs + mz * o.sn;
          nz = -mx * o.sn + mz * o.cs;
        } else {
          const overlapLeft = (pos.x + extX) - c.minX;
          const overlapRight = c.maxX - (pos.x - extX);
          const overlapTop = (pos.z + extZ) - c.minZ;
          const overlapBottom = c.maxZ - (pos.z - extZ);

          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft) {
            pos.x = c.minX - extX;
            nx = -1;
          } else if (minOverlap === overlapRight) {
            pos.x = c.maxX + extX;
            nx = 1;
          } else if (minOverlap === overlapTop) {
            pos.z = c.minZ - extZ;
            nz = -1;
          } else {
            pos.z = c.maxZ + extZ;
            nz = 1;
          }
        }

        if (carEntity) {
          const totalVx = sinH * carEntity.speed + (carEntity.vx || 0);
          const totalVz = cosH * carEntity.speed + (carEntity.vz || 0);
          const vn = -(totalVx * nx + totalVz * nz);
          if (vn > 0.5) {
            const headOn = Math.abs(sinH * nx + cosH * nz);
            const sideDot = cosH * nx - sinH * nz;
            carEntity.vx = (carEntity.vx || 0) + nx * vn * 0.42;
            carEntity.vz = (carEntity.vz || 0) + nz * vn * 0.42;
            if (headOn > 0.72) {
              carEntity.speed = -carEntity.speed * 0.25;
            } else {
              carEntity.speed *= (1.0 - 0.62 * headOn);
              carEntity.angularVel = (carEntity.angularVel || 0) + sideDot * (sinH * nx + cosH * nz >= 0 ? -1 : 1) * Math.min(3.2, vn * 0.22);
            }
            carEntity.pitchVel = (carEntity.pitchVel || 0) + (sinH * nx + cosH * nz) * Math.min(14.0, vn) * 0.16;
            carEntity.rollVel = (carEntity.rollVel || 0) - sideDot * Math.min(14.0, vn) * 0.22;
            carEntity.heaveVel = (carEntity.heaveVel || 0) + Math.min(1.4, vn * 0.11);
            if (vn > 2.2) {
              carEntity.lastCollisionSpark = {
                x: pos.x - nx * extX * 0.92,
                y: 0.56,
                z: pos.z - nz * extZ * 0.92,
                nx,
                nz,
                speed: vn
              };
            }
          }
        }

        // A push that carried it far from where the candidates were gathered (dropped inside a building): gather
        // them again around where it is now, carrying on in the same order
        if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
          gx = pos.x;
          gz = pos.z;
          const order = c._order;
          near = this.nearColliders(gx, gz, reach);
          i = -1;
          while (i + 1 < near.length && near[i + 1]._order <= order) i++;
        }
      }
    }
  }

  // Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
  // where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
  // pedals, helmet on its head
  poseCharacters(dt) {
    const p = this.entities.person;
    const air = p.position.y - this.getGroundHeight(p.position.x, p.position.z, 'person');
    p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0);
    p.crowd.begin();
    p.crowd.add(p.rig, 0);
    p.crowd.end();

    const b = this.entities.cyclist;
    b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
    b.riderCrowd.begin();
    b.riderCrowd.add(b.riderRig, 0);
    b.riderCrowd.end();
    b.helmet.quaternion.copy(b.riderRig.headQuaternion);
    b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(b.riderRig.headPosition);
  }

  update(dt, elapsed) {
    const heli = this.entities.helicopter;
    heli.mainRotorPivot.rotation.y += dt * 24.0;
    heli.tailRotorPivot.rotation.x += dt * 32.0;

    if (this.activeMode === 'person') {
      this.updatePerson(dt, elapsed);
    } else {
      // Keep the sidewalk pedestrian walking naturally when not actively controlled
      const p = this.entities.person;
      const walkSpeed = 1.48;
      p.speed = walkSpeed;
      p.position.x += Math.sin(p.heading) * walkSpeed * dt;
      p.position.z += Math.cos(p.heading) * walkSpeed * dt;
      if (p.position.z < -340) p.heading = 0;
      else if (p.position.z > 340) p.heading = Math.PI;
    }

    if (this.activeMode === 'car') {
      this.updateCar(dt, elapsed);
    } else if (this.activeMode === 'cyclist') {
      this.updateCyclist(dt, elapsed);
    } else if (this.activeMode === 'helicopter') {
      this.updateHelicopter(dt, elapsed);
    }

    for (const key of Object.keys(this.entities)) {
      const e = this.entities[key];
      e.mesh.position.copy(e.position);
      e.mesh.rotation.y = e.heading;
    }

    // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
    const car = this.entities.car;
    if (car.headLights) {
      for (const spot of car.headLights) {
        // Accelerating does not change the headlamp output or range.
        spot.intensity = HEADLIGHTS.intensity * beamScale;
      }
    }
    const bike = this.entities.cyclist;
    if (bike.headLight) {
      const bikeActive = this.activeMode === 'cyclist';
      bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
    }

    this.poseCharacters(dt);
  }

  updatePerson(dt) {
    const p = this.entities.person;
    const maxWalk = this.keys.boost ? 8.2 : 4.4;
    const turnRate = 2.6;

    let targetSpeed = 0;
    if (this.keys.forward) targetSpeed = maxWalk * this.keys.forward;
    else if (this.keys.backward) targetSpeed = -maxWalk * 0.65 * this.keys.backward;

    if (this.keys.left) p.heading += turnRate * dt * this.keys.left;
    if (this.keys.right) p.heading -= turnRate * dt * this.keys.right;

    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);

    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += Math.cos(p.heading) * p.speed * dt;
    this.resolveHorizontalCollision(p.position, 0.48, p.position.y + 1.0);

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person');
    if (this.keys.up && p.position.y <= groundY + 0.02) {
      p.verticalVel = 5.2;
    }
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < groundY) {
      p.position.y = groundY;
      p.verticalVel = 0;
    }
  }

  updateCar(dt) {
    const c = this.entities.car;
    const maxSpeed = this.keys.boost ? 36.0 : 23.5;
    const accel = this.keys.boost ? 21.0 : 14.0;

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -this.keys.backward;

    if (throttle !== 0) {
      c.speed += throttle * accel * dt;
      c.speed = Math.max(-maxSpeed * 0.45, Math.min(maxSpeed, c.speed));
    } else {
      c.speed *= Math.max(0, 1 - dt * 2.8);
      if (Math.abs(c.speed) < 0.08) c.speed = 0;
    }

    let steerInput = 0;
    if (this.keys.left) steerInput = this.keys.left;
    if (this.keys.right) steerInput = -this.keys.right;

    c.steerAngle += (steerInput * 0.52 - c.steerAngle) * Math.min(1, dt * 10);

    if (Math.abs(c.speed) > 0.2) {
      const dirSign = c.speed >= 0 ? 1 : -1;
      const speedFactor = Math.min(1.0, Math.abs(c.speed) / 8.0);
      c.heading += c.steerAngle * 2.4 * speedFactor * dirSign * dt;
    }

    // Integrate collision yaw spin & lateral tire slip velocity with asphalt grip damping
    const tireGripDamp = Math.exp(-dt * 6.8);
    c.heading += c.angularVel * dt;
    c.angularVel *= Math.exp(-dt * 7.8);

    const prevX = c.position.x;
    const prevZ = c.position.z;
    c.position.x += (Math.sin(c.heading) * c.speed + c.vx) * dt;
    c.position.z += (Math.cos(c.heading) * c.speed + c.vz) * dt;
    c.vx *= tireGripDamp;
    c.vz *= tireGripDamp;

    this.resolveHorizontalCollision(c.position, 1.35, 1.0, c);
    c.position.y = this.getGroundHeight(c.position.x, c.position.z, 'car');

    // 3-DOF Spring-Damper Chassis Suspension (Pitch, Roll & Vertical Heave)
    const targetPitch = -throttle * 0.026;
    const targetRoll = -c.steerAngle * (c.speed / maxSpeed) * 0.092;
    const springK = 68.0;
    const dampC = 11.2;
    c.pitchVel += ((targetPitch - c.chassisPivot.rotation.x) * springK - c.pitchVel * dampC) * dt;
    c.rollVel += ((targetRoll - c.chassisPivot.rotation.z) * springK - c.rollVel * dampC) * dt;
    c.chassisPivot.rotation.x = Math.max(-0.22, Math.min(0.22, c.chassisPivot.rotation.x + c.pitchVel * dt));
    c.chassisPivot.rotation.z = Math.max(-0.26, Math.min(0.26, c.chassisPivot.rotation.z + c.rollVel * dt));

    c.heaveVel += (-c.heaveY * 85.0 - c.heaveVel * 12.0) * dt;
    c.heaveY = Math.max(-0.08, Math.min(0.14, c.heaveY + c.heaveVel * dt));
    c.chassisPivot.position.y = c.heaveY;

    if (c.carState) {
      c.carState.value.x = throttle < 0 || Math.abs(c.speed) < 0.6 ? 1 : 0;
    }

    const forwardDist = (c.position.x - prevX) * Math.sin(c.heading) + (c.position.z - prevZ) * Math.cos(c.heading);
    const rawWheelStep = forwardDist / 0.35;
    const wheelStep = Math.sign(rawWheelStep) * Math.min(Math.abs(rawWheelStep), 0.48);
    c.wheelSpin = (c.wheelSpin + wheelStep) % (Math.PI * 2);
    for (const w of c.wheels) {
      w.tire.rotation.x = c.wheelSpin + (w.isFront ? 0.0 : 0.55);
      if (w.isFront) {
        w.steerPivot.rotation.y = c.steerAngle;
      }
    }
  }

  updateCyclist(dt) {
    const b = this.entities.cyclist;
    const maxSpeed = this.keys.boost ? 19.0 : 12.8;
    const accel = this.keys.boost ? 13.5 : 9.0;

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -0.6 * this.keys.backward;

    if (throttle !== 0) {
      b.speed += throttle * accel * dt;
      b.speed = Math.max(-4.5, Math.min(maxSpeed, b.speed));
    } else {
      b.speed *= Math.max(0, 1 - dt * 2.4);
      if (Math.abs(b.speed) < 0.05) b.speed = 0;
    }

    let turnInput = 0;
    if (this.keys.left) turnInput = this.keys.left;
    if (this.keys.right) turnInput = -this.keys.right;

    if (Math.abs(b.speed) > 0.15) {
      const dirSign = b.speed >= 0 ? 1 : -1;
      b.heading += turnInput * 2.15 * dirSign * dt;
    }

    b.position.x += Math.sin(b.heading) * b.speed * dt;
    b.position.z += Math.cos(b.heading) * b.speed * dt;
    this.resolveHorizontalCollision(b.position, 0.65, 1.0);
    b.position.y = this.getGroundHeight(b.position.x, b.position.z, 'cyclist');

    const targetLean = -turnInput * Math.min(1.0, Math.abs(b.speed) / 9.0) * 0.34;
    b.leanAngle += (targetLean - b.leanAngle) * Math.min(1, dt * 9);
    b.leanPivot.rotation.z = b.leanAngle;

    const wheelDelta = (b.speed / 0.35) * dt;
    b.frontWheel.rotation.x += wheelDelta;
    b.rearWheel.rotation.x += wheelDelta;

    // The cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
    // freewheel otherwise; the rider's feet follow the pedals (see poseCharacters)
    if (throttle > 0 && wheelDelta > 0) b.pedalPhase += wheelDelta / 3.2;
    b.crankPivot.rotation.x = b.pedalPhase;
    for (const pedal of b.pedals) pedal.rotation.x = -b.pedalPhase;
  }

  updateHelicopter(dt, elapsed) {
    const h = this.entities.helicopter;
    const maxHorizSpeed = this.keys.boost ? 52.0 : 32.0;
    const maxVertSpeed = 16.0;

    let fwdInput = 0;
    if (this.keys.forward) fwdInput = this.keys.forward;
    else if (this.keys.backward) fwdInput = -this.keys.backward;

    let yawInput = 0;
    if (this.keys.left) yawInput = this.keys.left;
    if (this.keys.right) yawInput = -this.keys.right;

    let vertInput = 0;
    if (this.keys.up) vertInput = this.keys.up;
    else if (this.keys.down) vertInput = -this.keys.down;

    if (fwdInput !== 0) {
      h.speed += fwdInput * 24.0 * dt;
      h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
    } else {
      h.speed *= Math.max(0, 1 - dt * 1.8);
    }

    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 22.0 * dt;
      h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }

    h.heading += yawInput * 1.45 * dt;

    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y += h.verticalSpeed * dt;

    h.position.y = Math.max(0.25, Math.min(380, h.position.y));
    this.resolveHorizontalCollision(h.position, 4.5, h.position.y);

    const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
    const targetRoll = -yawInput * 0.28;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
  }
}

Object.assign(window.NYC, { ThirdPersonControllerManager });
})();
