---
prev:
  text: '@threepipe/plugin-troika-text'
  link: './plugin-troika-text'

next: false

aside: false
---

# @threepipe/plugin-annotations

3D annotations ("hotspots"), like Sketchfab's: numbered markers on objects, each with a title, a text and a saved camera view. A click on a marker flies the camera to its view and opens a card with the title and the text, and ‹ prev / next › buttons.

[Example](https://threepipe.org/examples/#annotations-plugin/) &mdash;
[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/annotations/src/AnnotationsPlugin.ts) &mdash;
[API Reference](https://threepipe.org/plugins/annotations/docs/classes/AnnotationsPlugin.html)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-annotations.svg)](https://www.npmjs.com/package/@threepipe/plugin-annotations)

```bash
npm install @threepipe/plugin-annotations
```

<iframe src="https://threepipe.org/examples/annotations-plugin/" style="width:100%;min-height:600px;border:none;" loading="lazy" title="Threepipe Annotations Plugin Example"></iframe>

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {AnnotationsPlugin} from '@threepipe/plugin-annotations'

const viewer = new ThreeViewer({canvas, plugins: [UndoManagerPlugin]})
// editable: false (the default) for visitors, who only open the annotations
const annotations = viewer.addPluginSync(new AnnotationsPlugin({editable: true}))

// the next click on a surface places an annotation there, with the current camera view (Esc cancels)
annotations.startAdding()

// or from code: an object, a point and a normal in its local space, a view (default: the current one) and the content
const a = annotations.add(object, localPoint, localNormal, undefined, {title: 'Stone', text: '**Round brilliant**'})
annotations.update(a.id, {text: 'A 1 ct round brilliant'})

annotations.goTo(0) // fly to the view of the first annotation and open its card
annotations.next()
annotations.playTour(5000) // one after another, any click or key stops it

annotations.addEventListener('annotationChange', e => console.log(e.reason, annotations.getAnnotations()))
annotations.addEventListener('annotationSelect', e => console.log('open', e.annotation?.title))
```

## What it does

- **Markers follow the objects.** An annotation is attached to an object with a point and a normal in the object's local space, so its marker moves when the object moves or animates. Markers behind geometry, or on a surface that faces away from the camera, are dimmed. The occlusion test casts a few rays per frame (`occlusionRaysPerFrame`), only after the camera, an anchor or the scene changed, and while frames render (an animation that moves other geometry) at most every `occlusionRecheckInterval` ms (200).
- **The camera flies to the view.** Each annotation keeps a camera view (position, target, zoom, field of view). A click on the marker animates the camera to it with `PopmotionPlugin` (`animDuration`, shorter for short moves). A view of `null` keeps the camera.
- **Saved with the scene.** `annotations` is a serialized property: it is in the viewer config, and `viewer.exportScene({viewerConfig: true})` writes it into the .glb. Loading the file restores the annotations. An annotation finds its object by the object's uuid (the glTF export keeps it), or by the path of names from the model root when the uuid is not found.
- **Editable mode** (`editable`, also in the UI folder): "Add annotation" (`startAdding`, then click a surface), edit the title and the text in the card, "Update view" saves the current camera view, "Delete", and drag a marker to another point of a surface. Every edit is one undo step with `UndoManagerPlugin`.
- **Text formatting.** The text is plain text with line breaks; `**bold**`, `*italic*`, `- ` bullets, `[label](https://…)` and bare `https://` links show formatted (`renderAnnotationText`). All other text is escaped.
- **Keys.** ← / → go to the previous and next annotation while a card is open, Esc closes the card or cancels placing.

## Notes

- The markers and the card are in a layer over the canvas (`z-index: 110`), in the viewer container. The container must be positioned (for example `position: relative`) for the layer to cover only the canvas.
- The styles use the `anp-` classes. `AnnotationsPlugin.InjectStyles = false` before adding the plugin leaves the styling to the page. The markers and the card take their colours from the `--tp-*` variables of the Tweakpane theme on the page (light or dark), like the editor's notes; without them, they are light.
- The plugin UI (with `TweakpaneUiPlugin`: `ui.setupPluginUi(AnnotationsPlugin)`) has Editable, Add annotation, Play tour and Remove all.
