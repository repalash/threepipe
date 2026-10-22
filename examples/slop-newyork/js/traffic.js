(function () {
// js/traffic.js
// Manhattan traffic and pedestrians on the road graph road-network.js derives from the city as built:
// - 200 cars (taxis, sedans, SUVs, NYPD cruisers) and 32 MTA buses keep to their lanes and follow the vehicle
//   ahead (Intelligent Driver Model), change lanes to overtake or to reach a turn lane, turn into other streets,
//   stop for the signals street-details.js shows, give way to oncoming traffic when turning left, to the avenue at
//   unsignalized corners and to pedestrians on crosswalks, and never enter an intersection they can't clear.
// - 340 pedestrians stroll the sidewalks and cross at signalized crosswalks on the WALK signal.
// - Vehicles and pedestrians are only ever moved while out of the camera's view, so nothing pops in or out.
// - The player's vehicle or character pushes and is pushed by the traffic (SAT contact, impulses, sparks).

const { THREE, buildRoadNetwork, signalPhase, walkSignal } = window.NYC;
const {
  cityUniforms,
  createContactShadowMaterial,
  createCarFlareMaterial,
  HEADLIGHTS,
  createVehicleHeadlight,
  placeVehicleHeadlight
} = window.NYC;
const {
  CAR_PARTS,
  BODY_SPECS,
  BUS_SPEC,
  buildCarGeometry,
  buildCarProxyGeometry,
  buildSteerableWheelGeo,
  createLoftedCarMaterial,
  buildLightbarGeometry,
  createLightbarMaterial,
  buildLoftedBusBodyGeometry,
  buildBusSignGeometry,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial
} = window.NYC;
const { PersonCrowd, PersonRig } = window.NYC;
const { mergeGeometries } = window.NYC.Addons;

const NUM_CARS = 200;
const NUM_BUSES = 32;
const NUM_PEDS = 340;

// Intelligent Driver Model: max acceleration, comfortable braking, time headway, standstill gap; and the sideways
// acceleration drivers accept in bends, which sets how fast they take each turn or lane shift
const CAR_DRIVER = { a: 2.0, b: 3.0, T: 1.2, s0: 2.0, aLat: 3.5 };
const BUS_DRIVER = { a: 1.1, b: 2.5, T: 1.5, s0: 2.5, aLat: 2.0 };
const LOOKAHEAD = 70; // metres a driver looks ahead for vehicles, stop lines and signals

// Vehicles further than VEHICLE_RADIUS from the camera and out of its view move to a free lane 100-300 m away,
// also out of view; pedestrians likewise beyond PED_RADIUS, to 60-260 m away. After a teleport, everything
// further than NEAR_RADIUS is placed around the new spot.
const VEHICLE_RADIUS = 380;
const PED_RADIUS = 320;
const NEAR_RADIUS = 350;

function createBusDestinationTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0f14';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#0058b8';
  ctx.fillRect(6, 8, 62, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 26px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M1', 37, 33);
  ctx.fillStyle = '#ff9d1c';
  ctx.font = '800 22px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('5 AV / HARLEM', 78, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function createTrafficSystem(scene, sidewalks, obstacles) {
  const group = new THREE.Group();
  group.name = 'ManhattanTrafficAndPedestrians';

  const dummy = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI * 0.5);
  const contactShadowMat = createContactShadowMaterial();

  // =========================================================================
  // 0. ROAD NETWORK
  // =========================================================================
  const network = buildRoadNetwork(sidewalks, obstacles);
  const { nodes, edges, connector, curvePoint, walkable, onSidewalk } = network;

  // Sides of an intersection (road-network.js step 9): a grid intersection's are 0 east, 1 west, 2 south, 3 north;
  // centreline junctions number their arms from 4. Where lane i of edge e meets a crosswalk, measured along the
  // crosswalk: along its road's lateral axis (x across north-south roads, z across east-west ones)
  const laneCoord = (e, i) => (e.sx + e.rx * e.lanes[i]) * e.clx + (e.sz + e.rz * e.lanes[i]) * e.clz;

  for (const n of nodes) {
    n.box = new Array(n.groupCount).fill(0); // vehicles crossing it from each road (group: on the grid avenue 0, street 1)
    n.crossing = new Array(n.sideCount).fill(0); // vehicles crossing (or about to cross) the crosswalk on each side
    n.approach = new Array(n.sideCount).fill(null); // the edge arriving over each side's crosswalk
    n.road = new Array(n.sideCount).fill(null); // an edge arriving or leaving over each side's crosswalk: the road it spans
    n.walkers = []; // pedestrians on its crosswalks
    n.curb = []; // pedestrians at the curbs of its crosswalks, standing or about to (who to queue behind)
  }
  for (const e of edges) {
    e.occ = e.lanes.map(() => []); // vehicles in each lane, sorted by position
    // e.inSide / e.outSide: the crosswalks crossed on the way into e.to / out of e.from; e.axisIndex: its group at e.to;
    // e.opposite: the oncoming edge of its road there (road-network.js)
    e.to.approach[e.inSide] = e;
    e.to.road[e.inSide] = e.from.road[e.outSide] = e;
    e.through = 0; // vehicles from e crossing e.to straight on or to the right
    e.lefts = 0; // and to the left
    e.mx = e.sx + e.dx * e.len * 0.5;
    e.mz = e.sz + e.dz * e.len * 0.5;
  }
  // Is the intersection box held by vehicles of any road but group g's?
  const boxBusy = (n, g) => {
    for (let k = 0; k < n.box.length; k++) if (k !== g && n.box[k] > 0) return true;
    return false;
  };

  // =========================================================================
  // 1. 3D LOFTED NYC YELLOW TAXIS, SEDANS, SUVS & NYPD CRUISERS (200 VEHICLES)
  // =========================================================================
  function createVehicle(bus, half, halfWidth, axle, driver, v0) {
    return {
      bus, half, halfWidth, axle, driver, v0,
      edge: null, lane: 0, s: 0, speed: 0, acc: 0, gap: Infinity, leaderSpeed: 0,
      move: null, out: 0, conn: null, cs: 0, trail: null, commit: null, claimed: false, yielding: false, yieldAt: 0,
      wait: 0, laneTimer: Math.random() * 0.5,
      dl: 0, dlv: 0, blink: 0, blinkPhase: Math.random() * 0.8,
      x: 0, z: 0, prevX: 0, prevZ: 0, tx: 0, tz: 1, nose: 0, yaw: 0, yawRate: 0, steer: 0,
      pitch: 0, roll: 0, pitchVel: 0, rollVel: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0,
      pAhead: Infinity, pRight: 0, pSpeed: 0, wheelSpin: Math.random() * Math.PI * 2
    };
  }

  // Build 3 distinct 3D LoftGeometry vehicle classes (Taxi, Sedan/NYPD, SUV) with separate spinning 3D wheels
  const taxiGeo = buildCarGeometry(BODY_SPECS.taxi, false);
  const sedanGeo = buildCarGeometry(BODY_SPECS.sedan, false);
  const suvGeo = buildCarGeometry(BODY_SPECS.suv, false);
  const carWheelLeftGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, -1);
  const carWheelRightGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, 1);

  const taxiMat = createLoftedCarMaterial(BODY_SPECS.taxi);
  const sedanMat = createLoftedCarMaterial(BODY_SPECS.sedan);
  const suvMat = createLoftedCarMaterial(BODY_SPECS.suv);
  const carWheelMat = createLoftedCarMaterial(BODY_SPECS.sedan, 0xffbe14);

  const taxiYellow = new THREE.Color(0xffbe14);
  const nypdWhite = new THREE.Color(0xf6f9fc);
  const sedanPalette = [
    new THREE.Color(0x1c2026), // Black Town Car / Uber
    new THREE.Color(0xcfd6de), // Metallic Silver Sedan
    new THREE.Color(0x1d3b6c), // Deep Navy Sedan
    new THREE.Color(0x52575e), // Graphite Grey Sedan
    new THREE.Color(0x6e1f24)  // Burgundy Sedan
  ];
  const suvPalette = [
    new THREE.Color(0x16191e), // Executive Black Escalade/Suburban
    new THREE.Color(0xf0f3f7), // Pearl White SUV
    new THREE.Color(0x3a434d), // Slate Metallic SUV
    new THREE.Color(0x28382e), // Forest Green SUV
    new THREE.Color(0xbec6cf)  // Silver SUV
  ];

  const cars = [];
  let taxiCount = 0;
  let sedanCount = 0;
  let suvCount = 0;
  let nypdCount = 0;

  for (let i = 0; i < NUM_CARS; i++) {
    const isNYPD = (i % 10) === 6;
    const isTaxi = !isNYPD && (i % 7) < 4;
    const isSUV = !isNYPD && !isTaxi && (i % 2 === 0);

    let bodyType = 'sedan';
    let col;

    if (isTaxi) {
      bodyType = 'taxi';
      taxiCount++;
      col = taxiYellow;
    } else if (isSUV) {
      bodyType = 'suv';
      suvCount++;
      col = suvPalette[i % suvPalette.length];
    } else {
      sedanCount++;
      col = isNYPD ? nypdWhite : sedanPalette[i % sedanPalette.length];
      if (isNYPD) nypdCount++;
    }

    const car = createVehicle(false, isSUV ? 2.3 : 2.25, isSUV ? 0.92 : 0.86, isSUV ? 1.4 : 1.38, CAR_DRIVER, 10 + (i % 5) * 0.9);
    // paint as float32 values, so renderCar() can tell whether an instance slot's paint changes by comparing
    const paint = [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)];
    Object.assign(car, { isTaxi, isNYPD, isSUV, bodyType, paint });
    cars.push(car);
  }

  // Per body type: the full model (with separately instanced spinning wheels near the camera) and, beyond
  // CAR_PROXY_DISTANCE, the ~250-triangle stand-in. Instance slots are handed out every frame to the cars the camera
  // can see (or whose shadow it may see), see renderCar(). Per-instance paint & lamp / livery state the car material
  // reads: brake lights, left (+x) & right (-x) turn signals, livery (1 = NYPD).
  const bodies = {};
  for (const [kind, geo, count, mat] of [['taxi', taxiGeo, taxiCount, taxiMat], ['sedan', sedanGeo, sedanCount, sedanMat], ['suv', suvGeo, suvCount, suvMat]]) {
    const n = Math.max(1, count);
    const lodMesh = (g) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      return new THREE.InstancedMesh(g, mat, n);
    };
    bodies[kind] = { near: lodMesh(geo), far: lodMesh(buildCarProxyGeometry(BODY_SPECS[kind])) };
  }
  const bodyMeshes = Object.values(bodies).flatMap((b) => [b.near, b.far]);

  const carWheelLeftInst = new THREE.InstancedMesh(carWheelLeftGeo, carWheelMat, NUM_CARS * 2);
  const carWheelRightInst = new THREE.InstancedMesh(carWheelRightGeo, carWheelMat, NUM_CARS * 2);

  // 3D Collision Spark & Debris Particle Pool
  const MAX_SPARKS = 120;
  const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.26);
  const sparkMat = new THREE.MeshBasicNodeMaterial({ color: 0xffc438 });
  const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
  const sparks = [];
  let sparkCursor = 0;
  for (let s = 0; s < MAX_SPARKS; s++) {
    sparks.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.4 });
  }
  function spawnCollisionSparks(x, y, z, nx, nz, impactSpeed) {
    const count = Math.min(24, Math.max(8, Math.floor(impactSpeed * 1.4)));
    const tx = -nz;
    const tz = nx;
    for (let k = 0; k < count; k++) {
      const sp = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
      const spread = (Math.random() - 0.5) * 2.2;
      const outBoost = (0.3 + Math.random() * 0.9) * Math.min(14.0, impactSpeed * 0.65);
      const tanBoost = spread * Math.min(12.0, impactSpeed * 0.55);
      sp.x = x + (Math.random() - 0.5) * 0.35;
      sp.y = y + (Math.random() - 0.5) * 0.18;
      sp.z = z + (Math.random() - 0.5) * 0.35;
      sp.vx = nx * outBoost + tx * tanBoost;
      sp.vy = 2.4 + Math.random() * 5.4;
      sp.vz = nz * outBoost + tz * tanBoost;
      sp.maxLife = 0.28 + Math.random() * 0.24;
      sp.life = sp.maxLife;
    }
  }

  // NYPD roof light bars (the blue & white livery is painted by the sedan material from the instance's carState)
  const nypdBarInst = new THREE.InstancedMesh(buildLightbarGeometry(BODY_SPECS.sedan), createLightbarMaterial(), Math.max(1, nypdCount));
  const carShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_CARS);
  carShadowInst.renderOrder = 998;

  for (const m of bodyMeshes) m.castShadow = m.receiveShadow = true;
  nypdBarInst.castShadow = true;
  carWheelLeftInst.castShadow = carWheelLeftInst.receiveShadow = true;
  carWheelRightInst.castShadow = carWheelRightInst.receiveShadow = true;

  group.add(
    ...bodyMeshes,
    carWheelLeftInst,
    carWheelRightInst,
    sparkInst,
    nypdBarInst
  );

  // =========================================================================
  // 2. LOFTED MTA SELECT BUS SERVICE BLUE & WHITE CITY BUSES (32 BUSES)
  // =========================================================================
  const busBodyGeo = buildLoftedBusBodyGeometry();
  // Per-instance lamp state the bus material reads: brake lights, left (+x) & right (-x) turn signals (renderBus)
  const busStates = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES * 4), 4);
  busBodyGeo.setAttribute('busState', busStates);
  // Destination signs above the windshield, by the front door & above the rear window
  const busHeaderGeo = buildBusSignGeometry();

  const busBodyMat = createLoftedBusMaterial();
  const busDestMat = new THREE.MeshBasicNodeMaterial({
    map: createBusDestinationTexture()
  });

  const busWheelMat = createBusWheelMaterial();
  const busBodyInst = new THREE.InstancedMesh(busBodyGeo, busBodyMat, NUM_BUSES);
  const busHeaderInst = new THREE.InstancedMesh(busHeaderGeo, busDestMat, NUM_BUSES);
  const busWheelLeftInst = new THREE.InstancedMesh(buildBusWheelGeo(-1), busWheelMat, NUM_BUSES * 2);
  const busWheelRightInst = new THREE.InstancedMesh(buildBusWheelGeo(1), busWheelMat, NUM_BUSES * 2);
  const busShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_BUSES);
  busShadowInst.renderOrder = 998;

  busBodyInst.castShadow = busBodyInst.receiveShadow = true;
  busWheelLeftInst.castShadow = busWheelLeftInst.receiveShadow = true;
  busWheelRightInst.castShadow = busWheelRightInst.receiveShadow = true;

  const buses = [];
  for (let i = 0; i < NUM_BUSES; i++) buses.push(createVehicle(true, 6.0, 1.3, 3.6, BUS_DRIVER, 8 + (i % 3)));
  const vehicles = [...cars, ...buses];
  group.add(busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst);

  // =========================================================================
  // 3. SKINNED, PROCEDURALLY ANIMATED SIDEWALK PEDESTRIANS (340 PEDESTRIANS, see pedestrians.js)
  // =========================================================================
  // One instanced draw per level of detail; every pedestrian has a PersonRig that plants its footsteps on the
  // sidewalk (no sliding), with their own build, height, sex, hair, clothes and gait
  const pedCrowd = new PersonCrowd(NUM_PEDS);
  const hash = (i, salt) => {
    const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const peds = [];
  for (let i = 0; i < NUM_PEDS; i++) {
    const female = hash(i, 1) < 0.48;
    const hairRoll = hash(i, 2);
    peds.push({
      placed: false,
      crossesStreets: i % 6 === 0, // walks back and forth over a signalized crosswalk
      x: 0,
      z: 0,
      ax: 0, // track: start, direction, length; position along it and walking direction
      az: 0,
      ux: 0,
      uz: 1,
      len: 1,
      t: 0,
      dir: 1,
      node: null, // the intersection of its crosswalk, which side of it, where along it
      side: 0,
      coord: 0,
      line: 0, // its line over the crosswalk, off the centre line
      waiting: false,
      speed: 1.22 + (i % 5) * 0.1 + hash(i, 3) * 0.08, // preferred walking speed
      v: 0, // current speed, easing up to it and down to stops
      pause: 0, // turning round at the end of the track
      rig: new PersonRig({
        seed: i * 1.6180339 + 0.13,
        female,
        scale: (female ? 0.91 : 0.97) + hash(i, 4) * 0.1,
        girth: 0.9 + hash(i, 5) * 0.24,
        hair: female ? (hairRoll < 0.68 ? 1 : 0.3 + hairRoll * 0.25) : hairRoll < 0.08 ? 1 : hairRoll * 0.35,
        armSwing: 0.75 + hash(i, 6) * 0.5,
        stride: 0.94 + hash(i, 7) * 0.12
      })
    });
  }
  group.add(...pedCrowd.meshes);

  // Add vehicle contact shadows last + pre-allocated Clustered SpotLight / PointLight pools
  group.add(carShadowInst, busShadowInst);

  const HEADLIGHT_POOL_SIZE = 4; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const NYPD_LIGHT_POOL_SIZE = 2; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const MAX_LIGHT_DIST = 115;
  const MAX_LIGHT_DIST_SQ = MAX_LIGHT_DIST * MAX_LIGHT_DIST;
  const DUAL_BEAM_DIST_SQ = 96 * 96;
  const DUAL_BEAM_MAX_VEHICLES = 44;

  const trafficLightsGroup = new THREE.Group();
  trafficLightsGroup.name = 'TrafficClusteredLights';
  group.add(trafficLightsGroup);

  const headlightPool = [];
  for (let i = 0; i < HEADLIGHT_POOL_SIZE; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    trafficLightsGroup.add(spot, spot.target);
    headlightPool.push(spot);
  }

  const nypdLightPool = [];
  for (let i = 0; i < NYPD_LIGHT_POOL_SIZE; i++) {
    const pt = new THREE.PointLight(0xff1828, 0, 12.0, 1.25);
    pt.position.set(0, -1000, 0);
    trafficLightsGroup.add(pt);
    nypdLightPool.push(pt);
  }

  // Nothing shows until it has been placed
  const carInstances = [...bodyMeshes, carWheelLeftInst, carWheelRightInst, nypdBarInst, carShadowInst];
  const busInstances = [busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst];
  for (const inst of [...carInstances, ...busInstances, sparkInst]) {
    inst.frustumCulled = false;
    for (let i = 0; i < inst.count; i++) inst.setMatrixAt(i, zero);
  }

  scene.add(group);

  // =========================================================================
  // 4. WHO IS WHERE: LANE OCCUPANCY, INTERSECTIONS, VIEW, PLAYER
  // =========================================================================
  let clock = 0;
  let avePhase = 'green';
  let stPhase = 'red';
  let aveWalk = true;
  let stWalk = false;
  const phaseOf = (e) => (e.axisIndex === 0 ? avePhase : stPhase);
  let focusX = 0;
  let focusZ = 140;
  const player = { active: false, entity: null, x: 0, z: 0, vx: 0, vz: 0, halfW: 0.86, halfL: 2.18, push: 0.5 };

  // Lane lists hold pooled { v, s } entries sorted by position s along the lane, rebuilt every frame
  const pool = [];
  let poolUsed = 0;
  const filled = [];
  function occupy(list, v, s) {
    let o = pool[poolUsed++];
    if (!o) pool.push((o = { v: null, s: 0 }));
    o.v = v;
    o.s = s;
    if (!list.length) filled.push(list);
    list.push(o);
    for (let k = list.length - 1; k > 0 && list[k - 1].s > s; k--) {
      list[k] = list[k - 1];
      list[k - 1] = o;
    }
  }

  // Half way through a lane change a vehicle still occupies the lane it is leaving (-1 left, 1 right)
  function straddle(v) {
    if (v.conn) return 0;
    if (v.dl > 0.5 && v.lane + 1 < v.edge.lanes.length) return 1;
    if (v.dl < -0.5 && v.lane > 0) return -1;
    return 0;
  }

  // A vehicle crossing an intersection, or committed to crossing it, holds it against crossing traffic and
  // pedestrians on the crosswalks it passes, and its place in the lane it heads for. The counters it raises are reset
  // next frame for just the nodes and edges touched (a few hundred out of thousands)
  const touchedNodes = [];
  const touchedEdges = [];
  const touchNode = (n) => {
    if (!n.touched) {
      n.touched = true;
      touchedNodes.push(n);
    }
    return n;
  };
  const touchEdge = (e) => {
    if (!e.touched) {
      e.touched = true;
      touchedEdges.push(e);
    }
    return e;
  };
  function claim(v) {
    if (v.claimed) return;
    v.claimed = true;
    const e = v.edge;
    const f = v.move.to;
    touchNode(e.to).box[e.axisIndex]++;
    if (!v.conn || v.cs < v.half + 2.5) e.to.crossing[e.inSide]++; // until its tail is past the crosswalk on its way in
    if (v.move.turn !== 'L') touchEdge(e).through++;
    if (!v.yielding) cross(v);
    occupy(f.occ[v.out], v, v.conn ? v.cs - v.conn.len : v.s - e.len - connector(e, v.lane, f, v.out).len);
  }

  // ...and, unless still waiting inside to turn left, the oncoming lanes and the crosswalk on its way out
  function cross(v) {
    const e = v.edge;
    if (v.move.turn === 'L') touchEdge(e).lefts++;
    touchNode(e.to).crossing[v.move.to.outSide]++;
    v.yielding = false;
  }

  function buildOccupancy() {
    for (const list of filled) list.length = 0;
    filled.length = 0;
    poolUsed = 0;
    for (const n of touchedNodes) {
      n.box.fill(0);
      n.crossing.fill(0);
      n.touched = false;
    }
    touchedNodes.length = 0;
    for (const e of touchedEdges) {
      e.through = e.lefts = 0;
      e.touched = false;
    }
    touchedEdges.length = 0;
    for (const v of vehicles) v.claimed = false;
    for (const v of vehicles) {
      const e = v.edge;
      if (!e) continue;
      if (!v.conn) {
        occupy(e.occ[v.lane], v, v.s);
        const side = straddle(v);
        if (side) occupy(e.occ[v.lane + side], v, v.s);
        if (v.commit === e.to) claim(v);
        if (v.s < v.half) touchNode(e.from).crossing[e.outSide]++; // its tail still over the crosswalk behind it
      } else {
        claim(v);
        occupy(e.occ[v.lane], v, e.len + v.cs); // until it is out of the intersection, still ahead of those behind it
      }
    }
  }

  // The camera's view, to move things only where it can't see
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  let hasView = false;
  let camX = 0;
  let camY = 10;
  let camZ = 140;
  let camFwdX = 0;
  let camFwdZ = 1;
  function updateView(camera) {
    hasView = !!camera;
    if (!camera) return;
    camera.updateMatrixWorld();
    camX = camera.position.x;
    camY = camera.position.y;
    camZ = camera.position.z;
    const me = camera.matrixWorld.elements;
    camFwdX = -me[8];
    camFwdZ = -me[10];
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
  }
  // Could the camera see a sphere of radius r around ground point (x, z)? Side planes only: the near and far
  // planes depend on depth conventions, and the side planes alone already rule out everything behind the camera.
  function visible(x, z, r) {
    if (!hasView) return false;
    for (let k = 0; k < 4; k++) {
      const { normal, constant } = frustum.planes[k];
      if (normal.x * x + normal.y + normal.z * z + constant < -r) return false;
    }
    return true;
  }

  // Edges and signalized intersections around the focus, to place vehicles and pedestrians on
  const nearEdges = [];
  const nearSignals = [];
  let nearX = Infinity;
  let nearZ = Infinity;
  function refreshNear() {
    if (Math.hypot(focusX - nearX, focusZ - nearZ) < 40) return;
    nearX = focusX;
    nearZ = focusZ;
    nearEdges.length = 0;
    nearSignals.length = 0;
    for (const e of edges) if (Math.hypot(e.mx - focusX, e.mz - focusZ) < NEAR_RADIUS) nearEdges.push(e);
    for (const n of nodes) if (n.signal && Math.hypot(n.x - focusX, n.z - focusZ) < NEAR_RADIUS) nearSignals.push(n);
  }

  // Where the player is relative to v: metres ahead, metres to the right, and how fast it moves v's way
  function relateToPlayer(v) {
    v.pAhead = Infinity;
    if (!player.active) return;
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    if (Math.abs(dx) > LOOKAHEAD + 10 || Math.abs(dz) > LOOKAHEAD + 10) return;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    v.pAhead = dx * fx + dz * fz;
    v.pRight = dz * fx - dx * fz;
    v.pSpeed = Math.max(0, player.vx * fx + player.vz * fz);
  }

  // Gap to the player if it is ahead in the lane whose centre is `off` metres to the right of v
  function playerGap(v, off) {
    if (v.pAhead < 0 || v.pAhead > LOOKAHEAD) return Infinity;
    if (Math.abs(v.pRight - off) > v.halfWidth + player.halfW + 0.4) return Infinity;
    return v.pAhead - v.half - player.halfL;
  }

  // =========================================================================
  // 5. DRIVING
  // =========================================================================
  // The lane nearest to `lane` that move m can be made from (m.out[i] is the lane lane i leads to, or -1)
  function nearestLane(m, lane) {
    let best = -1;
    for (let i = 0; i < m.out.length; i++) {
      if (m.out[i] >= 0 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
    }
    return best;
  }

  // First vehicle ahead of position s in a lane list
  function ahead(list, s, v) {
    for (const o of list) if (o.s > s && o.v !== v) return o;
    return null;
  }

  // The front-most vehicle still approaching the end of a lane: not crossing at its end yet, though maybe still coming
  // out of the intersection at its start (at s < 0)
  function leadOf(list) {
    for (let k = list.length - 1; k >= 0; k--) if (!list[k].v.conn || list[k].s < 0) return list[k];
    return null;
  }

  // Intelligent Driver Model: acceleration on a free road, and the braking term for an obstacle `gap` metres
  // (bumper to bumper) ahead moving at `speed`
  const freeAcc = (v) => v.driver.a * (1 - (v.speed / v.v0) ** 4);
  function brake(v, gap, speed, s0 = v.driver.s0, T = v.driver.T) {
    const { a, b } = v.driver;
    const desired = s0 + Math.max(0, v.speed * T + (v.speed * (v.speed - speed)) / (2 * Math.sqrt(a * b)));
    return -a * (desired / Math.max(gap, 0.1)) ** 2;
  }
  // ...and for a line d metres ahead to stop s0 short of: no time gap to keep to a line
  const stopAt = (v, d, s0 = 1) => brake(v, d, 0, s0, 0);

  // Braking for the vehicle ahead of position s in a lane list; remembers the nearest one
  function follow(v, list, s) {
    const o = ahead(list, s, v);
    if (!o) return 0;
    const gap = o.s - o.v.half - s - v.half;
    if (gap > LOOKAHEAD) return 0;
    if (gap < v.gap) {
      v.gap = gap;
      v.leaderSpeed = o.v.speed;
    }
    return brake(v, gap, o.v.speed);
  }

  // Can v, d metres before a line, still stop at it braking no harder than its driver comfortably does?
  const canStopBefore = (v, d) => freeAcc(v) + stopAt(v, d) > -v.driver.b;

  // Braking for a red (or an amber with room to stop) at the end of edge f, `d` metres ahead
  function signalAhead(v, f, d) {
    if (!f.to.signal || d > LOOKAHEAD) return 0;
    const phase = phaseOf(f);
    if (phase === 'green' || (phase === 'amber' && !canStopBefore(v, d))) return 0;
    return stopAt(v, d);
  }

  // Where to go at the end of the current edge: mostly straight on, sometimes a turn (buses keep to wide roads),
  // drifting towards the camera when far from it. With `fromLane`, only moves the current lane allows.
  const weights = [];
  function chooseMove(v, fromLane) {
    const e = v.edge;
    const toFocus = Math.hypot(focusX - v.x, focusZ - v.z) > 250;
    let total = 0;
    for (let k = 0; k < e.moves.length; k++) {
      const m = e.moves[k];
      let w = m.turn === 'S' ? (v.bus ? 8 : 3) : 1;
      if (v.bus && m.turn !== 'S' && m.to.lanes.length < 2) w *= 0.05;
      if (fromLane) {
        if (m.out[v.lane] < 0) w = 0;
      } else if (Math.abs(nearestLane(m, v.lane) - v.lane) * 22 > e.len - v.s) {
        w *= 0.02; // too little road left to change lanes for it
      }
      if (toFocus && m.to.dx * (focusX - v.x) + m.to.dz * (focusZ - v.z) > 0) w *= 3;
      weights[k] = w;
      total += w;
    }
    let r = Math.random() * total;
    let pick = null;
    for (let k = 0; k < e.moves.length; k++) {
      if (weights[k] <= 0) continue;
      pick = e.moves[k];
      r -= weights[k];
      if (r < 0) break;
    }
    // No move from this lane (a lane the road graph couldn't lead anywhere): take any move, changing lanes for it
    if (!pick && fromLane) return chooseMove(v, false);
    return pick || e.moves[0] || null;
  }

  // Could the vehicle of lane entry o, approaching the end of edge a, still stop easily before its line? Vehicles
  // already standing can; drivers who have been waiting a while accept any gap it can still stop for comfortably.
  function canStop(o, a, impatient) {
    const sp = o.v.speed;
    if (sp < 0.5) return true;
    const d = a.len - o.s - o.v.half;
    return impatient ? canStopBefore(o.v, d) : d > (sp * sp) / 5 + sp + 3;
  }

  // A left turn waits for oncoming traffic going straight or right (approach o); vehicles not on o yet haven't picked
  // their way on, and at a red, only those already committed to crossing still come. Waiting to turn at the line, v
  // also takes turns with those waiting at theirs: whoever has waited longer goes first, if it has room to go.
  function yieldOncoming(o, impatient, v = null) {
    if (!o) return false;
    if (o.through > 0) return true;
    if (o.to.signal && phaseOf(o) === 'red') return false;
    for (const list of o.occ) {
      const lead = leadOf(list);
      if (!lead || (lead.v.edge === o && lead.v.move.turn === 'L')) continue;
      if (!canStop(lead, o, impatient)) return true;
      const u = lead.v;
      const j = u.edge === o ? u.move.out[u.lane] : -1;
      if (v && v.wait > 0 && u.wait > v.wait && j >= 0 && o.len - lead.s - u.half < 2 && room(u.move.to, j, u)) return true;
    }
    return false;
  }

  // How far along curve c, out of two-way edge e, v can pull forward before its front corner reaches the
  // oncoming lanes (left of the centre line): where it waits for a gap to turn left
  const corner = { x: 0, z: 0, dx: 0, dz: 1 };
  function yieldPoint(v, c, e) {
    let cs = 0;
    for (; cs < c.len; cs += 0.5) {
      curvePoint(c, cs + v.half, corner);
      const x = corner.x + corner.dz * v.halfWidth;
      const z = corner.z - corner.dx * v.halfWidth;
      if ((x - e.x0) * e.rx + (z - e.z0) * e.rz < 0.3) break;
    }
    return cs - 0.5;
  }

  // At corners without signals, every other road gives way to group 0 (the avenue on the grid, the widest road at a
  // centreline junction)
  function yieldToAvenue(v, n) {
    for (const a of n.in) {
      if (a.axisIndex !== 0) continue;
      for (const list of a.occ) {
        const lead = leadOf(list);
        if (lead && !canStop(lead, a, v.wait > 8)) return true;
      }
    }
    return false;
  }

  // Seconds v takes to cover dist metres from now, speeding up from rest if it has to
  const timeTo = (v, dist) => dist / Math.max(v.speed, Math.sqrt((v.driver.a * dist) / 2), 0.1);

  // Will anyone on crosswalk `side` of n be within reach of the lane meeting it at `coord` between t0 and t1
  // seconds from now? Unless `onIt`, so is anyone waiting at the curb to step off, however far away: on the WALK, they
  // only wait for the vehicles already holding the crosswalk.
  function pedestrianOn(n, side, coord, t0, t1, onIt = false) {
    for (const p of n.walkers) {
      if (p.side !== side || (onIt && p.waiting)) continue;
      const toGo = (coord - p.coord) * p.dir; // metres p still has to walk to get there
      if (p.waiting || ((toGo + 2.6) / p.speed > t0 && (toGo - 2.6) / p.speed < t1)) return true;
    }
    return false;
  }

  // ...on the crosswalk v leaves the intersection over, while v, its front bumper d metres before it, passes? Once v
  // holds that crosswalk (it isn't waiting inside to turn), people at the curb wait for it.
  const pedsOut = (v, d) => d > 0 && pedestrianOn(v.edge.to, v.move.to.outSide, laneCoord(v.move.to, v.out), timeTo(v, d), timeTo(v, d + 3 + 2 * v.half), !v.yielding);

  // Must v, pulled into the intersection to turn, wait there: for people crossing its way out (`peds`) or, turning
  // left, for oncoming traffic?
  const holdsOn = (v, peds) => peds || (v.move.turn === 'L' && yieldOncoming(v.edge.opposite, false));

  // Of two vehicles on the same road headed for the same lane, the one whose front is nearer the line goes first (by
  // the front: a bus waiting at the line goes before the cars that pull up beside it)
  const precedence = (u, s) => s + u.half;

  // Would there be room for v in lane j of edge f if everyone headed there queued bumper to bumper behind its far
  // stop line? (An empty lane always has room, however short.) Vehicles take turns for it: whoever has waited longer
  // to go there from another side, or goes first from v's own road, counts as already in.
  function room(f, j, v) {
    let free = f.len - 1;
    for (const o of f.occ[j]) if (o.v !== v && o.s - o.v.half < f.len) free -= 2 * o.v.half + o.v.driver.s0;
    for (const a of f.from.in) {
      for (const list of a.occ) {
        const o = leadOf(list);
        if (!o || o.v.claimed || !o.v.move || o.v.move.to !== f || o.v.move.out[o.v.lane] !== j) continue;
        if (a === v.edge ? precedence(o.v, o.s) > precedence(v, v.s) : o.v.wait > v.wait) free -= 2 * o.v.half + o.v.driver.s0;
      }
    }
    return free >= Math.min(2 * v.half + 0.5, f.len - 1);
  }

  // Would v, crossing into lane j of f to arrive at position vs, come alongside another vehicle headed there, cut in
  // ahead of one closing in on it, or close in on one ahead in a lane beside (which it doesn't follow)? Turning buses
  // swing wide, so where a bus turns, the lanes either side count too, and for one turning beside v from v's road, so
  // does how far apart they start turning (the outer one has further to go: side by side on f may be one behind the
  // other at the line, and the other way round).
  function alongside(f, j, v, vs, turn) {
    for (let k = Math.max(0, j - 1); k <= Math.min(f.lanes.length - 1, j + 1); k++) {
      for (const o of f.occ[k]) {
        const swing = turn && (v.bus || o.v.bus);
        if (o.v === v || (k !== j && !swing)) continue;
        let lo = o.s - vs; // how far ahead of v o is
        let hi = lo;
        if (swing && o.v.edge === v.edge) {
          const atLine = (o.v.conn ? v.edge.len + o.v.cs : o.v.s) - v.s;
          lo = Math.min(lo, atLine);
          hi = Math.max(hi, atLine);
        }
        const closing = hi < 0 ? o.v.speed - v.speed : lo > 0 && k !== j ? v.speed - o.v.speed : 0;
        const w = o.v.half + v.half + 1 + 2 * Math.max(0, closing);
        if (lo < w && hi > -w) return true;
      }
    }
    return false;
  }

  // Is a bus at the line in the lane on the outside of v's turn? A bus starting to turn swings its tail out over it.
  function besideTail(v) {
    const e = v.edge;
    const k = v.lane + (v.move.turn === 'R' ? -1 : 1);
    const o = v.move.turn !== 'S' && k >= 0 && k < e.lanes.length ? leadOf(e.occ[k]) : null;
    return !!o && o.v.bus && o.v !== v && e.len - o.s - o.v.half < 2;
  }

  // The lead of another of v's lanes that goes first into lane j of f or, turning where a bus is involved, into a lane
  // beside it (turning buses swing wide): v falls in behind it. As an entry { v, s } of f's lane: where it would be on
  // f now.
  const merger = { v: null, s: 0 };
  function mergingAhead(v, f, j) {
    const e = v.edge;
    merger.v = null;
    for (let i = 0; i < e.lanes.length; i++) {
      const o = i === v.lane ? null : leadOf(e.occ[i]);
      if (!o || o.v === v || o.v.claimed || o.v.move.to !== f || precedence(o.v, o.s) <= precedence(v, v.s)) continue;
      if (o.v.bus && besideTail(o.v)) continue; // it waits for the bus beside its tail
      const oj = o.v.move.out[o.v.lane];
      if (oj < 0 || (oj !== j && !(Math.abs(oj - j) === 1 && v.move.turn !== 'S' && (v.bus || o.v.bus)))) continue;
      const s = o.s - e.len - connector(e, o.v.lane, f, oj).len;
      if (!merger.v || s < merger.s) {
        merger.v = o.v;
        merger.s = s;
      }
    }
    return merger.v ? merger : null;
  }

  // May v, its front bumper d metres before the stop line, enter the intersection now? Sets the exit lane.
  // Once too close to stop, v is committed: it goes, and holds the intersection from then on.
  function mayEnter(v, d) {
    const e = v.edge;
    const n = e.to;
    const phase = n.signal ? phaseOf(e) : 'green';
    // Could it still stop? For a light that isn't green, also by crawling up to it, closer than it stops for lines
    const stoppable = canStopBefore(v, d) || (phase !== 'green' && v.speed * v.speed < 2 * v.driver.b * d);
    if (stoppable) v.commit = null; // could stop after all: decide afresh
    if (v.commit === n) return true;
    if (v.move.out[v.lane] < 0) {
      // missed the lane for the planned move: go wherever this lane goes instead
      if (d > 12) return false;
      v.move = chooseMove(v, true);
    }
    const m = v.move;
    const f = m.to;
    const j = m.out[v.lane];
    if (!(j >= 0 && j < f.lanes.length)) {
      if (!mayEnter.warned) {
        mayEnter.warned = true;
        console.warn('[traffic] lane leads nowhere', { lane: v.lane, lanes: e.lanes.length, out: m.out.slice(), moves: e.moves.length, x: Math.round(v.x), z: Math.round(v.z) });
      }
      return false;
    }
    if (phase === 'red' || (phase === 'amber' && stoppable)) return false;
    if (boxBusy(n, e.axisIndex)) return false; // crossing traffic inside
    const lead = ahead(e.occ[v.lane], v.s, v);
    if (lead && lead.v.yielding) return false; // the vehicle ahead waits inside to turn: wait behind the line
    if (v.bus && besideTail(v)) return false; // its tail would swing out over that bus as it starts to turn
    // At a signal, the first in line to turn pulls into the intersection to wait there for the people crossing the
    // road it turns into (they walk on the same green): short of their crosswalk or, turning left across oncoming
    // traffic, short of the oncoming lanes until there is a gap. The light changing stops both for it at the latest.
    const c = connector(e, v.lane, f, j);
    const first = n.signal && m.turn !== 'S' && !lead;
    const across = m.turn === 'L' && !!e.opposite;
    const wait = first ? (across ? yieldPoint(v, c, e) : c.len - 3 - v.half) : -1; // < 0: no room inside to wait
    if (m.turn === 'L' ? across && wait < 0 && yieldOncoming(e.opposite, v.wait > 8, v) : e.opposite && e.opposite.lefts > 0) return false;
    if (!n.signal && e.axisIndex !== 0 && yieldToAvenue(v, n)) return false;
    // nobody on the crosswalks while it passes over them, on the way in and on the way out, and a free place to
    // clear the intersection to, taking turns with lanes merging into it
    if (pedestrianOn(n, e.inSide, laneCoord(e, v.lane), 0, timeTo(v, d + 2.5 + 2 * v.half))) return false;
    if (wait < 0 && pedestrianOn(n, f.outSide, laneCoord(f, j), timeTo(v, d + c.len - 3), timeTo(v, d + c.len + 2 * v.half))) return false;
    const vs = v.s - e.len - c.len; // where on f it would be now
    if (!room(f, j, v) || alongside(f, j, v, vs, m.turn !== 'S') || mergingAhead(v, f, j)) return false;
    v.out = j;
    v.yielding = wait >= 0;
    v.yieldAt = wait;
    if (!stoppable) {
      v.commit = n;
      claim(v); // at once, so vehicles and pedestrians deciding later this frame know
    }
    return true;
  }

  // Overtake into an adjacent lane when it is clearly quicker (MOBIL), or work towards a lane the planned turn
  // can be made from; either only if neither v nor its new follower has to brake hard for it. Not while still
  // pulling out of an intersection, nor in the last 12 m before the next.
  function changeLanes(v) {
    const e = v.edge;
    if (v.conn || v.commit || Math.abs(v.dl) > 0.5 || v.s < v.half || e.len - v.s - v.half < 12) return;
    let target = -1;
    if (v.move.out[v.lane] < 0) {
      const t = v.lane + Math.sign(nearestLane(v.move, v.lane) - v.lane);
      if (laneSafe(v, t, -4)) target = t;
    } else if (v.speed > 2) {
      let best = laneAcc(v, v.lane) + 0.6;
      for (let t = v.lane - 1; t <= v.lane + 1; t += 2) {
        if (t < 0 || t >= e.lanes.length || v.move.out[t] < 0 || !laneSafe(v, t, -3)) continue;
        const acc = laneAcc(v, t);
        if (acc > best) {
          best = acc;
          target = t;
        }
      }
    }
    if (target < 0) return;
    v.dl += e.lanes[v.lane] - e.lanes[target]; // same spot, now measured from the new lane's centre
    v.lane = target;
    v.trail = null;
  }

  // Can v move into lane t leaving itself and its new follower at least bSafe (negative) acceleration?
  function laneSafe(v, t, bSafe) {
    let lead = null;
    let back = null;
    for (const o of v.edge.occ[t]) {
      if (o.v === v) continue;
      if (o.s > v.s) {
        lead = o;
        break;
      }
      back = o;
    }
    if (lead) {
      const gap = lead.s - lead.v.half - v.s - v.half;
      if (gap < 1.5 || freeAcc(v) + brake(v, gap, lead.v.speed) < bSafe) return false;
    }
    if (back) {
      const f = back.v;
      const gap = v.s - v.half - back.s - f.half;
      if (gap < 1.5 || freeAcc(f) + brake(f, gap, v.speed) < bSafe) return false;
    }
    const off = v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl;
    const reach = v.half + player.halfL + 6;
    return !(Math.abs(v.pRight - off) < v.halfWidth + player.halfW + 0.4 && v.pAhead > -reach && v.pAhead < reach);
  }

  // Acceleration v would have in lane t behind the vehicle (or player) ahead there
  function laneAcc(v, t) {
    const o = ahead(v.edge.occ[t], v.s, v);
    let worst = o ? brake(v, o.s - o.v.half - v.s - v.half, o.v.speed) : 0;
    const pg = playerGap(v, v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl);
    if (pg < LOOKAHEAD) worst = Math.min(worst, brake(v, pg, v.pSpeed));
    return freeAcc(v) + worst;
  }

  // Fastest v can take curve c at without exceeding the sideways acceleration its driver accepts
  const bendSpeed = (v, c) => Math.sqrt(v.driver.aLat / Math.max(c.curv, 1e-3));

  // IDM acceleration for vehicles ahead in the lane (and, through the intersection, in the lane it leads to),
  // the stop line while v may not go, a red beyond, the player, and slowing down for turns and give-way lines
  function accelerate(v) {
    const e = v.edge;
    let worst = 0;
    let cap = Infinity;
    v.gap = Infinity;
    if (!v.conn) {
      worst = follow(v, e.occ[v.lane], v.s);
      const side = straddle(v);
      if (side) worst = Math.min(worst, follow(v, e.occ[v.lane + side], v.s));
      const d = e.len - v.s - v.half;
      if (d < LOOKAHEAD) {
        const go = mayEnter(v, d);
        const f = v.move.to;
        const j = v.move.out[v.lane];
        const c = j < 0 ? null : connector(e, v.lane, f, j);
        const vs = c ? v.s - e.len - c.len : 0; // position on f, measured from its start
        if (!go) {
          worst = Math.min(worst, stopAt(v, d));
        } else {
          worst = Math.min(worst, follow(v, f.occ[j], vs), signalAhead(v, f, f.len - vs - v.half));
          // pulling in to wait inside: slow down for that spot already if it will have to wait there
          if (v.yielding && holdsOn(v, pedsOut(v, d + c.len - 3))) worst = Math.min(worst, stopAt(v, d + v.half + v.yieldAt, 0.5));
        }
        // easing off to fall in behind a vehicle from another lane merging ahead into the same lane (unless committed:
        // then the others wait for v)
        const o = c && !v.claimed && mergingAhead(v, f, j);
        if (o) worst = Math.min(worst, Math.max(-v.driver.b, brake(v, o.s - o.v.half - vs - v.half, o.v.speed)));
        let vt = c ? bendSpeed(v, c) : Infinity;
        if (!e.to.signal && e.axisIndex !== 0) vt = Math.min(vt, 5);
        cap = Math.sqrt(vt * vt + 5 * Math.max(0, d));
      }
    } else {
      const f = v.move.to;
      const vs = v.cs - v.conn.len;
      worst = Math.min(follow(v, f.occ[v.out], vs), follow(v, e.occ[v.lane], e.len + v.cs), signalAhead(v, f, f.len - vs - v.half));
      // someone crossing the way out: wait for them inside the intersection, short of the 2.5 m crosswalk
      const d = v.conn.len - 3 - v.cs - v.half;
      const peds = pedsOut(v, d);
      if (v.yielding && v.cs < v.yieldAt && holdsOn(v, peds)) {
        worst = Math.min(worst, stopAt(v, v.yieldAt - v.cs, 0.5)); // waiting inside to turn
      } else {
        if (v.yielding) cross(v);
        if (peds) worst = Math.min(worst, stopAt(v, d, 0.5));
      }
      cap = bendSpeed(v, v.conn);
    }
    const pg = playerGap(v, 0);
    if (pg < LOOKAHEAD) {
      worst = Math.min(worst, brake(v, pg, v.pSpeed));
      if (pg < v.gap) {
        v.gap = pg;
        v.leaderSpeed = v.pSpeed;
      }
    }
    const acc = Math.min(freeAcc(v) + worst, (cap - v.speed) * 2);
    v.acc = clamp(acc, -9, v.driver.a);
  }

  // Front bumper at the stop line: cross if allowed, or if going too fast to stop; otherwise wait there
  function enter(v) {
    const e = v.edge;
    if (!mayEnter(v, 0)) {
      const j = v.move.out[v.lane];
      if (v.speed < 4 || j < 0) {
        v.s = e.len - v.half;
        v.speed = 0;
        return;
      }
      v.out = j;
      v.yielding = false;
    }
    v.cs = v.s - e.len;
    v.conn = connector(e, v.lane, v.move.to, v.out);
    claim(v); // at once, so vehicles deciding later this frame know
  }

  function leave(v) {
    v.s = v.cs - v.conn.len;
    v.edge = v.move.to;
    v.lane = v.out;
    v.trail = v.conn; // the rear axle is still on it
    v.conn = null;
    v.commit = null;
    v.move = chooseMove(v, false);
  }

  function drive(v, dt) {
    v.laneTimer -= dt;
    if (v.laneTimer <= 0) {
      v.laneTimer = 0.4 + Math.random() * 0.3;
      changeLanes(v);
    }
    accelerate(v);
    const speed = v.speed;
    v.speed = Math.max(0, v.speed + v.acc * dt);
    let ds = v.speed * dt;
    if (ds > v.gap - 0.3) {
      // never into the vehicle ahead
      ds = Math.max(0, v.gap - 0.3);
      v.speed = Math.min(v.speed, v.leaderSpeed);
    }
    v.acc = Math.max(-9, (v.speed - speed) / dt); // as driven, for the body to pitch with: none standing still
    v.wait = v.speed < 0.5 ? v.wait + dt : 0;
    if (!v.conn) {
      v.s += ds;
      if (v.s + v.half >= v.edge.len) enter(v);
    } else {
      v.cs += ds;
      if (v.cs >= v.conn.len) leave(v);
    }
    // ease sideways onto the lane centre (after lane changes and knocks), steering the front bumper towards it so the
    // nose doesn't swing on into the next lane, and no faster than the wheels can steer it, though even stopped half
    // way into a lane change a driver edges over
    const maxLat = Math.min(1.7, 0.3 + (v.bus ? 0.1 : 0.22) * v.speed);
    const rate = Math.min(1.8, Math.max(v.speed, 1.5) / (v.axle + v.half));
    const target = clamp(-rate * v.dl, -maxLat, maxLat);
    v.dlv += clamp(target - v.dlv, -2.5 * dt, 2.5 * dt);
    v.dl += v.dlv * dt;
  }

  // Point and direction at distance c along v's path: its lane, the curve through the intersection, and the
  // lane after it (or, just out of an intersection, the curve it came along)
  function lanePoint(e, i, s, out) {
    out.x = e.sx + e.dx * s + e.rx * e.lanes[i];
    out.z = e.sz + e.dz * s + e.rz * e.lanes[i];
    out.dx = e.dx;
    out.dz = e.dz;
    return out;
  }
  function pathPoint(v, c, out) {
    const e = v.edge;
    if (v.conn) {
      if (c < 0) return lanePoint(e, v.lane, e.len + c, out);
      if (c > v.conn.len) return lanePoint(v.move.to, v.out, c - v.conn.len, out);
      return curvePoint(v.conn, c, out);
    }
    if (c < 0 && v.trail) return curvePoint(v.trail, v.trail.len + c, out);
    return lanePoint(e, v.lane, c, out);
  }

  // World position and heading from where v's axles are along its path: the rear axle dl to the right of it, and the
  // body turned `nose` to the right about the rear axle, into a lane change (so the rear axle never slides sideways)
  const front = { x: 0, z: 0, dx: 0, dz: 0 };
  const rear = { x: 0, z: 0, dx: 0, dz: 0 };
  function locate(v) {
    const c = v.conn ? v.cs : v.s;
    pathPoint(v, c + v.axle, front);
    pathPoint(v, c - v.axle, rear);
    const l = Math.hypot(front.x - rear.x, front.z - rear.z) || 1;
    v.tx = (front.x - rear.x) / l;
    v.tz = (front.z - rear.z) / l;
    v.nose = Math.atan2(v.dlv, Math.max(v.speed, 1.5));
    const off = v.dl + v.axle * Math.sin(v.nose);
    v.x = (front.x + rear.x) / 2 - v.tz * off;
    v.z = (front.z + rear.z) / 2 + v.tx * off;
  }

  // Move v along and across its path by (dx, dz), as far as the road allows
  function shove(v, dx, dz) {
    const along = dx * v.tx + dz * v.tz;
    if (v.conn) v.cs = clamp(v.cs + along, -v.half, v.conn.len - 0.01);
    else v.s = clamp(v.s + along, 0, v.edge.len - v.half);
    v.dl = clamp(v.dl + dz * v.tx - dx * v.tz, -2.5, 2.5);
    locate(v);
  }

  // Heading, steering, turn signals, and body pitch & roll from acceleration & turning
  function pose(v, dt) {
    const yaw = Math.atan2(v.tx, v.tz) - v.nose;
    let dYaw = yaw - v.yaw;
    dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
    v.yaw = yaw;
    v.yawRate += (dYaw / dt - v.yawRate) * Math.min(1, dt * 8);
    const wheelbase = 2 * v.axle;
    const steer = clamp(Math.atan((wheelbase * v.yawRate) / Math.max(v.speed, 0.5)), -0.6, 0.6);
    v.steer += (steer - v.steer) * Math.min(1, dt * 10);

    const turn = v.move.turn;
    if (Math.abs(v.dl) > 0.3 && Math.abs(v.dlv) > 0.05) v.blink = v.dl > 0 ? -1 : 1;
    else if (turn !== 'S' && (v.conn || v.edge.len - v.s < 35)) v.blink = turn === 'R' ? 1 : -1;
    else v.blink = 0;

    v.pitchVel += ((-0.008 * v.acc - v.pitch) * 68.0 - v.pitchVel * 10.8) * dt;
    v.pitch = clamp(v.pitch + v.pitchVel * dt, -0.22, 0.22);
    v.rollVel += ((0.01 * v.speed * v.yawRate - v.roll) * 68.0 - v.rollVel * 10.8) * dt;
    v.roll = clamp(v.roll + v.rollVel * dt, -0.26, 0.26);
    v.yawOffset += v.yawVel * dt;
    v.yawVel += (-v.yawOffset * 18.0 - v.yawVel * 6.8) * dt;
    v.yawOffset = clamp(v.yawOffset * Math.exp(-4.5 * dt), -0.85, 0.85);
  }

  // Knock velocity from collisions carries v along and across its path, and dies down
  function knock(v, dt) {
    if (v.vx === 0 && v.vz === 0) return;
    shove(v, v.vx * dt, v.vz * dt);
    const damp = Math.exp(-5.5 * dt);
    v.vx *= damp;
    v.vz *= damp;
    if (v.vx * v.vx + v.vz * v.vz < 1e-4) v.vx = v.vz = 0;
  }

  // A knocked vehicle shunts the vehicles it runs into
  function knockOn(v) {
    for (const o of vehicles) {
      if (o === v || !o.edge) continue;
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist > v.half + o.half || dist < 0.001) continue;
      if (Math.abs(dz * v.tx - dx * v.tz) > v.halfWidth + o.halfWidth) continue; // side by side
      const nx = dx / dist;
      const nz = dz / dist;
      const relVn = (v.vx - o.vx) * nx + (v.vz - o.vz) * nz;
      if (relVn <= 0.5) continue;
      const transfer = relVn * 0.68;
      o.vx += nx * transfer;
      o.vz += nz * transfer;
      v.vx -= nx * transfer * 0.45;
      v.vz -= nz * transfer * 0.45;
      const across = nz * o.tx - nx * o.tz; // hit from the side spins it
      const along = nx * o.tx + nz * o.tz;
      o.yawVel += across * Math.min(2.8, relVn * 0.22);
      o.rollVel += across * Math.min(8.0, relVn) * 0.18;
      o.pitchVel -= along * Math.min(8.0, relVn) * 0.14;
      if (relVn > 2.2) spawnCollisionSparks((v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, relVn);
    }
  }

  // Physical 4-axis 2D SAT OBB test between a vehicle (half extents halfW x halfL, heading rotY) and the player.
  // Returns the minimum translation axis (pointing from the vehicle towards the player), or null if they don't overlap.
  const satHit = { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 };
  function overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pH, pHalfW, pHalfL) {
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const localX = relX * cosY - relZ * sinY;
    const localZ = relX * sinY + relZ * cosY;
    const pSin = Math.sin(pH);
    const pCos = Math.cos(pH);
    const pLocalX = relX * pCos - relZ * pSin;
    const pLocalZ = relX * pSin + relZ * pCos;
    const alignCos = Math.abs(Math.cos(pH - rotY));
    const alignSin = Math.abs(Math.sin(pH - rotY));

    const extX = halfW + pHalfW * alignCos + pHalfL * alignSin;
    const extZ = halfL + pHalfW * alignSin + pHalfL * alignCos;
    const pExtX = pHalfW + halfW * alignCos + halfL * alignSin;
    const pExtZ = pHalfL + halfW * alignSin + halfL * alignCos;

    const penX = extX - Math.abs(localX);
    const penZ = extZ - Math.abs(localZ);
    const pPenX = pExtX - Math.abs(pLocalX);
    const pPenZ = pExtZ - Math.abs(pLocalZ);
    if (!(penX > 0 && penZ > 0 && pPenX > 0 && pPenZ > 0)) return null;

    let nx, nz, pen;
    if (penX < penZ) {
      const signX = localX >= 0 ? 1 : -1;
      nx = cosY * signX;
      nz = -sinY * signX;
      pen = penX;
    } else {
      const signZ = localZ >= 0 ? 1 : -1;
      nx = sinY * signZ;
      nz = cosY * signZ;
      pen = penZ;
    }
    if (pPenX < pen) {
      const signPX = pLocalX >= 0 ? 1 : -1;
      nx = pCos * signPX;
      nz = -pSin * signPX;
      pen = pPenX;
    }
    if (pPenZ < pen) {
      const signPZ = pLocalZ >= 0 ? 1 : -1;
      nx = pSin * signPZ;
      nz = pCos * signPZ;
      pen = pPenZ;
    }

    satHit.nx = nx;
    satHit.nz = nz;
    satHit.pen = pen;
    satHit.localX = localX;
    satHit.localZ = localZ;
    satHit.pSin = pSin;
    satHit.pCos = pCos;
    return satHit;
  }

  // Player contact: push the player and the vehicle apart (a bus hardly moves) and trade momentum, with spin,
  // suspension kicks and sparks
  function collideWithPlayer(v, rotY, halfW, halfL) {
    const pe = player.entity;
    const relX = pe.position.x - v.x;
    const relZ = pe.position.z - v.z;
    if (Math.abs(relX) > halfL + 3 || Math.abs(relZ) > halfL + 3) return;
    const hit = overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pe.heading || 0, player.halfW, player.halfL);
    if (!hit) return;
    const { nx, nz, pen, localX, localZ, pSin, pCos } = hit;
    const massRatio = v.bus ? 0.15 : v.isSUV ? 0.58 : 1.0 - player.push;
    const pPush = 1.0 - massRatio;
    pe.position.x += nx * pen * pPush;
    pe.position.z += nz * pen * pPush;
    if (pe.mesh) pe.mesh.position.copy(pe.position);
    shove(v, -nx * pen * massRatio, -nz * pen * massRatio);

    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const pSpeed = pe.speed || 0;
    const pvx = pSin * pSpeed + (pe.vx || 0);
    const pvz = pCos * pSpeed + (pe.vz || 0);
    const cvx = v.tx * v.speed + v.vx;
    const cvz = v.tz * v.speed + v.vz;
    const approachSpeed = (pvx - cvx) * (-nx) + (pvz - cvz) * (-nz);
    if (approachSpeed <= 0) return;

    const jImpulse = (1.0 + 0.28) * approachSpeed;
    const cImpulse = v.bus ? approachSpeed * 0.22 : jImpulse * massRatio * 0.92;
    v.vx -= nx * cImpulse;
    v.vz -= nz * cImpulse;
    v.speed *= v.bus ? 0.55 : 0.35;

    const localNx = nx * cosY - nz * sinY;
    const localNz = nx * sinY + nz * cosY;
    if (!v.bus) {
      const torque = localZ * localNx - localX * localNz;
      v.yawVel -= torque * Math.min(4.2, approachSpeed * 0.26);
      v.yawOffset = clamp(v.yawOffset - torque * Math.min(0.35, approachSpeed * 0.025), -0.65, 0.65);
      v.pitchVel -= localNz * Math.min(12.0, approachSpeed) * 0.18;
      v.rollVel += localNx * Math.min(12.0, approachSpeed) * 0.24;
    }

    const contactLocalX = clamp(localX, -halfW, halfW);
    const contactLocalZ = clamp(localZ, -halfL, halfL);
    const contactX = v.x + contactLocalX * cosY + contactLocalZ * sinY;
    const contactZ = v.z - contactLocalX * sinY + contactLocalZ * cosY;

    if (typeof pe.speed === 'number') {
      const headOnDot = Math.abs(pSin * nx + pCos * nz);
      pe.speed *= 1.0 - (v.bus ? 0.68 : 0.50) * headOnDot;
      if (pe.type === 'car') {
        const pImpulse = v.bus ? approachSpeed * 0.65 : jImpulse * pPush * 0.48;
        pe.vx = (pe.vx || 0) + nx * pImpulse;
        pe.vz = (pe.vz || 0) + nz * pImpulse;
        const pLocalNx = nx * pCos - nz * pSin;
        const pLocalNz = nx * pSin + nz * pCos;
        if (!v.bus) {
          const pRelX = (contactX - pe.position.x) * pCos - (contactZ - pe.position.z) * pSin;
          const pRelZ = (contactX - pe.position.x) * pSin + (contactZ - pe.position.z) * pCos;
          const pTorque = pRelZ * pLocalNx - pRelX * pLocalNz;
          pe.angularVel = (pe.angularVel || 0) + pTorque * Math.min(3.0, approachSpeed * 0.18) * pPush;
        }
        const kick = Math.min(v.bus ? 16.0 : 14.0, approachSpeed);
        pe.pitchVel = (pe.pitchVel || 0) + pLocalNz * kick * (v.bus ? 0.22 : 0.18);
        pe.rollVel = (pe.rollVel || 0) - pLocalNx * kick * (v.bus ? 0.28 : 0.24);
        pe.heaveVel = (pe.heaveVel || 0) + Math.min(v.bus ? 1.6 : 1.4, approachSpeed * (v.bus ? 0.14 : 0.11));
      }
    }
    if (approachSpeed > 1.8) spawnCollisionSparks(contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed);
  }

  // =========================================================================
  // 6. PLACING VEHICLES
  // =========================================================================
  // Room at s in a lane list: margin metres to the vehicles either side, and two seconds more for the one behind
  function laneClear(list, s, margin) {
    for (const o of list) if (Math.abs(o.s - s) < o.v.half + margin + (o.s < s ? 2 * o.v.speed : 0)) return false;
    return true;
  }

  function place(v, e, lane, s) {
    v.edge = e;
    v.lane = lane;
    v.s = s;
    v.conn = null;
    v.trail = null;
    v.commit = null;
    v.yielding = false;
    v.wait = 0;
    v.speed = v.v0 * 0.5;
    v.acc = 0;
    v.dl = v.dlv = 0;
    v.vx = v.vz = v.yawOffset = v.yawVel = v.pitch = v.pitchVel = v.roll = v.rollVel = 0;
    locate(v);
    v.prevX = v.x;
    v.prevZ = v.z;
    v.yaw = Math.atan2(v.tx, v.tz);
    v.yawRate = v.steer = 0;
    v.move = chooseMove(v, false);
    occupy(e.occ[lane], v, s);
  }

  // Put v in a free spot of a random lane rMin..rMax metres from the focus, out of view if `hidden`
  function spawnVehicle(v, rMin, rMax, hidden) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const e = nearEdges[Math.floor(Math.random() * nearEdges.length)];
      if (!e || (v.bus && e.axis !== 'ave') || e.len < 2 * v.half + 10) continue;
      const lane = Math.floor(Math.random() * e.lanes.length);
      const s = v.half + 5 + Math.random() * (e.len - 2 * v.half - 10);
      const x = e.sx + e.dx * s + e.rx * e.lanes[lane];
      const z = e.sz + e.dz * s + e.rz * e.lanes[lane];
      const d = Math.hypot(x - focusX, z - focusZ);
      if (d < rMin || d > rMax || (hidden && visible(x, z, v.half + 4))) continue;
      if (player.active && Math.hypot(x - player.x, z - player.z) < 25) continue;
      if (!laneClear(e.occ[lane], s, v.half + 8)) continue;
      place(v, e, lane, s);
      return true;
    }
    return false;
  }

  // =========================================================================
  // 7. PEDESTRIANS
  // =========================================================================
  const KERB = 1.6; // how far along a crosswalk track pedestrians wait to cross (the curb is 2 m along)
  const track = { ax: 0, az: 0, ux: 0, uz: 1, len: 1, node: null, side: 0, line: 0 };
  const walkable2D = (ax, az, bx, bz) =>
    walkable(Math.min(ax, bx) - 0.4, Math.max(ax, bx) + 0.4, Math.min(az, bz) - 0.4, Math.max(az, bz) + 0.4);

  // Along the sidewalk on either side of edge e, between its crosswalks. Grid edges test the strip in one box against
  // the sidewalk rectangles; centreline streets (any direction, where those rectangles only roughly fill the sidewalks)
  // every 3 m, on the curb island (city-config.js blockAt) and clear of obstacles
  const { blockAt } = window.NYC;
  function sidewalkTrack(e) {
    const off = (Math.random() < 0.5 ? 1 : -1) * (e.half + 1.4 + Math.random() * 2.6);
    const ax = e.sx + e.rx * off;
    const az = e.sz + e.rz * off;
    if (e.general) {
      for (let s = 0; s < e.len + 3; s += 3) {
        const t = Math.min(s, e.len);
        const x = ax + e.dx * t;
        const z = az + e.dz * t;
        if (!walkable(x - 0.4, x + 0.4, z - 0.4, z + 0.4) || !blockAt(x, z)) return false;
      }
    } else {
      if (!walkable2D(ax, az, ax + e.dx * e.len, az + e.dz * e.len)) return false;
      for (let s = 0; s < e.len + 3; s += 3) {
        const t = Math.min(s, e.len);
        if (!onSidewalk(ax + e.dx * t, az + e.dz * t)) return false;
      }
    }
    Object.assign(track, { ax, az, ux: e.dx, uz: e.dz, len: e.len, node: null, side: 0, line: 0 });
    return true;
  }

  // Over one of the crosswalks of intersection n, curb to curb plus 2 m of sidewalk at each end: across the street
  // (side 0 east / 1 west of the avenue) or across the avenue (side 2 south / 3 north of the street). Each walks its
  // own line over the 2.5 m wide crosswalk, clear of its centre line (where the signal poles stand on the corners):
  // across the street on either half, across the avenue on the outer half only, so that on each corner those waiting
  // for one crosswalk stand clear of those waiting for the other. At the curb they queue in their line.
  function crosswalkTrack(n) {
    const side = Math.floor(Math.random() * 4);
    const road = n.road[side];
    if (!road) return false;
    const acrossAvenue = side >= 2;
    const sign = side % 2 === 0 ? 1 : -1;
    const line = (acrossAvenue || Math.random() < 0.5 ? sign : -sign) * (0.5 + Math.random() * 0.55);
    const ax = acrossAvenue ? road.x0 - road.half - 2 : n.x + sign * (n.hx + 1.25) + line;
    const az = acrossAvenue ? n.z + sign * (n.hz + 1.25) + line : road.z0 - road.half - 2;
    const len = 2 * road.half + 4;
    const ux = acrossAvenue ? 1 : 0;
    const uz = acrossAvenue ? 0 : 1;
    if (!walkable2D(ax, az, ax + ux * len, az + uz * len)) return false;
    if (!onSidewalk(ax, az) || !onSidewalk(ax + ux * len, az + uz * len)) return false;
    Object.assign(track, { ax, az, ux, uz, len, node: n, side, line });
    return true;
  }

  // Who is at (or just past) the curbs of each intersection's crosswalks, for whoever comes up behind to queue
  const QUEUE_GAP = 0.62; // m from one person standing in a queue to the next
  const curbNodes = [];
  const curbProgress = (p) => (p.dir > 0 ? p.t : p.len - p.t); // m along its way over (the curb it waits at is KERB)
  function atCurb(p) {
    if (curbProgress(p) > KERB + 0.5) return;
    if (!p.node.curb.length) curbNodes.push(p.node);
    p.node.curb.push(p);
  }
  function gatherCurbs() {
    for (const n of curbNodes) n.curb.length = 0;
    curbNodes.length = 0;
    for (const p of peds) if (p.placed && p.node) atCurb(p);
  }

  // Put p on a random sidewalk or crosswalk rMin..rMax metres from the focus, out of view if `hidden`
  function spawnPed(p, rMin, rMax, hidden) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const crosswalk = p.crossesStreets && nearSignals.length > 0;
      const ok = crosswalk
        ? crosswalkTrack(nearSignals[Math.floor(Math.random() * nearSignals.length)])
        : nearEdges.length > 0 && sidewalkTrack(nearEdges[Math.floor(Math.random() * nearEdges.length)]);
      if (!ok) continue;
      const t = crosswalk ? (Math.random() < 0.5 ? Math.random() * KERB : track.len - Math.random() * KERB) : Math.random() * track.len;
      const x = track.ax + track.ux * t;
      const z = track.az + track.uz * t;
      const d = Math.hypot(x - focusX, z - focusZ);
      if (d < rMin || d > rMax || (hidden && visible(x, z, 2))) continue;
      if (crosswalk && track.node.curb.some((q) => Math.hypot(q.x - x, q.z - z) < QUEUE_GAP)) continue;
      Object.assign(p, track);
      p.t = t;
      p.dir = t < track.len * 0.5 ? 1 : -1;
      p.x = x;
      p.z = z;
      p.v = crosswalk ? 0 : p.speed;
      p.pause = 0;
      p.rig.placed = false; // stands afresh where it now is
      p.placed = true;
      if (crosswalk) atCurb(p);
      return true;
    }
    return false;
  }

  // Do people on crosswalk `side` have the WALK? Across the avenue with the cross street's traffic, across the street
  // with the avenue's.
  const walkOn = (side) => (side >= 2 ? stWalk : aveWalk);

  // May p step off the curb onto its crosswalk? On the WALK (early in the parallel traffic's green, so red for the
  // traffic arriving over it), once no vehicle is crossing it or committed to, and none is too close to stop
  function mayCross(p) {
    const n = p.node;
    if (!walkOn(p.side) || n.crossing[p.side] > 0) return false;
    const e = n.approach[p.side];
    if (!e) return true;
    for (const list of e.occ) {
      const lead = leadOf(list);
      if (lead && !canStop(lead, e, true)) return false;
    }
    return true;
  }

  // Walk the track, easing to a stop at its ends and turning round on the spot; on a crosswalk, slow to a stop at the
  // curb until it may cross, or behind whoever stands ahead in its line. Vehicles give way to those on it and, on the
  // WALK, to those waiting at the curb to step off.
  const PED_ACCEL = 1.3; // m/s^2 setting off
  const PED_BRAKE = 1.6; // m/s^2 easing to a stop
  const TURN_TIME = 0.85; // s turning round at the end of the track
  const walkedNodes = [];
  function walk(p, dt) {
    if (p.pause > 0) p.pause = Math.max(0, p.pause - dt);
    const ahead = p.dir > 0 ? p.len - p.t : p.t;
    let vMax = p.pause > 0 ? 0 : Math.min(p.speed, Math.sqrt(2 * PED_BRAKE * ahead));
    if (p.node) {
      // room to walk before standing: up to the curb unless p may cross, and up to the back of whoever is ahead
      const s = curbProgress(p);
      let room = s <= KERB && !mayCross(p) ? KERB - s : Infinity;
      for (const q of p.node.curb) {
        if (q === p || q.node !== p.node || q.side !== p.side || q.dir !== p.dir || Math.abs(q.line - p.line) > 0.55) continue;
        const gap = curbProgress(q) - s;
        if (gap > 0) room = Math.min(room, Math.max(0, gap - QUEUE_GAP));
      }
      vMax = Math.min(vMax, Math.sqrt(2 * PED_BRAKE * room));
    }
    p.v += Math.max(-2 * PED_BRAKE * dt, Math.min(PED_ACCEL * dt, vMax - p.v));
    let t = p.t + p.dir * p.v * dt;
    const stepsOff = !!p.node && (p.dir > 0 ? p.t <= KERB && t > KERB : p.t >= p.len - KERB && t < p.len - KERB);
    p.waiting = stepsOff && !mayCross(p);
    if (p.waiting) {
      t = p.t;
      p.v = 0;
    }
    if (p.dir > 0 ? t >= p.len : t <= 0) {
      t = p.dir > 0 ? p.len : 0;
      p.dir = -p.dir;
      p.v = 0;
      p.pause = TURN_TIME;
    }
    p.t = t;
    p.x = p.ax + p.ux * t;
    p.z = p.az + p.uz * t;
    if (p.node && ((t > KERB && t < p.len - KERB) || (p.waiting && walkOn(p.side)))) {
      p.coord = p.side >= 2 ? p.x : p.z;
      if (!p.node.walkers.length) walkedNodes.push(p.node);
      p.node.walkers.push(p);
    }
  }

  // =========================================================================
  // 8. RENDERING
  // =========================================================================
  // Beyond CAR_PROXY_DISTANCE, cars use the ~250-triangle stand-in with built-in wheels instead of the full lofted
  // body + 4 separate wheel instances; vehicles outside the view frustum (with a margin for cast shadows and headlight
  // cones) are skipped altogether.
  const CAR_PROXY_DISTANCE = 90;
  const dirtyPaint = new Set();
  const dirtyState = new Set();
  const litVehicles = [];
  let litVehicleCount = 0;
  let wheelCars = 0;
  let visibleCars = 0;
  let nypdDrawn = 0;
  let visibleBuses = 0;
  let updates = 0;

  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }

  // 3D spinning alloy wheels & tires (left & right, front & rear), exact 1:1 ground rolling, steering front wheels.
  // The wheel geometry is modelled at baseRadius (the sedan's 0.35 m car wheel), scaled to the vehicle's radius
  function placeWheels(v, i, rotY, roll, radius, halfTrack, halfBase, leftInst, rightInst, baseRadius = 0.35) {
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const scale = radius / baseRadius;
    dummy.scale.set(scale, scale, scale);
    for (let w = 0; w < 2; w++) {
      const wz = w === 0 ? halfBase : -halfBase;
      dummy.rotation.set(v.wheelSpin + w * 0.55, rotY + (w === 0 ? v.steer : 0), roll, 'YXZ');
      dummy.position.set(v.x - halfTrack * cosY + wz * sinY, radius, v.z + halfTrack * sinY + wz * cosY);
      dummy.updateMatrix();
      leftInst.setMatrixAt(i * 2 + w, dummy.matrix);

      dummy.position.set(v.x + halfTrack * cosY + wz * sinY, radius, v.z - halfTrack * sinY + wz * cosY);
      dummy.updateMatrix();
      rightInst.setMatrixAt(i * 2 + w, dummy.matrix);
    }
  }

  // Lamp state for the car & bus materials: brake lights while slowing down or standing, the turn signal on the side
  // v is heading for (left = +x)
  function writeLampState(v, array, o) {
    const blinkOn = v.blink !== 0 && (clock + v.blinkPhase) % 0.8 <= 0.4;
    array[o] = v.acc < -0.8 || v.speed < 0.3 ? 1 : 0;
    array[o + 1] = blinkOn && v.blink < 0 ? 1 : 0;
    array[o + 2] = blinkOn && v.blink > 0 ? 1 : 0;
  }

  function renderCar(c) {
    const rotY = c.yaw + c.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const spec = BODY_SPECS[c.bodyType];
    const forwardDist = (c.x - c.prevX) * sinY + (c.z - c.prevZ) * cosY;
    const rawStep = forwardDist / spec.wheelRadius;
    c.wheelSpin = (c.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
    if (hasView && !visible(c.x, c.z, 18)) return;

    const near = Math.hypot(c.x - focusX, c.z - focusZ) < CAR_PROXY_DISTANCE;
    const bodyInst = near ? bodies[c.bodyType].near : bodies[c.bodyType].far;
    const slot = bodyInst.count++;

    dummy.position.set(c.x, 0.0, c.z);
    dummy.rotation.set(c.pitch, rotY, c.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(slot, dummy.matrix);
    if (c.isNYPD) nypdBarInst.setMatrixAt(nypdDrawn++, dummy.matrix);

    const attrs = bodyInst.geometry.attributes;
    const paint = attrs.paintColor.array;
    const o3 = slot * 3;
    if (paint[o3] !== c.paint[0] || paint[o3 + 1] !== c.paint[1] || paint[o3 + 2] !== c.paint[2]) {
      paint[o3] = c.paint[0];
      paint[o3 + 1] = c.paint[1];
      paint[o3 + 2] = c.paint[2];
      dirtyPaint.add(bodyInst);
    }
    const state = attrs.carState.array;
    const o4 = slot * 4;
    const blinkOn = c.blink !== 0 && (clock + c.blinkPhase) % 0.8 <= 0.4;
    const b0 = c.acc < -0.8 || c.speed < 0.3 ? 1 : 0;
    const b1 = blinkOn && c.blink < 0 ? 1 : 0;
    const b2 = blinkOn && c.blink > 0 ? 1 : 0;
    const b3 = c.isNYPD ? 1 : 0;
    if (state[o4] !== b0 || state[o4 + 1] !== b1 || state[o4 + 2] !== b2 || state[o4 + 3] !== b3) {
      state[o4] = b0;
      state[o4 + 1] = b1;
      state[o4 + 2] = b2;
      state[o4 + 3] = b3;
      dirtyState.add(bodyInst);
    }

    // Soft Under-Car Contact Shadow (AO) stays flat on the asphalt
    const visIdx = visibleCars++;
    dummy.rotation.set(0, rotY, 0, 'YXZ');
    dummy.position.set(c.x, 0.018, c.z);
    dummy.scale.set(2.22, 1.0, 5.05);
    dummy.updateMatrix();
    carShadowInst.setMatrixAt(visIdx, dummy.matrix);

    const dxCam = c.x - camX;
    const dzCam = c.z - camZ;
    const distSq = dxCam * dxCam + dzCam * dzCam + camY * camY;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        c._camDistSq = distSq;
        c._effDist = effDist;
        c._sinY = sinY;
        c._cosY = cosY;
        c._braking = b0;
        litVehicles[litVehicleCount++] = c;
      }
    }

    if (near) {
      placeWheels(c, wheelCars++, rotY, c.roll, spec.wheelRadius, spec.wheelX, spec.wheelZ, carWheelLeftInst, carWheelRightInst);
    }
  }

  function renderBus(b) {
    const rotY = b.yaw + b.yawOffset;
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const forwardDist = (b.x - b.prevX) * sinY + (b.z - b.prevZ) * cosY;
    const rawStep = forwardDist / BUS_SPEC.wheelRadius;
    b.wheelSpin = (b.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
    if (hasView && !visible(b.x, b.z, 22)) return;

    const i = visibleBuses++;
    dummy.position.set(b.x, 0.018, b.z);
    dummy.rotation.set(0, rotY, 0, 'YXZ');
    dummy.scale.set(2.92, 1.0, 12.1);
    dummy.updateMatrix();
    busShadowInst.setMatrixAt(i, dummy.matrix);

    // Lofted Bus Body is defined in ground-relative Y (0.36m skirt to 3.0m roof crown)
    dummy.position.set(b.x, 0.0, b.z);
    dummy.rotation.set(b.pitch, rotY, b.roll, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    busBodyInst.setMatrixAt(i, dummy.matrix);
    busHeaderInst.setMatrixAt(i, dummy.matrix);
    writeLampState(b, busStates.array, i * 4);

    const dxCam = b.x - camX;
    const dzCam = b.z - camZ;
    const distSq = dxCam * dxCam + dzCam * dzCam + camY * camY;
    if (distSq < MAX_LIGHT_DIST_SQ) {
      const d = Math.sqrt(distSq);
      const forwardDot = dxCam * camFwdX + dzCam * camFwdZ;
      const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
      if (effDist < MAX_LIGHT_DIST) {
        b._camDistSq = distSq;
        b._effDist = effDist;
        b._sinY = sinY;
        b._cosY = cosY;
        b._braking = b.acc < -0.8 || b.speed < 0.3 ? 1 : 0;
        litVehicles[litVehicleCount++] = b;
      }
    }

    placeWheels(b, i, rotY, 0, BUS_SPEC.wheelRadius, BUS_SPEC.wheelX, BUS_SPEC.wheelZ, busWheelLeftInst, busWheelRightInst, BUS_SPEC.wheelRadius);
  }

  function smoothDistFade(d, start, end) {
    const t = clamp((end - d) / (end - start), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function updateTrafficLights() {
    litVehicles.length = litVehicleCount;
    if (litVehicleCount > 1) {
      litVehicles.sort((a, b) => a._effDist - b._effDist);
    }

    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    // Front headlights are off during Midday (0.24) & Golden Hour (0.48); fade in smoothly for Dusk (1.25) & Night (1.55)
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const tailScale = clamp(0.18 + glow * 0.66, 0.24, 1.22);

    const maxDualVehicles = HEADLIGHT_POOL_SIZE >> 1;
    const vehCutoff = litVehicleCount > maxDualVehicles
      ? Math.min(MAX_LIGHT_DIST, litVehicles[maxDualVehicles]._effDist)
      : MAX_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < litVehicleCount && spotUsed + 2 <= HEADLIGHT_POOL_SIZE; i++) {
        const v = litVehicles[i];
        const fade = smoothDistFade(v._effDist, vehCutoff * 0.62, vehCutoff);
        if (fade <= 0.001) continue;
        const spec = v.bus ? BUS_SPEC : BODY_SPECS[v.bodyType];
        const fullReach = HEADLIGHTS.distance;
        let maxReach = fullReach;
        if (player.active && v.pAhead > 0 && v.pAhead < 30) {
          const latWeight = smoothDistFade(Math.abs(v.pRight), 2.2, 5.5);
          const clampedReach = Math.max(4.5, v.pAhead - player.halfL - 1.5);
          maxReach = fullReach + (clampedReach - fullReach) * latWeight;
        }

        const baseInt = (v.bus ? HEADLIGHTS.busIntensity : HEADLIGHTS.intensity) * beamScale * fade;
        // Match the body instance, including suspension and impact rotation.
        dummy.position.set(v.x, 0, v.z);
        dummy.rotation.set(v.pitch, v.yaw + v.yawOffset, v.roll, 'YXZ');
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        for (let side = -1; side <= 1; side += 2) {
          const spot = headlightPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, dummy.matrix);
          spot.distance = maxReach;
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HEADLIGHT_POOL_SIZE; i++) {
      const spot = headlightPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }

    // 1. NYPD emergency roof lightbar flashes (smoothly pulsing red/blue 360° PointLights on nearby patrol cruisers)
    let nypdUsed = 0;
    for (let i = 0; i < litVehicleCount && nypdUsed < NYPD_LIGHT_POOL_SIZE; i++) {
      const v = litVehicles[i];
      if (!v.isNYPD || v._effDist >= 88) continue;
      const fade = smoothDistFade(v._effDist, 52, 88);
      if (fade <= 0.001) continue;
      const wave = Math.sin((clock + v.blinkPhase) * Math.PI * 6.0);
      const redPhase = wave >= 0;
      const pulse = 0.35 + 0.65 * Math.abs(wave);
      const side = redPhase ? -0.36 : 0.36;
      const pt = nypdLightPool[nypdUsed++];
      pt.color.setHex(redPhase ? 0xff1828 : 0x1868ff);
      pt.position.set(v.x + side * v._cosY - 0.25 * v._sinY, 1.85, v.z - side * v._sinY - 0.25 * v._cosY);
      pt.distance = 12.0;
      pt.intensity = 42.0 * tailScale * fade * pulse;
    }
    for (let i = nypdUsed; i < NYPD_LIGHT_POOL_SIZE; i++) {
      const pt = nypdLightPool[i];
      pt.intensity = 0;
      pt.position.set(0, -1000, 0);
    }
  }

  // Walking surface around a pedestrian: sidewalks are 0.22 m above the road, and crosswalk tracks start and end
  // with 2 m of sidewalk (the rig steps down and up the curbs)
  const SIDEWALK_Y = 0.22;
  const CROSSWALK_Y = 0.012;
  function pedGround(p, x, z) {
    if (!p.node) return SIDEWALK_Y;
    const t = (x - p.ax) * p.ux + (z - p.az) * p.uz;
    return t > 2 && t < p.len - 2 ? CROSSWALK_Y : SIDEWALK_Y;
  }

  // Every rig's gait advances every frame; only those the camera may see (or whose shadow it may see) solve their
  // bone transforms and are drawn, the far ones with the light LOD.
  function renderPed(p, dt) {
    const draw = !hasView || visible(p.x, p.z, 7);
    p.rig.update(dt, p.x, p.z, Math.atan2(p.ux * p.dir, p.uz * p.dir), pedGround, p, 0, draw);
    if (!draw) return;
    pedCrowd.add(p.rig, Math.hypot(p.x - focusX, p.z - focusZ));
  }

  function updateSparks(dt) {
    let count = 0;
    for (let s = 0; s < MAX_SPARKS; s++) {
      const sp = sparks[s];
      if (sp.life > 0) {
        sp.life -= dt;
        sp.vy -= 22.0 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.z += sp.vz * dt;
        if (sp.y < 0.03) {
          sp.y = 0.03;
          sp.vy = Math.abs(sp.vy) * 0.45;
          sp.vx *= 0.78;
          sp.vz *= 0.78;
        }
        const tLife = Math.max(0, sp.life / sp.maxLife);
        const spdXZ = Math.hypot(sp.vx, sp.vz) || 0.001;
        const yawSp = Math.atan2(sp.vx, sp.vz);
        const pitchSp = -Math.atan2(sp.vy, spdXZ);
        dummy.position.set(sp.x, sp.y, sp.z);
        dummy.rotation.set(pitchSp, yawSp, 0, 'YXZ');
        dummy.scale.set(tLife, tLife, Math.max(0.4, Math.min(2.2, spdXZ * 0.16)) * tLife);
        dummy.updateMatrix();
        sparkInst.setMatrixAt(count++, dummy.matrix);
      }
    }
    // Keep one degenerate instance for shader warm-up, then hide the empty pool and stop uploading it.
    sparkInst.visible = count > 0 || updates <= 2;
    if (count === 0 && updates <= 2) sparkInst.setMatrixAt(count++, zero);
    sparkInst.count = count;
    if (count > 0) flagRange(sparkInst.instanceMatrix, count);
  }

  // =========================================================================
  // 9. UPDATE
  // =========================================================================
  let lastFocusX = Infinity;
  let lastFocusZ = Infinity;

  function update(dt, elapsed, focusPos = null, playerEntity = null, activeMode = 'car', camera = null) {
    clock = elapsed;
    avePhase = signalPhase(elapsed, true);
    stPhase = signalPhase(elapsed, false);
    aveWalk = walkSignal(elapsed, true);
    stWalk = walkSignal(elapsed, false);
    focusX = focusPos ? focusPos.x : 0;
    focusZ = focusPos ? focusPos.z : 140;
    // a jump of the camera (teleport, first frame): everything far away can be placed anywhere around it
    const jump = Math.hypot(focusX - lastFocusX, focusZ - lastFocusZ) > 140;
    lastFocusX = focusX;
    lastFocusZ = focusZ;
    refreshNear();
    updateView(camera);

    player.active = Boolean(playerEntity && activeMode !== 'helicopter' && playerEntity.position.y < 2.6);
    if (playerEntity) {
      const heading = playerEntity.heading || 0;
      const speed = playerEntity.speed || 0;
      player.entity = playerEntity;
      player.x = playerEntity.position.x;
      player.z = playerEntity.position.z;
      player.vx = Math.sin(heading) * speed + (playerEntity.vx || 0);
      player.vz = Math.cos(heading) * speed + (playerEntity.vz || 0);
    }
    player.halfW = activeMode === 'cyclist' ? 0.35 : activeMode === 'person' ? 0.32 : 0.86;
    player.halfL = activeMode === 'cyclist' ? 0.85 : activeMode === 'person' ? 0.32 : 2.18;
    player.push = activeMode === 'cyclist' ? 0.82 : activeMode === 'person' ? 0.88 : 0.50;

    // 1. Cars & buses
    buildOccupancy();
    for (const m of bodyMeshes) m.count = 0;
    litVehicleCount = 0;
    wheelCars = 0;
    visibleCars = 0;
    nypdDrawn = 0;
    visibleBuses = 0;
    let budget = jump ? Infinity : 4;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const d = v.edge ? Math.hypot(v.x - focusX, v.z - focusZ) : Infinity;
      if (!v.edge || (jump && d > NEAR_RADIUS)) {
        spawnVehicle(v, 0, NEAR_RADIUS, false);
      } else if (budget > 0 && (d > 1200 || (d > VEHICLE_RADIUS && !visible(v.x, v.z, v.half + 2))) && spawnVehicle(v, 100, 300, true)) {
        budget--;
      }
      if (!v.edge) continue;

      v.prevX = v.x;
      v.prevZ = v.z;
      relateToPlayer(v);
      drive(v, dt);
      locate(v);
      knock(v, dt);
      pose(v, dt);
      if (player.active) collideWithPlayer(v, v.yaw + v.yawOffset, v.bus ? 1.30 : v.isSUV ? 0.92 : 0.86, v.bus ? 5.72 : v.isSUV ? 2.22 : 2.18);
      if (v.vx * v.vx + v.vz * v.vz > 0.36) knockOn(v);

      if (v.bus) renderBus(v);
      else renderCar(v);
    }
    const hideEmpty = ++updates > 2;
    for (const m of bodyMeshes) {
      const n = m.count;
      m.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          m.setMatrixAt(0, zero);
          m.count = 1;
          flagRange(m.instanceMatrix, 1);
        }
        continue;
      }
      flagRange(m.instanceMatrix, n);
      if (dirtyPaint.has(m)) flagRange(m.geometry.attributes.paintColor, n);
      if (dirtyState.has(m)) flagRange(m.geometry.attributes.carState, n);
    }
    dirtyPaint.clear();
    dirtyState.clear();
    const syncInst = (inst, n) => {
      inst.visible = n > 0 || !hideEmpty;
      if (n === 0) {
        if (!hideEmpty) {
          inst.setMatrixAt(0, zero);
          inst.count = 1;
          flagRange(inst.instanceMatrix, 1);
        } else {
          inst.count = 0;
        }
        return;
      }
      inst.count = n;
      flagRange(inst.instanceMatrix, n);
    };
    syncInst(carWheelLeftInst, wheelCars * 2);
    syncInst(carWheelRightInst, wheelCars * 2);
    syncInst(nypdBarInst, nypdDrawn);
    syncInst(carShadowInst, visibleCars);
    syncInst(busBodyInst, visibleBuses);
    syncInst(busHeaderInst, visibleBuses);
    syncInst(busWheelLeftInst, visibleBuses * 2);
    syncInst(busWheelRightInst, visibleBuses * 2);
    syncInst(busShadowInst, visibleBuses);
    if (visibleBuses > 0) flagRange(busStates, visibleBuses);
    updateTrafficLights();

    // 2. Pedestrians
    for (const n of walkedNodes) n.walkers.length = 0;
    walkedNodes.length = 0;
    gatherCurbs();
    let pedBudget = jump ? Infinity : 6;
    pedCrowd.begin();
    for (let i = 0; i < NUM_PEDS; i++) {
      const p = peds[i];
      const d = p.placed ? Math.hypot(p.x - focusX, p.z - focusZ) : Infinity;
      if (!p.placed || (jump && d > NEAR_RADIUS)) {
        spawnPed(p, 0, NEAR_RADIUS, false);
      } else if (pedBudget > 0 && (d > 1000 || (d > PED_RADIUS && !visible(p.x, p.z, 2))) && spawnPed(p, 60, 260, true)) {
        pedBudget--;
      }
      if (!p.placed) continue;
      walk(p, dt);
      renderPed(p, dt);
    }
    pedCrowd.end();

    // 3. Collision sparks, including the player's own impacts against buildings
    if (playerEntity && playerEntity.lastCollisionSpark) {
      const bs = playerEntity.lastCollisionSpark;
      spawnCollisionSparks(bs.x, bs.y, bs.z, bs.nx, bs.nz, bs.speed);
      playerEntity.lastCollisionSpark = null;
    }
    updateSparks(dt);
  }

  return {
    group,
    update,
    cars,
    buses,
    peds,
    network
  };
}

