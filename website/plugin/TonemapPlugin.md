---
prev:
    text: 'GLTFMeshOptDecodePlugin'
    link: './GLTFMeshOptDecodePlugin'

next:
    text: 'VignettePlugin'
    link: './VignettePlugin'

---

# TonemapPlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#tonemap-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/postprocessing/TonemapPlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/TonemapPlugin.html)

TonemapPlugin adds a post-processing material extension to the ScreenPass in render manager
that applies tonemapping to the color. The tonemapping operator can be changed
by setting the `toneMapping` property of the plugin. The default tonemapping operator is `ACESFilmicToneMapping`.

Other Tonemapping properties can be like `exposure`, `contrast` and `saturation`

TonemapPlugin is added by default in ThreeViewer unless `tonemap` is set to `false` in the options.

A material can opt out of tone mapping with `material.userData.gBufferData.tonemapEnabled = false` (or the legacy `userData.postTonemap = false`). The plugin writes this to the GBuffer flags, so it applies only when the screen pass reads them (with the `GBufferPlugin`); without the flags every pixel is tone mapped. `tonemap.isMaterialTonemapped(material)` returns whether the screen pass tone maps a material, and the [material previews](../notes/material-previews) use it.
