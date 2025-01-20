---
prev: 
    text: 'DropzonePlugin'
    link: './DropzonePlugin'

next: 
    text: 'SSAAPlugin'
    link: './SSAAPlugin'
---

# ProgressivePlugin

[//]: # (todo: image)

[Example](https://threepipe.org/examples/#progressive-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/src/plugins/pipeline/ProgressivePlugin.ts) &mdash;
[API Reference](https://threepipe.org/docs/classes/ProgressivePlugin.html)

Progressive Plugin adds a post-render pass to blend the last frame with the current frame.

This is used as a dependency in other plugins for progressive rendering effect which is useful for progressive shadows, gi, denoising, baking, antialiasing, and many other effects. The helper function `convergedPromise` returns a new promise that can be used to wait for the progressive rendering to converge.