// ============================================================================
// AMBIENT SHORE-HIGHWAY TRAFFIC (West Side Highway, Henry Hudson Parkway, FDR Drive)
// ============================================================================
// The shore highways city-grid.js lays along both rivers are not part of the road graph, so a lighter model fills
// them: cars follow each lane's centre line and keep their distance with the IDM. Nobody changes lanes, so the order
// in a lane never changes and every car's leader is simply the next one (cyclically: cars dip below the deck at the
// end of a lane as if into an underpass and come back up at its start; West St and the FDR's lanes are joined through
// the Battery Park Underpass, lane points well below ground). Cars queue behind the player standing or
// driving in their lane. Within HWY_NEAR_LOD m of the camera they use the full model with wheels and cast shadows,
// up to HWY_MID_LOD m a wheel-less body, further out a coarse ~250-triangle lofted proxy; beyond HWY_FAR_CULL m (or well behind
// the camera) they aren't drawn.
const HWY_DRIVER = { a: 1.6, b: 2.8, T: 1.3, s0: 3.0 };
const HWY_CAR_LEN = 4.6;
const HWY_NEAR_LOD = 170;
const HWY_MID_LOD = 450;
const HWY_FAR_CULL = 1600;
const HWY_RAMP = 32; // the dip at the lane ends: 2.4 m down over this many metres

