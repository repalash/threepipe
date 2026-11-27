# @threepipe/plugin-annotations

3D annotations for [threepipe](https://threepipe.org/), like Sketchfab's: numbered markers on objects with a title, a text and a saved camera view. A click on a marker flies the camera to its view and opens a card. In the editable mode, add, edit, move and delete them. They are saved in the viewer config and in the exported .glb.

[Github](https://github.com/repalash/threepipe/tree/dev/plugins/annotations) &mdash;
[Example](https://threepipe.org/examples/#annotations-plugin/) &mdash;
[API Reference](https://threepipe.org/plugins/annotations/docs/)

[![NPM Package](https://img.shields.io/npm/v/@threepipe/plugin-annotations.svg)](https://www.npmjs.com/package/@threepipe/plugin-annotations)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](https://opensource.org/license/apache-2-0/)

**Documentation and Guides**: [threepipe.org/package/plugin-annotations](https://threepipe.org/package/plugin-annotations.html)

```bash
npm install @threepipe/plugin-annotations
```

```typescript
import {ThreeViewer, UndoManagerPlugin} from 'threepipe'
import {AnnotationsPlugin} from '@threepipe/plugin-annotations'

const viewer = new ThreeViewer({canvas, plugins: [UndoManagerPlugin]})
const annotations = viewer.addPluginSync(new AnnotationsPlugin({editable: true}))

annotations.startAdding() // the next click on a surface places an annotation, with the current camera view
annotations.add(object, localPoint, localNormal, undefined, {title: 'Stone', text: '**Round brilliant**'})
annotations.goTo(0) // fly to the view of the first one and open its card
annotations.playTour(5000)
annotations.closeOnCanvasInteraction = true // any click, drag or wheel zoom on the canvas closes the card
annotations.compactCard = true // title and text only, ‹ title › in a tour bar at the bottom that fades while the camera moves
annotations.showCloseButton = false // no ✕ in the card (Esc and a click on the canvas still close it)
annotations.dragOnlySelected = false // editable: drag any marker (default: only the open one; a drag from another orbits)
```

A custom card from the app's values (`data` is saved with the annotation; the hook is used when `editable` is off):

```typescript
import {escapeHtml, renderAnnotationText} from '@threepipe/plugin-annotations'

annotations.add(object, localPoint, localNormal, undefined, {title: 'Stone', text: 'Round brilliant', data: {price: 1200}})
annotations.renderCardContent = (a) => a.data?.price === undefined ? undefined : // undefined: the default card
    `<b>${escapeHtml(a.title)}</b><div>${renderAnnotationText(a.text)}</div><p>$${escapeHtml(String(a.data.price))}</p>`
```

A string from the hook is set as HTML as is: escape the values that come from a file or a user.
