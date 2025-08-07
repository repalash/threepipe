---
prev:
  text: '@threepipe/plugin-assimpjs'
  link: './plugin-assimpjs'

next:
  text: '@threepipe/plugin-timeline-ui'
  link: './plugin-timeline-ui'

---

# @threepipe/plugin-path-tracing

Provides plugin(s) for [path-tracing](https://en.wikipedia.org/wiki/Path_tracing).

Exports 
- [ThreeGpuPathTracer](https://threepipe.org/plugins/path-tracing/docs/classes/ThreeGpuPathTracer.html) - adds support for full scene path tracing with GPU acceleration using [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)

It provides options to configure the path tracing parameters such as bounces, samples per frame, and more.

It also integrates with the Three.js scene and camera, updating materials and lights as needed.

Serialization and deserialization are supported for plugin state management.

It listens to scene updates, camera changes, and material updates to refresh the path tracing setup.

It can be enabled or disabled, and it automatically handles rendering to the screen or to a texture.

It supports progressive rendering, allowing for a smooth transition of rendered frames.

[Example](https://threepipe.org/examples/#three-gpu-pathtracer/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/path-tracing/src/index.ts) &mdash;
[API Reference](https://threepipe.org/plugins/path-tracing/docs)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-path-tracing.svg)](https://www.npmjs.com/package/@threepipe/plugin-path-tracing)

```bash
npm install @threepipe/plugin-path-tracing
```

::: warning Note
This is still a WIP.
:::

:::tip Editor
Path tracing rendering can be done directly in the [tweakpane editor](https://threepipe.org/examples/tweakpane-editor/) or [threepipe editor](https://editor.threepipe.org/). 

Simply enable the plugin from the UI.
:::

## Sample Usage 

To use the plugin, simply add it to the viewer.

The plugin automatically interfaces with the `ProgressivePlugin` to render upto `maxFrameCount`.
The samples are rendered whenever the plugin is enabled and the camera is not moving.

The `WebGLPathTracer` instance in the plugin can be accessed via `viewer.getPlugin(ThreeGpuPathTracer).tracer` property or edited in the UI.

```typescript
import {ThreeViewer} from 'threepipe'
import {ThreeGpuPathTracer} from '@threepipe/plugin-path-tracing'

const viewer = new ThreeViewer({...})
const pathTracer = viewer.addPluginSync(new ThreeGpuPathTracer(false)) // add the plugin disabled
console.log(pathTracer.tracer) // access the path tracer instance

// load files and environment

pathTracer.enabled = true // enable the plugin to start rendering
```

Check the [three-gpu-pathtracer](https://threepipe.org/examples/#three-gpu-pathtracer/) example for a live demo.
