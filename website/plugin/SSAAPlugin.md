---
prev: 
    text: 'ProgressivePlugin'
    link: './ProgressivePlugin'

next: 
    text: 'DepthBufferPlugin'
    link: './DepthBufferPlugin'

---

# SSAAPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#ssaa-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/SSAAPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/SSAAPlugin.html)

SSAA Plugin adds support for [Super Sampling Anti-Aliasing](https://en.wikipedia.org/wiki/Supersampling) to the viewer. Simply add the plugin to the viewer to use it.

It jitters the camera view offset over multiple frames, which are then blended by the [ProgressivePlugin](./ProgressivePlugin) to create a higher quality image. This is useful for reducing aliasing artifacts in the scene.

By default, the pipeline only renders once per request animation frame. So we don't get any antialiasing while moving. For that, either use the TAA(Temporal Anti-aliasing) plugin or for the case of simple scenes - render multiple times per frame which can be done by setting `plugin.rendersPerFrame` or `viewer.rendersPerFrame`. Check out the [example](https://threepipe.org/examples/#ssaa-plugin/) to see the effect on frame rate.

```typescript

const ssaa = viewer.addPluginSync(new SSAAPlugin())

ssaa.enabled = true // toggle jittering(if you want to set custom view offset)

ssaa.rendersPerFrame = 4 // render 4 times per frame (max 32 is useful)
```
