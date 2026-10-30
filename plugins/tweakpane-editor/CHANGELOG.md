# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- `NotesPlugin`: a list of notes, each kept in a store: `file` (serialized, so saved in the viewer config and in an exported .glb), `browser` (`localStorage`, `BrowserNotesStore`), or a store of the app (`NotesStore`, `addStore`; `HttpNotesStore` for a server). Changes are saved per store 600 ms after the last one; notes made while a store loads are kept. Events `notesChanged` (with the note, or the notes that `clear` or a replaced store removed) and `storeStatusChanged`; `contextLine()` gives the time, the context and the selected names. Its UI folder, `Notes`, has the settings.
- `StickyNotesUiPlugin`: the notes as post-its over the canvas, in the `board` layout (a post-it per note; new ones, and "Arrange", inside the canvas and above the dock, also on a phone) or the `stack` layout (a pile that goes to the left and up; a click brings a post-it up), or `minimized` (off the canvas; one button with the number of notes brings back the layout from before). "+ Note" adds a note at once ("▾" picks the store), a badge moves a note to another store, "+ Context", "Copy" and "×" per note (the text is 16 px on a touch screen, so a phone does not zoom in on it); post-its are dragged by their bar and sized from their corner, and glide between layouts. The layout, the colour, the places, the sizes and the order are kept in `localStorage`. Its UI folder, `Sticky Notes`, has the settings; `dock` holds its buttons. The post-its show above the loading screen, and their menus with the popups of the page. The `notes-plugin` example and the Extras mode of the tweakpane editor example show both.
- Add `SelectionUxPlugin` (part 1, the selection model): Figma-like click and key selection in the viewport. A click selects the outermost group (a group with a single child is one level with it, a file root passes the click to its parts), a double click goes one level in, a click again on the same spot selects the object behind, Shift adds or removes, Ctrl/Cmd selects the deepest object; Esc / Shift+Enter parent, Enter children, Tab siblings, Ctrl/Cmd+A the level. The selection stays in the `PickingPlugin` (one undo step per change). A UI folder with an Enabled toggle; not saved in the viewer config, as the other editor plugins. Not added to the editor by default. Example `selection-ux-plugin`.
- `SelectionUxPlugin` (part 2, the overlay): draws the selection over the canvas, with the box of the selection (`boxStyle`: screen rectangle, 3D box or its corners), a box for each object of a multiple selection, the box of the hovered object, the name with its parent levels (a click on a parent selects it) and the size. While it draws, the box and the hover box of the `PickingPlugin` are off; they draw the selection when only the canvas is fullscreen. It draws again only after a change (a render of a changed view, the selection, the hover, a setting), or on `redrawOverlay()`. The overlay settings are in the UI folder of the plugin.

### Changed

- treejs comes from npm, `@repalash/treejs` 2.0.0 (the same code), instead of a git URL, which npm 12 refuses by default. `HierarchyUiPlugin.treeView` is typed `any`: treejs is bundled, so its type could not resolve in consumer declarations.

## [0.6.0]

### Added

- Add pivot controls and pivot edit toolbar buttons with toggle support
- Add pivot edit icon (`pivotEdit`) to icon set

### Changed

- `HierarchyUiPlugin` — support Shift/Ctrl/Cmd click for multi-select in hierarchy panel via `PickingPlugin.toggleSelectedObject`
- `HierarchyUiPlugin` — skip hierarchy rebuild for widget and widget root object changes to avoid unnecessary UI refreshes

## [0.5.5] - 2025-11-08

### Changed

- HierarchyUiPlugin - Bubble object `select` event to parent

## [0.5.4] - 2025-09-04

### Changed

- Update minimum version of `@threepipe/plugin-tweakpane` `peerDependency` to `0.8.4`

## [0.5.3] - 2025-09-03

### Changed

- Update [threepipe](https://threepipe.org/) in `peerDependencies` to [0.1.0](https://github.com/repalash/threepipe/releases/tag/v0.1.0)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/tweakpane-editor
[0.5.1]: https://github.com/repalash/threepipe/releases/tag/@threepipe/plugin-tweakpane-editor-0.5.1
