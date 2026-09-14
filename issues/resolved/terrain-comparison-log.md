# Terrain Generator Comparison Log

## Repos Downloaded
- [x] THREE.Terrain (IceCreamYou) — `.repos/THREE.Terrain/`
- [x] threejs-ballooning (alexanderperrin) — `.repos/threejs-ballooning/`
- [x] threejs-procedural-building-generator — `.repos/threejs-procedural-building-generator/`
- [x] threex-proceduralcity — `.repos/threex-proceduralcity/`
- [x] city-generator — `.repos/city-generator/`

## Key Findings

### THREE.Terrain
- Diamond-Square, Fault-line, Hill accumulation, Weierstrass, Particle deposition algorithms
- **Turbulence transform**: `abs(h*2-1)` creates dramatic cliff faces — we should add this
- **Geographic influence shapes**: Mesa, Volcano, Dome, Valley compositable onto terrain
- **Texture blending material**: GLSL shader blending multiple textures by height+slope (much better than vertex colors)
- **Mesh scattering**: built-in scatter with slope/height/noise filtering
- Multi-pass composition of different generators

### threejs-ballooning
- **Valley/river carving**: `1/abs(x - warpedCenter)` for natural river valleys
- **Slope-based GLSL coloring**: per-pixel precision, better than per-vertex
- **Fresnel rim glow**: `pow(1 - dot(viewDir, normal), 5)` for atmospheric silhouette highlight
- **Noise-modulated terracing**: terracing only appears in some areas based on noise

## Techniques We're Missing (Priority)
1. Turbulence transform (one-liner, huge visual impact) — **added to showcase example**
2. Geographic influence shapes (mesa, volcano) — future phase
3. Texture blending material (GLSL shader) — Phase 5 ProceduralTerrainMaterialExtension
4. Fresnel rim glow — could be a material extension
5. Per-pixel slope coloring in shader — Phase 5

## New Example Created
- `examples/procedural-terrain-showcase/` — combines best techniques from all sources
  - Ridged multifractal + domain warp + turbulence + island falloff
  - 30k droplet erosion + thermal + terracing
  - 9-color cinematic palette with beach sand blending
  - SSAO + Bloom + SSR post-processing
  - Turquoise water with reflections
