# @threepipe/plugin-procedural-generation

Procedural generation framework for [threepipe](https://threepipe.org) — noise, point distribution, instancing, and sample generators (terrain, buildings, cities, roads).

## Installation

```bash
npm install @threepipe/plugin-procedural-generation
```

## Usage

```typescript
import {ThreeViewer, Object3DGeneratorPlugin} from 'threepipe'
import {ProceduralGeneratorPlugin, TerrainGenerator} from '@threepipe/plugin-procedural-generation'

const viewer = new ThreeViewer({canvas, plugins: [Object3DGeneratorPlugin]})
const procGen = viewer.addPluginSync(ProceduralGeneratorPlugin)
procGen.generators.terrain = new TerrainGenerator()

const terrain = procGen.generateObject('terrain', {size: 100, resolution: 128, seed: 42})
viewer.scene.addObject(terrain)
```

## License

Apache-2.0
