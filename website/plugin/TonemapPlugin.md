---
prev: false
next: 
    text: 'DropzonePlugin'
    link: './DropzonePlugin'

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
