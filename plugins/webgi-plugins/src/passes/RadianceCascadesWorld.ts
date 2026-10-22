import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    DataTexture,
    DirectionalLight,
    FloatType,
    IObject3D,
    IWebGLRenderer,
    LinearFilter,
    Material,
    Matrix3,
    Mesh,
    NearestFilter,
    RGBAFormat,
    ShaderMaterial,
    Texture,
    Vector3,
    WebGLRenderTarget,
    FullScreenQuad,
} from 'threepipe'
import {FloatVertexAttributeTexture, MeshBVH, MeshBVHUniformStruct, SAH} from 'three-mesh-bvh'

/**
 * World-space data for the far cascades of the radiance cascades GI (proof of concept B, IJ-851): one BVH of every
 * visible opaque mesh in world space (three-mesh-bvh), per-vertex normals and material indices, and a material table
 * (mean albedo and emission). Light at a hit that the screen does not show is shaded from the sun (with a shadow ray),
 * the mean environment radiance above and below the horizon, and the emission; textures count by their mean color.
 */
export class RadianceCascadesWorld {
    readonly bvh = new MeshBVHUniformStruct()
    readonly normals = new FloatVertexAttributeTexture()
    readonly materialIndex = new FloatVertexAttributeTexture()
    materials?: DataTexture
    triangles = 0
    readonly bounds = new Box3()
    readonly sunDirection = new Vector3(0, 1, 0)
    readonly sunRadiance = new Vector3()
    readonly envUp = new Vector3()
    readonly envDown = new Vector3()
    private _built = false

    get built() {
        return this._built
    }

    /**
     * Builds the BVH and the material table from the visible meshes under root. Transmissive and mostly transparent
     * materials are left out (glass would block the sun and the sky).
     */
    build(root: IObject3D, renderer: IWebGLRenderer) {
        root.updateMatrixWorld(true)
        const meshes: Mesh[] = []
        root.traverseVisible((o: any) => {
            if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return
            const m = (Array.isArray(o.material) ? o.material[0] : o.material) as any
            if (!m || m.visible === false || m.userData?.pluginsDisabled) return
            if ((m.transmission ?? 0) > 0 || m.transparent && (m.opacity ?? 1) < 0.5) return
            meshes.push(o)
        })
        const materials: Material[] = []
        const matIndex = new Map<Material, number>()
        let vertexCount = 0, indexCount = 0
        for (const mesh of meshes) {
            vertexCount += mesh.geometry.attributes.position.count
            indexCount += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count
        }
        const positions = new Float32Array(vertexCount * 3)
        const normals = new Float32Array(vertexCount * 3)
        const matAttr = new Float32Array(vertexCount)
        const index = new Uint32Array(indexCount)
        const v = new Vector3(), nm = new Matrix3()
        let vo = 0, io = 0
        for (const mesh of meshes) {
            const g = mesh.geometry
            const pos = g.attributes.position, nrm = g.attributes.normal
            nm.getNormalMatrix(mesh.matrixWorld)
            const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]
            const ids = mats.map(m => {
                if (!matIndex.has(m)) { matIndex.set(m, materials.length); materials.push(m) }
                return matIndex.get(m)!
            })
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
                positions.set([v.x, v.y, v.z], (vo + i) * 3)
                if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize()
                else v.set(0, 1, 0)
                normals.set([v.x, v.y, v.z], (vo + i) * 3)
                matAttr[vo + i] = ids[0]
            }
            const count = g.index ? g.index.count : pos.count
            for (let i = 0; i < count; i++) index[io + i] = vo + (g.index ? g.index.getX(i) : i)
            // Multi-material meshes: the vertices of each group take its material (a vertex shared by two groups
            // keeps the last one).
            if (mats.length > 1) for (const grp of g.groups) {
                const id = ids[grp.materialIndex ?? 0] ?? ids[0]
                for (let i = grp.start; i < Math.min(count, grp.start + grp.count); i++) matAttr[index[io + i]] = id
            }
            vo += pos.count
            io += count
        }
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        geometry.setIndex(new BufferAttribute(index, 1))
        geometry.computeBoundingBox()
        this.bounds.copy(geometry.boundingBox!)
        const bvh = new MeshBVH(geometry, {strategy: SAH, maxLeafTris: 8})
        this.bvh.updateFrom(bvh)
        this.normals.updateFrom(new BufferAttribute(normals, 3))
        this.materialIndex.updateFrom(new BufferAttribute(matAttr, 1))
        this.triangles = indexCount / 3

        // Material table: texel 2i = mean albedo (color x mean of the map), 2i + 1 = emission (emissive x intensity x
        // mean of the emissive map).
        const data = new Float32Array(Math.max(1, materials.length) * 2 * 4)
        const meanOf = textureMeans(renderer)
        materials.forEach((m: any, i) => {
            const map = meanOf(m.map), emap = meanOf(m.emissiveMap)
            const c = m.color ?? {r: 0.5, g: 0.5, b: 0.5}
            data.set([c.r * map[0], c.g * map[1], c.b * map[2], 1], i * 8)
            const e = m.emissive ?? {r: 0, g: 0, b: 0}, ei = m.emissiveIntensity ?? 1
            data.set([e.r * ei * emap[0], e.g * ei * emap[1], e.b * ei * emap[2], 1], i * 8 + 4)
        })
        meanOf.dispose()
        this.materials?.dispose()
        this.materials = new DataTexture(data, Math.max(1, materials.length) * 2, 1, RGBAFormat, FloatType)
        this.materials.minFilter = this.materials.magFilter = NearestFilter
        this.materials.needsUpdate = true
        this._built = true
    }

    /**
     * Layout of a world probe grid of about `probes` probes over the scene bounds (cubic cells, at least one per axis),
     * and its atlas tiles (rcGrid.glsl).
     */
    gridLayout(probes: number) {
        const size = this.bounds.getSize(new Vector3()).max(new Vector3(1e-3, 1e-3, 1e-3))
        const s = Math.cbrt(size.x * size.y * size.z / probes)
        const dims = new Vector3(Math.max(1, Math.ceil(size.x / s)), Math.max(1, Math.ceil(size.y / s)), Math.max(1, Math.ceil(size.z / s)))
        const cell = size.clone().divide(dims)
        const total = dims.x * dims.y * dims.z
        const tilesX = Math.ceil(Math.sqrt(total))
        return {min: this.bounds.min.clone(), cell, dims, tilesX, tilesY: Math.ceil(total / tilesX)}
    }

    /**
     * Sun (the first visible directional light) and mean environment radiance above and below the horizon (skipped
     * with sunOnly: reading the environment back is slow, so it runs only when the environment changes).
     */
    updateLights(root: IObject3D, environment: Texture|null, envIntensity: number, renderer: IWebGLRenderer, sunOnly = false) {
        this.sunRadiance.set(0, 0, 0)
        let found = false
        root.traverseVisible((o: any) => {
            if (found || !o.isDirectionalLight || !(o.intensity > 0)) return
            const l = o as DirectionalLight
            const p = new Vector3(), t = new Vector3()
            l.getWorldPosition(p)
            l.target.getWorldPosition(t)
            this.sunDirection.copy(p.sub(t).normalize())
            this.sunRadiance.set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity)
            found = true
        })
        if (sunOnly) return
        const [up, down] = environmentMeans(renderer, environment)
        this.envUp.copy(up).multiplyScalar(envIntensity)
        this.envDown.copy(down).multiplyScalar(envIntensity)
    }

    dispose() {
        this.materials?.dispose()
        this.materials = undefined
        this._built = false
    }
}