function createHighwayTraffic(scene, lanes) {
  const group = new THREE.Group();
  group.name = 'HighwayTraffic';
  scene.add(group);
  const KINDS = ['taxi', 'sedan', 'suv'];
  const PALETTES = {
    taxi: [0xffbe14],
    sedan: [0x1c2026, 0xcfd6de, 0x1d3b6c, 0x52575e, 0x6e1f24, 0x8a8f96, 0xe9ecef],
    suv: [0x16191e, 0xf0f3f7, 0x3a434d, 0x28382e, 0xbec6cf, 0x5b2a2a]
  };
  let seed = 20240917;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Lanes: arc length and heading at every centre-line vertex, bounds for the player test, cars every 24-74 m
  const cars = [];
  const counts = { taxi: 0, sedan: 0, suv: 0 };
  for (const lane of lanes) {
    const P = lane.pts;
    lane.cum = [0];
    for (let i = 1; i < P.length; i++) lane.cum.push(lane.cum[i - 1] + P[i].distanceTo(P[i - 1]));
    lane.len = lane.cum[P.length - 1];
    lane.yaw = P.map((p, i) => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      return Math.atan2(b.x - a.x, b.z - a.z);
    });
    lane.box = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of P) lane.box = [Math.min(lane.box[0], p.x), Math.max(lane.box[1], p.x), Math.min(lane.box[2], p.z), Math.max(lane.box[3], p.z)];
    lane.cars = [];
    for (let u = rand() * 30; u < lane.len - 12; u += 24 + rand() * 50) {
      const h = rand();
      const kind = h < 0.32 ? 'taxi' : h < 0.72 ? 'sedan' : 'suv';
      const col = new THREE.Color(PALETTES[kind][Math.floor(rand() * PALETTES[kind].length)]);
      // (float32 values, so update() can tell whether an instance slot's paint changes by comparing with the buffer)
      const car = { lane, kind, u, v: lane.speed, acc: 0, seg: 0, col: [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)] };
      lane.cars.push(car);
      cars.push(car);
      counts[kind]++;
    }
  }

  // Per body type: [near (with wheels, casts shadows), mid (wheel-less), far (lofted proxy)] instanced meshes sharing
  // the traffic's cached car material (per-instance paintColor & carState)
  const meshes = {};
  for (const kind of KINDS) {
    const spec = BODY_SPECS[kind];
    const n = Math.max(1, counts[kind]);
    meshes[kind] = [0, 1, 2].map((lod) => {
      const geo = lod === 2 ? buildCarProxyGeometry(spec) : buildCarGeometry(spec, lod === 0);
      geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const mesh = new THREE.InstancedMesh(geo, createLoftedCarMaterial(spec), n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    });
  }

  // Night lamp flares: a soft glow on every head- and tail-lamp, at least a couple of pixels wide, so the highways read
  // as streams of white and red lights from across the river once the lamp geometry shrinks below a pixel.
  // (flareCol is rgb + an unused w: 3-component attributes get re-padded to 4 on every upload)
  const flarePos = new Float32Array(cars.length * 4 * 4); // x, y, z, size
  const flareCol = new Float32Array(cars.length * 4 * 4); // r, g, b, -
  const flareGeo = new THREE.PlaneGeometry(1, 1);
  flareGeo.setAttribute('flarePos', new THREE.InstancedBufferAttribute(flarePos, 4));
  flareGeo.setAttribute('flareCol', new THREE.InstancedBufferAttribute(flareCol, 4));
  const flares = new THREE.InstancedMesh(flareGeo, createCarFlareMaterial(), cars.length * 4);
  flares.name = 'HighwayLampFlares';
  flares.frustumCulled = false;
  flares.visible = false;
  flares.renderOrder = 2;
  group.add(flares);
  let flareCount = 0;

  // Clustered SpotLight pool for nearby highway cars (within 105 m)
  const HWY_SPOT_POOL = 2; // bounded WebGL forward-light budget (SSGI handles local bounce)
  const HWY_LIGHT_DIST = 105;
  const HWY_LIGHT_DIST_SQ = HWY_LIGHT_DIST * HWY_LIGHT_DIST;
  const hwyLightsGroup = new THREE.Group();
  hwyLightsGroup.name = 'HighwayClusteredLights';
  group.add(hwyLightsGroup);

  const hwySpotPool = [];
  for (let i = 0; i < HWY_SPOT_POOL; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    hwyLightsGroup.add(spot, spot.target);
    hwySpotPool.push(spot);
  }
  const hwyLitCars = [];
  let hwyLitCount = 0;
  function addFlare(px, py, pz, size, r, g, b) {
    const o = flareCount * 4;
    flarePos[o] = px;
    flarePos[o + 1] = py;
    flarePos[o + 2] = pz;
    flarePos[o + 3] = size;
    const k = flareCount * 4;
    flareCol[k] = r;
    flareCol[k + 1] = g;
    flareCol[k + 2] = b;
    flareCount++;
  }
  const flareFacing = (f) => { const t = Math.min(1, Math.max(0, (f + 0.3) / 0.9)); return t * t * (3 - 2 * t); };

  const D = HWY_DRIVER;
  const brakeTerm = 2 * Math.sqrt(D.a * D.b);
  const ease = (x) => { const t = Math.min(1, Math.max(0, x / HWY_RAMP)); return t * t * (3 - 2 * t); };
  const easeSlope = (x) => { if (x <= 0 || x >= HWY_RAMP) return 0; const t = x / HWY_RAMP; return (6 * t * (1 - t)) / HWY_RAMP; };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  const fwd = new THREE.Vector3();
  const dirtyPaint = new Set();
  const dirtyState = new Set();
  let updates = 0;
  // Flags the first n items of an attribute for upload (static usage: once per frame, not once per render pass)
  function flagRange(attr, n) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }

  // The player's arc position and speed along `lane` if they are in it (within 2 m of the centre line and near
  // its road height, not on its underground stretches), else null
  function playerInLane(lane, pl) {
    const [x0, x1, z0, z1] = lane.box;
    if (pl.x < x0 - 3 || pl.x > x1 + 3 || pl.z < z0 - 3 || pl.z > z1 + 3) return null;
    const P = lane.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      if (P[i].y < -1 && P[i + 1].y < -1) continue;
      const ax = P[i].x, az = P[i].z;
      const sx = P[i + 1].x - ax, sz = P[i + 1].z - az;
      const horizontalLengthSq = sx * sx + sz * sz;
      if (horizontalLengthSq === 0) continue;
      const L = lane.cum[i + 1] - lane.cum[i];
      const t = ((pl.x - ax) * sx + (pl.z - az) * sz) / horizontalLengthSq;
      if (t < 0 || t > 1) continue;
      const y = P[i].y + (P[i + 1].y - P[i].y) * t;
      if (Math.abs(pl.y - y) >= 2.6) continue;
      if (Math.abs((pl.z - az) * sx - (pl.x - ax) * sz) / Math.sqrt(horizontalLengthSq) < 2.0) {
        // Convert horizontal progress to distance along the sloped lane, as with u above.
        return { u: lane.cum[i] + t * L, v: Math.max(0, ((pl.vx * sx + pl.vz * sz) / horizontalLengthSq) * L) };
      }
    }
    return null;
  }

  function update(dt, camera, entity, mode) {
    // 1. Car following (IDM) in every lane, the player counting as a leader
    const pl = entity && mode !== 'helicopter' ? {
      x: entity.position.x, y: entity.position.y, z: entity.position.z,
      vx: Math.sin(entity.heading || 0) * (entity.speed || 0) + (entity.vx || 0),
      vz: Math.cos(entity.heading || 0) * (entity.speed || 0) + (entity.vz || 0)
    } : null;
    for (const lane of lanes) {
      const list = lane.cars;
      const n = list.length;
      const pIn = pl ? playerInLane(lane, pl) : null;
      for (let k = 0; k < n; k++) {
        const c = list[k];
        let gap = Infinity;
        let dv = 0;
        if (n > 1) {
          const lead = list[(k + 1) % n];
          gap = lead.u - c.u;
          if (gap < 0) gap += lane.len;
          gap -= HWY_CAR_LEN;
          dv = c.v - lead.v;
        }
        if (pIn && pIn.u > c.u && pIn.u - c.u - HWY_CAR_LEN < gap) {
          gap = pIn.u - c.u - HWY_CAR_LEN;
          dv = c.v - pIn.v;
        }
        const sStar = D.s0 + Math.max(0, c.v * D.T + (c.v * dv) / brakeTerm);
        c.acc = Math.max(-9, D.a * (1 - (c.v / lane.speed) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2));
      }
      for (const c of list) {
        c.v = Math.max(0, c.v + c.acc * dt);
        c.u += c.v * dt;
        if (c.u >= lane.len) {
          c.u -= lane.len;
          c.seg = 0;
        }
      }
    }

    // 2. Instances: LOD by distance, far cars well behind the camera skipped; lamp flares at dusk & night
    const cam = camera.position;
    camera.getWorldDirection(fwd);
    for (const kind of KINDS) for (const mesh of meshes[kind]) mesh.count = 0;
    const flaresOn = cityUniforms.uInteriorGlow.value > 0.65;
    const pxAt1m = (2 * Math.tan(((camera.fov || 55) * Math.PI) / 360)) / Math.max(360, window.innerHeight || 800);
    flareCount = 0;
    hwyLitCount = 0;
    for (const c of cars) {
      const lane = c.lane;
      const cum = lane.cum;
      while (c.seg < cum.length - 2 && cum[c.seg + 1] < c.u) c.seg++;
      const i = c.seg;
      const segLen = cum[i + 1] - cum[i];
      const t = Math.min(1, Math.max(0, (c.u - cum[i]) / segLen));
      const a = lane.pts[i];
      const b = lane.pts[i + 1];
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const toEnd = lane.len - c.u;
      const dip = c.u < toEnd ? c.u : toEnd;
      const y = a.y + (b.y - a.y) * t - 2.4 * (1 - ease(dip));
      const dx = x - cam.x;
      const dz = z - cam.z;
      const dy = y - cam.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > HWY_FAR_CULL * HWY_FAR_CULL) continue;
      const lod = d2 < HWY_NEAR_LOD * HWY_NEAR_LOD ? 0 : d2 < HWY_MID_LOD * HWY_MID_LOD ? 1 : 2;
      if (lod > 0 && dx * fwd.x + dz * fwd.z < -40) continue;
      if (y < -3.6) continue; // in the Battery Park Underpass, out of sight behind the portals' screens
      const slope = (b.y - a.y) / segLen + 2.4 * easeSlope(dip) * (c.u < toEnd ? 1 : -1);
      let dYaw = lane.yaw[i + 1] - lane.yaw[i];
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const yaw = lane.yaw[i] + dYaw * t;
      euler.set(-Math.atan(slope), yaw, 0);
      q.setFromEuler(euler);
      m4.compose(pos.set(x, y, z), q, ONE);
      const mesh = meshes[c.kind][lod];
      const slot = mesh.count++;
      m4.toArray(mesh.instanceMatrix.array, slot * 16);
      // Paint & brake lights change only when a slot changes hands or a car brakes: flagged for upload just then
      const attrs = mesh.geometry.attributes;
      const paint = attrs.paintColor.array;
      const o3 = slot * 3;
      if (paint[o3] !== c.col[0] || paint[o3 + 1] !== c.col[1] || paint[o3 + 2] !== c.col[2]) {
        paint.set(c.col, o3);
        dirtyPaint.add(mesh);
      }
      const brake = c.acc < -1.2 ? 1 : 0; // brake lights
      if (attrs.carState.array[slot * 4] !== brake) {
        attrs.carState.array[slot * 4] = brake;
        dirtyState.add(mesh);
      }

      if (d2 < HWY_LIGHT_DIST_SQ && dip > 1) {
        const d = Math.sqrt(d2);
        const forwardDot = dx * fwd.x + dz * fwd.z;
        const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
        if (effDist < HWY_LIGHT_DIST) {
          c._d2 = d2;
          c._effDist = effDist;
          c._mesh = mesh;
          c._slot = slot;
          c._brake = brake;
          hwyLitCars[hwyLitCount++] = c;
        }
      }

      // Flares (from 40 m out, full by 120 m): sprites just off the lamp faces, white at the front and red at the back,
      // brightest seen head-on / from behind, dimmed by haze
      if (!flaresOn || d2 < 1600 || dip < 1) continue;
      const d = Math.sqrt(d2);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const facing = -(dx * sy + dz * cy) / d;
      const k = (Math.min(1, (d - 40) / 80) / (1 + (d / 2000) ** 2)) * ease(dip);
      const size = Math.max(0.6, d * pxAt1m * 3);
      const spec = BODY_SPECS[c.kind];
      for (let e = 0; e < 2; e++) {
        const front = e === 0;
        const w = k * (0.3 + 0.7 * flareFacing(front ? facing : -facing));
        const lz = front ? spec.zFront + 0.3 : spec.zRear - 0.3;
        const ly = y + (front ? spec.lamps[0] : spec.lamps[1]);
        for (let s = -1; s <= 1; s += 2) {
          const lx = s * spec.lampX[front ? 0 : 1];
          if (front) addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 4.4 * w, 4.1 * w, 3.6 * w);
          else addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 3.4 * w, 0.16 * w, 0.1 * w);
        }
      }
    }
    // Upload just the instances in use (the buffers hold every car of the kind), and nothing for empty meshes, which
    // are hidden too (an empty instanced mesh still costs a render object update in every pass). They stay visible
    // for the first couple of frames so that the shader precompile & warm-up frame (main.js) see all of them.
    const hideEmpty = ++updates > 2;
    for (const kind of KINDS) {
      for (const mesh of meshes[kind]) {
        const n = mesh.count;
        mesh.visible = n > 0 || !hideEmpty;
        if (n === 0) continue;
        flagRange(mesh.instanceMatrix, n);
        if (dirtyPaint.has(mesh)) flagRange(mesh.geometry.attributes.paintColor, n);
        if (dirtyState.has(mesh)) flagRange(mesh.geometry.attributes.carState, n);
      }
    }
    dirtyPaint.clear();
    dirtyState.clear();
    flares.visible = flareCount > 0;
    flares.count = flareCount;
    if (flareCount > 0) {
      flagRange(flareGeo.attributes.flarePos, flareCount);
      flagRange(flareGeo.attributes.flareCol, flareCount);
    }

    // Update clustered highway SpotLights (dual left/right beams for nearby cars)
    hwyLitCars.length = hwyLitCount;
    if (hwyLitCount > 1) {
      hwyLitCars.sort((a, b) => a._effDist - b._effDist);
    }
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const maxHwyVeh = HWY_SPOT_POOL >> 1;
    const hwyCutoff = hwyLitCount > maxHwyVeh
      ? Math.min(HWY_LIGHT_DIST, hwyLitCars[maxHwyVeh]._effDist)
      : HWY_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < hwyLitCount && spotUsed + 2 <= HWY_SPOT_POOL; i++) {
        const c = hwyLitCars[i];
        const t = clamp((hwyCutoff - c._effDist) / Math.max(1, hwyCutoff * 0.38), 0, 1);
        const fade = (t * t * (3 - 2 * t)) * ease(Math.min(c.u, c.lane.len - c.u));
        if (fade <= 0.001) continue;
        const spec = BODY_SPECS[c.kind];
        const baseInt = HEADLIGHTS.intensity * beamScale * fade;
        // Reuse the exact rendered transform, including the road slope and underpass dip.
        c._mesh.getMatrixAt(c._slot, m4);
        for (let side = -1; side <= 1; side += 2) {
          const spot = hwySpotPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, m4);
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HWY_SPOT_POOL; i++) {
      const spot = hwySpotPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }
  }

  return { group, update, cars, lanes };
}

Object.assign(window.NYC, { createTrafficSystem, createHighwayTraffic });
})();
