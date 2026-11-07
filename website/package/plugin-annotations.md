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

- **Markers follow the objects.** An annotation is attached to an object with a point and a normal in the object's local space, so its marker moves when the object moves or animates. On an `InstancedMesh`, the anchor also keeps the instance (`instanceId`), in that instance's space, so it follows the instance. Markers behind geometry, or on a surface that faces away from the camera, are dimmed. The occlusion test casts a few rays per frame (`occlusionRaysPerFrame`), only after the camera, an anchor or the scene changed, and while frames render (an animation that moves other geometry) at most every `occlusionRecheckInterval` ms (200).
- **The camera flies to the view.** Each annotation keeps a camera view (position, target, zoom, field of view). A click on the marker animates the camera to it with `PopmotionPlugin` (`animDuration`, shorter for short moves). A view of `null` keeps the camera.
- **Saved with the scene.** `annotations` is a serialized property: it is in the viewer config, and `viewer.exportScene({viewerConfig: true})` writes it into the .glb. Loading the file restores the annotations. An annotation finds its object by the object's uuid (the glTF export keeps it), or, after a load, by the path of names from the model root when the uuid is not found. Once found, it stays on that object: when the object leaves the scene the marker hides, and it shows again when the object is back.
- **Editable mode** (`editable`, also in the UI folder): "Add annotation" (`startAdding`, then click a surface), edit the title and the text in the card, "Update view" saves the current camera view, "Delete", and drag a marker to another point of a surface. Every edit is one undo step with `UndoManagerPlugin`. The title field wraps like the title, so the card keeps its lines when `editable` changes.
- **Selection.** In editable mode the open annotation is the selection, as in the `PickingPlugin`: opening another annotation (a click on its marker, ‹ ›, ← →) or closing the card is one undo step, and its undo opens the annotation before, or none, without moving the camera. Undoing a delete brings the annotation back opened, and the next undo restores the selection before it. Not editable (a viewer) and during `playTour`, opening adds no undo steps.
- **Drag only the selected marker** (`dragOnlySelected`, default `true`, in the UI folder in editable mode): only the open annotation can be dragged. A click on another marker opens it, and a drag from it orbits the camera as a drag on the canvas does. Off, a drag on any marker moves it. Like `editable`, it is not saved with the scene.
- **Text formatting.** The text is plain text with line breaks; `**bold**`, `*italic*`, `- ` bullets, `[label](https://…)` and bare `https://` links show formatted (`renderAnnotationText`). All other text is escaped.
- **Keys.** ← / → go to the previous and next annotation while a card is open: they are actions (`annotations.prev`, `annotations.next`), so a [CommandsPlugin](../plugin/CommandsPlugin) lists them and the app can change their keys. Esc closes the card or cancels placing (a key of the card). With more viewers on the page, the keys go to the viewer that has the focus (its canvas, its card); with the focus on the page, ← / → go to the viewer with the last pointer press, and Esc to the viewer used last.
- **Closing the card.** The card stays open until its close button, Esc, or a click (no drag) on the canvas; it stays while the camera orbits. With `closeOnCanvasInteraction` (default `false`, also in the UI folder), any interaction with the canvas closes it: a click, a drag (orbit, a touch drag or a pinch) as soon as the pointer moves 4 px, and a wheel zoom. Only the primary button and touch count, and not while placing or dragging a marker. A click on a marker opens that marker's card. Like `editable`, the option is set by the page and is not saved with the scene.
- **Card options** (also in the UI folder, not saved with the scene). `showCloseButton` (default `true`) shows the ✕ of the card; without it, Esc and a click on the canvas still close the card. `compactCard` (default `false`) is for a viewer with a tour, like Sketchfab's: the card shows the title and the text only, and a dark tour bar at the bottom centre has ‹ the title of the open annotation › (← / → work too). In editable mode, "Update view" and "Delete" move to the top of the card, before the ✕. The bar shows while an annotation is open (also during `playTour`), fades while the user moves the camera (a drag past 4 px or a wheel on the canvas), and shows again 400 ms after the pointer up or the last wheel event. `tourBar` reads its state: `'hidden'`, `'shown'` or `'faded'`.

## Custom card

An app can render the content of the card itself: `renderCardContent` gets the annotation and returns HTML (a string), an element, or `undefined` for the default content. It replaces the title and the text; the ✕ stays in the top-right corner (the content keeps room for it on the right), and the ‹ › of the card and the tour bar of `compactCard` work as before. Each annotation has a free `data` field for the app's values (a price, a product id), saved with it in the viewer config and the .glb as plain JSON. The default card never shows `data`.

```typescript
import {escapeHtml, renderAnnotationText} from '@threepipe/plugin-annotations'

const stone = annotations.add(object, localPoint, localNormal, undefined, {title: 'Stone', text: '**Round brilliant**', data: {price: 1200, sku: 'RB-100'}})
annotations.update(stone.id, {data: {price: 990, sku: 'RB-100'}}) // a new object, undoable

annotations.renderCardContent = (a, {index, count}) => {
    if (a.data?.price === undefined) return undefined // the default card
    return `<b>${escapeHtml(a.title)}</b>
        <div>${renderAnnotationText(a.text)}</div>
        <p>$${escapeHtml(String(a.data.price))} · ${index + 1} of ${count}</p>`
}
```

- **When it runs.** When an annotation opens, when the annotations change (also `update` of `data`), and when the hook is set. Set it again to render the open card again for app state that it reads. An error in the hook is logged, and the default card shows.
- **Editable mode.** The hook is used only when `editable` is off. In editable mode the default editor card shows, so the title and the text stay editable.
- **Security.** A string is set as the HTML of the card as is. The title, the text and `data` come from the loaded file, so escape them: `escapeHtml(value)` for plain values, `renderAnnotationText(text)` for the formatted text (both escape everything else). Do not put unescaped file or user values into the HTML.
- **Clicks and keys.** A click, a drag or a wheel in the content does not reach the viewer, and Esc and ← → work as in the default card. Keys typed in an `<input>` or a `<textarea>` in the content stay there.

## Notes

- The markers and the card are in a layer over the canvas (`z-index: 110`), in the viewer container. The container must be positioned (for example `position: relative`) for the layer to cover only the canvas.
- The styles use the `anp-` classes (the tour bar: `.anp-bar`, with `data-state` set to `tourBar`). `AnnotationsPlugin.InjectStyles = false` before adding the plugin leaves the styling to the page. The markers and the card take their colours from the `--tp-*` variables of the Tweakpane theme on the page (light or dark), like the editor's notes; without them, they are light.
- The plugin UI (with `TweakpaneUiPlugin`: `ui.setupPluginUi(AnnotationsPlugin)`) has Editable, Drag only selected, Close on canvas interaction, Close button, Compact card, Add annotation, Play tour and Remove all.
