# @threepipe/plugin-procedural-generation

## 0.1.0

- Initial release
- Core utilities: SeededRandom, Noise (simplex, fbm, ridged, voronoi)
- Geometry primitives: grid, wallGrid, extrudedPolygon, profileExtrude
- Base class: AProceduralGenerator with generate(params, rng) pattern
- Plugin: ProceduralGeneratorPlugin with Object3DGeneratorPlugin integration
- Sample generator: TerrainGenerator (noise displacement, vertex coloring, water plane)
