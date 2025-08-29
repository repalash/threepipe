---
prev:
  text: '@threepipe/plugin-r3f'
  link: './plugin-r3f'

next: false

aside: false
---

# @threepipe/plugin-troika-text

[Troika Three Text](https://github.com/protectwise/troika/tree/main/packages/troika-three-text) provides high quality text rendering in Three.js scenes, using signed distance fields (SDF) and antialiasing using standard derivatives.

This plugin adds support for [troika text](https://protectwise.github.io/troika/troika-three-text/) objects with uiconfig, g-buffer and serialization support.

It also adds a generator to the `Object3DGeneratorPlugin` to create text objects from the UI, which can then be saved in glTF and loaded back with the plugin.

[Example](https://threepipe.org/examples/#troika-text-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/troika-text/src/TimelineUiPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/troika-text/docs/classes/TimelineUiPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-troika-text.svg)](https://www.npmjs.com/package/@threepipe/plugin-troika-text)

```bash
npm install @threepipe/plugin-troika-text
```

<iframe src="https://threepipe.org/examples/troika-text-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Troika Text Plugin Example"></iframe>

Includes `TroikaTextPlugin` that exposes API to create and update troika text objects, attaches object extension to objects in scene with troika text properties for editable UI, and handles serialization and deserialization of text data by storing it in `userData`.

To use the plugin, simply add it to the viewer or editor:

```typescript
import { ThreeViewer } from 'threepipe';
import { TroikaTextPlugin } from '@threepipe/plugin-troika-text';

const viewer = new ThreeViewer({...});
const root = document.body // set a custom html root to add the timeline panel, document.body is the default if not passed
const troikaText = viewer.addPluginSync(new TroikaTextPlugin());

// Create a text object
const textObj = troikaText.createText({
    text: 'Hello, ThreePipe!',
    fontSize: 1,
    position: { x: 0, y: 1, z: 0 }
});
// add it to the scene
viewer.scene.addObject(textObj);

// or use the Object3DGeneratorPlugin to create text objects from the UI or API
const textObj2 = viewer.getPlugin(Object3DGeneratorPlugin)?.generate('troika-text-plane', {text: 'Hello'})

// Update a text object
troikaText.updateText(textObj, {
    text: 'Updated Text',
    fontSize: 2,
});

```
