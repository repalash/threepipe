# @threepipe/plugin-procedural-generation

Procedural generation framework for [threepipe](https://threepipe.org) — reactive node graphs, Blender geometry node ports, noise, terrain, and building generation.

## Installation

```bash
npm install @threepipe/plugin-procedural-generation
```

## Modules

### Node Graph System
A pull-based reactive graph for defining computation pipelines with selective recompute and auto-generated UI. See [Graph System Guide](./docs/graph.md).

```typescript
import {defineNode, defineGraph, connect, createRuntime, graphUiConfig} from '@threepipe/plugin-procedural-generation'
```

### Blender Built-in Ports
TypeScript ports of Blender's internal functions — Jenkins hash, Random Value node, geometry node operations. Each links to the original Blender source.

```typescript
import {hash2, hash_to_float2, randomInt, randomFloat, randomBool} from '@threepipe/plugin-procedural-generation'
import {meshToCurveSplitTrim, alignEulerToEdgeNormal, resampleCurve} from '@threepipe/plugin-procedural-generation'
```

### Generators
Sample generators using the framework:

- **TerrainGenerator** — noise terrain with erosion, vertex coloring, water plane
- **BuildingGenerator** — simple box-assembly building
- **VegetationScatterGenerator** — Poisson/random distribution + instancing
- **buildifyBuilding** — Blender Buildify-accurate building with walls, pillars, props

### ProceduralGeneratorPlugin
Viewer plugin with dirty-flag frame coalescing and UI injection for any generator.

```typescript
import {ProceduralGeneratorPlugin, TerrainGenerator} from '@threepipe/plugin-procedural-generation'

const viewer = new ThreeViewer({canvas, plugins: [Object3DGeneratorPlugin]})
const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin)
procGen.generators.terrain = new TerrainGenerator()
const terrain = procGen.generateObject('terrain', {size: 100, resolution: 128, seed: 42})
```

## Examples

- [Buildify Demo 1](../../examples/buildify-demo-1/) — Blender-accurate building, monolithic
- [Buildify Demo 2](../../examples/buildify-demo-2/) — Same building using the node graph system
- [Procedural Terrain](../../examples/procedural-terrain-basic/) — Noise terrain with UI
- [Procedural Building Modular](../../examples/procedural-building-modular/) — Original Buildify reference comparison

## License

Apache-2.0
