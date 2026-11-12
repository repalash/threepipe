# Changelog for @threepipe/plugin-annotations

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- ← and → are actions (`AnnotationsPlugin.actions`: `annotations.next`, `annotations.prev`), registered in `viewer.actions`, so a UI lists them and the app can change their keys; they run before the arrow keys of the camera controls (`capture`); with the focus on the page and more viewers, the viewer with the last pointer press takes them. Esc stays a key of the card. A key on a focused checkbox or button is not a key typed in a text field
- First version. `AnnotationsPlugin`: numbered markers on objects with a title, a text and a saved camera view, like Sketchfab annotations. A click on a marker flies the camera to its view and opens a card. Editable mode: add (click a surface), edit, move (drag) and delete, undoable with `UndoManagerPlugin`. Saved in the viewer config and in the exported .glb. Tour (`next`, `prev`, `playTour`) and events for an outside list. `renderAnnotationText` formats the text (bold, italic, links, bullets)
- The card in the style of the editor: a compact layout (12px sides, 8px rows), icon buttons (14px icons in 24px buttons), the tools in the bottom bar, and the colours of the Tweakpane theme (`--tp-*`, light and dark). Long text scrolls inside a card of at most 360px
- `closeOnCanvasInteraction` (default false, also in the UI folder): any interaction with the canvas closes the card, also a drag (as soon as it moves 4px) and a wheel zoom. Off, only a click on the canvas closes it
- The card has no number (the markers keep theirs). `showCloseButton` (default true) shows the ✕. `compactCard` (default false): the card shows the title and the text only (editable: Update view and Delete at its top), and a tour bar at the bottom centre has ‹ the open title ›; it fades while the user moves the camera and shows again 400 ms after (`tourBar`: `'hidden'`, `'shown'`, `'faded'`). A new icon for Update view (a viewfinder with a check)
- `renderCardContent`: a hook for the app that renders the content of the card (an HTML string, an element, or `undefined` for the default), when `editable` is off. `Annotation.data`: values of the app, saved with the annotation as plain JSON (also in `add()` and `update()`). `escapeHtml` is exported with `renderAnnotationText`
- The buttons of the card head (Update view, Delete and ✕ in `compactCard`) have one gap: the ✕ was 8px away, the others 2px. They are in one group (`.anp-head-btns`), aligned with the first line of the title
- The title and the text keep their lines when `editable` changes: the title field is a textarea with the same box and text styles as the title (it was a one-line input that did not wrap). The fields also take `letter-spacing` and `word-spacing` from the page
- `dragOnlySelected` (default true, also in the UI folder in editable mode, not saved with the scene): only the open annotation can be dragged; a click on another marker opens it, and a drag from it orbits the camera as on the canvas
- The selection is undoable in editable mode, as in `PickingPlugin`: opening another annotation or closing the card is one undo step, whose undo opens the one before (or none) without moving the camera. Undoing a delete or Remove all opens the annotation that was open. No undo steps in a viewer (not editable) or during `playTour`

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/annotations
