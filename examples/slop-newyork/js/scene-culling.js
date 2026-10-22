(function () {
// js/scene-culling.js
// Spatial culling for the island-wide static geometry. Most of Manhattan's street furniture and building massing is
// built as a handful of instanced meshes spanning the whole island (bounding spheres ~7 km across), which three.js can
// never cull: every frame the GPU transformed every lamp post, signal and facade box of the island three times (the
// view and both sun shadow cascades). This module, run once after the city is built (main.js):
// 1. Splits the instanced meshes of small props into spatial chunks, each culled by the view frustum and hidden beyond
//    the distance where its props shrink below a pixel or two (updateSceneCulling, every frame).
// 2. Gives the big static shadow casters (facade boxes, piers, viaducts...) position-only stand-ins cut into cells, on
//    a layer only the shadow cascade cameras render (they cull the cells outside the ~300 m the cascades cover); the
//    originals stop casting. The stand-ins share one material per face side, so a cell costs one draw.

const { THREE } = window.NYC;

const SHADOW_PROXY_LAYER = 3;
// Distance at which an instance of typical size s (m) is culled: about s / d * 1100 px tall on a 1300 px viewport
const CULL_PER_METRE = 1100;
const CULL_MIN = 300; // never closer: the shadow cascades reach ~300 m at street level
const CULL_MAX = 2000; // beyond this the props are kept at any distance
const PROXY_CELL = 500; // the far cascade spans ~400 m at street level: a cascade sees a few cells

const _m = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const _size = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

const triangleCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

// Typical size of an instance: sqrt(middle x largest of its extents), so thin poles count by their length and flat
// decals by their area. The 90th percentile, so the larger instances of a mesh set its cull distance.
function instanceSize(mesh) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox.getSize(_size);
  const e = mesh.instanceMatrix.array;
  const n = mesh.count;
  const step = Math.max(1, Math.floor(n / 1024));
  const sizes = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 16;
    const d = [
      Math.hypot(e[o], e[o + 1], e[o + 2]) * _size.x,
      Math.hypot(e[o + 4], e[o + 5], e[o + 6]) * _size.y,
      Math.hypot(e[o + 8], e[o + 9], e[o + 10]) * _size.z
    ].sort((p, q) => p - q);
    sizes.push(Math.sqrt(d[1] * d[2]));
  }
  sizes.sort((p, q) => p - q);
  return sizes[Math.floor(sizes.length * 0.9)] || 0;
}

function isStaticMesh(o) {
  return o.isMesh && !o.isSkinnedMesh && o.visible && o.frustumCulled !== false && !o.morphTargetInfluences;
}

function copyObjectState(dst, src) {
  dst.name = src.name;
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.renderOrder = src.renderOrder;
  dst.layers.mask = src.layers.mask;
  dst.visible = src.visible;
  dst.userData = { ...src.userData };
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.matrixAutoUpdate = src.matrixAutoUpdate;
  dst.matrix.copy(src.matrix);
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeRender')) dst.onBeforeRender = src.onBeforeRender;
  if (Object.prototype.hasOwnProperty.call(src, 'onAfterRender')) dst.onAfterRender = src.onAfterRender;
}

// One InstancedMesh per `cell` x `cell` m square of the instances' positions, sharing the source's vertex data and
// material (so the same shader pipeline) with its per-instance data split up
function chunkInstancedMesh(mesh, cell) {
  const n = mesh.count;
  const src = mesh.instanceMatrix.array;
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(src[i * 16 + 12] / cell) + ',' + Math.floor(src[i * 16 + 14] / cell);
    let ids = cells.get(key);
    if (!ids) cells.set(key, (ids = []));
    ids.push(i);
  }
  const geo0 = mesh.geometry;
  if (!geo0.boundingSphere) geo0.computeBoundingSphere();
  if (!geo0.boundingBox) geo0.computeBoundingBox();
  const attrs = Object.entries(geo0.attributes);
  const chunks = [];
  for (const ids of cells.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setIndex(geo0.index);
    for (const [name, a] of attrs) {
      if (!a.isInstancedBufferAttribute) {
        geo.setAttribute(name, a);
        continue;
      }
      const s = a.itemSize;
      const arr = new a.array.constructor(ids.length * s);
      ids.forEach((id, j) => arr.set(a.array.subarray(id * s, id * s + s), j * s));
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, s, a.normalized, a.meshPerAttribute));
    }
    for (const g of geo0.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.setDrawRange(geo0.drawRange.start, geo0.drawRange.count);
    geo.boundingSphere = geo0.boundingSphere;
    geo.boundingBox = geo0.boundingBox;

    const chunk = new THREE.InstancedMesh(geo, mesh.material, ids.length);
    ids.forEach((id, j) => chunk.instanceMatrix.array.set(src.subarray(id * 16, id * 16 + 16), j * 16));
    if (mesh.instanceColor) {
      const c = mesh.instanceColor.array;
      const arr = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => arr.set(c.subarray(id * 3, id * 3 + 3), j * 3));
      chunk.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    copyObjectState(chunk, mesh);
    chunk.computeBoundingSphere();
    chunks.push(chunk);
  }
  return chunks;
}