// Mean color of textures, read on the GPU from their smallest mip (also works for compressed textures).
function textureMeans(renderer: IWebGLRenderer) {
    const target = new WebGLRenderTarget(1, 1, {type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter})
    const material = new ShaderMaterial({
        uniforms: {map: {value: null}},
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D map; void main() { vec4 s = vec4(0.0); for (int i = 0; i < 16; i++) s += textureLod(map, vec2(float(i % 4) + 0.5, float(i / 4) + 0.5) / 4.0, 20.0); gl_FragColor = s / 16.0; }',
    })
    const quad = new FullScreenQuad(material)
    const cache = new Map<Texture, number[]>()
    const buf = new Float32Array(4)
    const fn = (tex?: Texture|null): number[] => {
        if (!tex) return [1, 1, 1]
        if (cache.has(tex)) return cache.get(tex)!
        material.uniforms.map.value = tex
        const prev = renderer.getRenderTarget()
        renderer.setRenderTarget(target)
        quad.render(renderer)
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buf)
        renderer.setRenderTarget(prev)
        // WebGL2 stores sRGB maps in sRGB formats, so the sampler returns linear values.
        const r = [buf[0], buf[1], buf[2]]
        cache.set(tex, r)
        return r
    }
    fn.dispose = () => { target.dispose(); material.dispose(); quad.dispose() }
    return fn
}

// Mean radiance of an equirectangular environment above and below the horizon (solid-angle weighted).
function environmentMeans(renderer: IWebGLRenderer, env: Texture|null): [Vector3, Vector3] {
    const up = new Vector3(), down = new Vector3()
    if (!env || (env as any).isCubeTexture || !env.image) return [up.set(0.5, 0.5, 0.5), down.set(0.2, 0.2, 0.2)]
    const W = 64, H = 32
    const target = new WebGLRenderTarget(W, H, {type: FloatType, minFilter: LinearFilter, magFilter: LinearFilter})
    const material = new ShaderMaterial({
        uniforms: {map: {value: env}},
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = textureLod(map, vUv, 4.0); }',
    })
    const quad = new FullScreenQuad(material)
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    quad.render(renderer)
    const buf = new Float32Array(W * H * 4)
    renderer.readRenderTargetPixels(target, 0, 0, W, H, buf)
    renderer.setRenderTarget(prev)
    target.dispose(); material.dispose(); quad.dispose()
    let wu = 0, wd = 0
    for (let y = 0; y < H; y++) {
        const lat = ((y + 0.5) / H - 0.5) * Math.PI // texture v = 0 is the bottom (south) in three's equirect mapping
        const w = Math.cos(lat)
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4
            const t = lat > 0 ? up : down
            t.x += buf[i] * w; t.y += buf[i + 1] * w; t.z += buf[i + 2] * w
            if (lat > 0) wu += w; else wd += w
        }
    }
    return [up.multiplyScalar(1 / Math.max(wu, 1e-6)), down.multiplyScalar(1 / Math.max(wd, 1e-6))]
}