// A caster can stand in as bare positions only if its material neither moves its vertices nor cuts holes in it
function proxyableMaterial(mat) {
  return !!mat && !Array.isArray(mat) && !mat.transparent && !(mat.alphaTest > 0) && !mat.alphaMap &&
    !mat.positionNode && !mat.castShadowPositionNode && !mat.castShadowNode && !mat.alphaTestNode &&
    !mat.maskNode && !mat.maskShadowNode && !mat.depthNode && !mat.displacementMap;
}

/**
 * Sets up the culling of the static city under `roots` (Object3Ds). `shadow` is the SunLightShadow whose cascade
 * cameras render the shadow stand-ins (none are made without it). Returns stats; the culling itself runs in
 * updateSceneCulling().
 */
function setupSceneCulling(scene, roots, shadow = null) {
  scene.updateMatrixWorld(true);
  const stats = { chunkedMeshes: 0, chunks: 0, proxiedMeshes: 0, proxies: 0, proxyTriangles: 0 };
  const culled = [];

  // 1. Small props: chunked & distance culled
  const chunkable = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isInstancedMesh || !isStaticMesh(o) || o.count < 64 || o.count !== o.instanceMatrix.count) return;
      if (o.count * triangleCount(o.geometry) < 40000) return;
      if (!o.boundingSphere) o.computeBoundingSphere();
      if (o.boundingSphere.radius < 1500) return;
      chunkable.push(o);
    });
  }
  for (const mesh of chunkable) {
    // unlit (glowing) props, like signal lenses & lamp bulbs, read from much further away at night
    const glow = mesh.material.isMeshBasicNodeMaterial || mesh.material.type === 'MeshBasicNodeMaterial' ? 3 : 1;
    let cullDist = Math.max(CULL_MIN, instanceSize(mesh) * CULL_PER_METRE * glow);
    if (cullDist > CULL_MAX) cullDist = Infinity;
    const cell = Number.isFinite(cullDist) ? Math.min(600, Math.max(250, cullDist * 0.5)) : 0;
    if (!cell) continue; // big things (sidewalk slabs, light pools...) stay whole: chunking them would only add draws
    const parent = mesh.parent;
    const chunks = chunkInstancedMesh(mesh, cell);
    parent.remove(mesh);
    chunks.forEach((chunk, k) => {
      parent.add(chunk);
      // shader precompile: the first chunk compiles the pipeline every chunk of the mesh shares (main.js)
      if (k > 0) chunk.userData.sharesPipelineWith = chunks[0];
      chunk.updateMatrixWorld(true);
      const sphere = chunk.boundingSphere.clone().applyMatrix4(chunk.matrixWorld);
      culled.push({ mesh: chunk, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, d: cullDist });
    });
    stats.chunkedMeshes++;
    stats.chunks += chunks.length;
  }

  // 2. Shadow stand-ins for the big static casters
  const cams = [];
  if (shadow && typeof shadow.getCamera === 'function') {
    const count = typeof shadow.getViewportCount === 'function' ? shadow.getViewportCount() : 2;
    for (let i = 0; i < count; i++) {
      const cam = shadow.getCamera(i);
      if (cam && cam.layers) cams.push(cam);
    }
  }
  if (cams.length) {
    const instancedBySig = new Map(); // geometry signature + face side -> { geometry, material, cells: Map(key -> [matrices]) }
    const triCells = new Map(); // face side -> Map(key -> number[] world positions)
    const proxyMaterials = new Map();
    const proxyMaterial = (side) => {
      let m = proxyMaterials.get(side);
      if (!m) {
        m = new THREE.MeshBasicNodeMaterial({ side: side.side, color: 0x000000 });
        m.shadowSide = side.shadowSide;
        m.name = 'ShadowProxy';
        proxyMaterials.set(side, m);
      }
      return m;
    };
    const sideKeys = new Map();
    const sideOf = (mat) => {
      const k = mat.side + ',' + mat.shadowSide;
      let s = sideKeys.get(k);
      if (!s) sideKeys.set(k, (s = { side: mat.side, shadowSide: mat.shadowSide }));
      return s;
    };
    const cellKey = (x, z) => Math.floor(x / PROXY_CELL) + ',' + Math.floor(z / PROXY_CELL);

    const sources = [];
    for (const root of roots) {
      root.traverse((o) => {
        if (!o.castShadow || !isStaticMesh(o) || !proxyableMaterial(o.material)) return;
        if (o.isInstancedMesh && o.count !== o.instanceMatrix.count) return;
        const tris = triangleCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
        if (tris < 20000) return;
        let radius;
        if (o.isInstancedMesh) {
          if (!o.boundingSphere) o.computeBoundingSphere();
          radius = o.boundingSphere.radius;
        } else {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          radius = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
        }
        if (radius > 600) sources.push(o);
      });
    }

    for (const o of sources) {
      const side = sideOf(o.material);
      const geo = o.geometry;
      if (o.isInstancedMesh) {
        const pos = geo.attributes.position;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const sig = [pos.count, geo.index ? geo.index.count : -1, bb.min.toArray().map((v) => v.toFixed(3)), bb.max.toArray().map((v) => v.toFixed(3)), side.side, side.shadowSide].join('|');
        let entry = instancedBySig.get(sig);
        if (!entry) {
          const g = new THREE.BufferGeometry();
          g.setIndex(geo.index);
          g.setAttribute('position', pos);
          entry = { geometry: g, material: proxyMaterial(side), cells: new Map() };
          instancedBySig.set(sig, entry);
        }
        const e = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          _wm.multiplyMatrices(o.matrixWorld, _m.fromArray(e, i * 16));
          const key = cellKey(_wm.elements[12], _wm.elements[14]);
          let list = entry.cells.get(key);
          if (!list) entry.cells.set(key, (list = []));
          list.push(..._wm.elements);
        }
      } else {
        let bySide = triCells.get(side);
        if (!bySide) triCells.set(side, (bySide = new Map()));
        const pos = geo.attributes.position;
        const idx = geo.index;
        const start = geo.drawRange.start;
        const end = Math.min(idx ? idx.count : pos.count, start + geo.drawRange.count);
        for (let t = start; t + 2 < end; t += 3) {
          const i0 = idx ? idx.getX(t) : t;
          const i1 = idx ? idx.getX(t + 1) : t + 1;
          const i2 = idx ? idx.getX(t + 2) : t + 2;
          _a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
          _b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
          _c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
          const key = cellKey((_a.x + _b.x + _c.x) / 3, (_a.z + _b.z + _c.z) / 3);
          let list = bySide.get(key);
          if (!list) bySide.set(key, (list = []));
          list.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
        }
      }
      o.castShadow = false;
      stats.proxiedMeshes++;
    }

    const firstProxy = new Map(); // material + kind -> the stand-in that compiles their shared pipeline
    const addProxy = (mesh, tris) => {
      mesh.name = 'ShadowProxy';
      mesh.layers.set(SHADOW_PROXY_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.userData.shadowProxy = true;
      const kind = mesh.material.uuid + (mesh.isInstancedMesh ? ':i' : ':m');
      if (firstProxy.has(kind)) mesh.userData.sharesPipelineWith = firstProxy.get(kind);
      else firstProxy.set(kind, mesh);
      scene.add(mesh);
      stats.proxies++;
      stats.proxyTriangles += tris;
    };
    for (const entry of instancedBySig.values()) {
      const tris = triangleCount(entry.geometry);
      for (const list of entry.cells.values()) {
        const n = list.length / 16;
        const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, n);
        mesh.instanceMatrix.array.set(list);
        mesh.computeBoundingSphere();
        addProxy(mesh, tris * n);
      }
    }
    for (const [side, bySide] of triCells) {
      for (const list of bySide.values()) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
        g.computeBoundingSphere();
        addProxy(new THREE.Mesh(g, proxyMaterial(side)), list.length / 9);
      }
    }
    for (const cam of cams) cam.layers.enable(SHADOW_PROXY_LAYER);
  }

  state.culled = culled;
  return stats;
}

const state = { culled: [] };

// Per frame (after the warm-up frame, which must see everything): hide the chunks beyond their cull distance
function updateSceneCulling(cameraPosition) {
  const { x, y, z } = cameraPosition;
  for (const c of state.culled) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    c.mesh.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r < c.d;
  }
}

Object.assign(window.NYC, { setupSceneCulling, updateSceneCulling, SHADOW_PROXY_LAYER });
})();
