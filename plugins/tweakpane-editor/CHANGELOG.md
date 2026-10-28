# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

- Add `SelectionUxPlugin` (part 1, the selection model): Figma-like click and key selection in the viewport. A click selects the outermost group (a group with a single child is one level with it, a file root passes the click to its parts), a double click goes one level in, a click again on the same spot selects the object behind, Shift adds or removes, Ctrl/Cmd selects the deepest object; Esc / Shift+Enter parent, Enter children, Tab siblings, Ctrl/Cmd+A the level. The selection stays in the `PickingPlugin` (one undo step per change). Not added to the editor by default. Example `selection-ux-plugin`.
- `SelectionUxPlugin` (part 2, the overlay): draws the selection over the canvas, with the box of the selection (`boxStyle`: screen rectangle, 3D box or its corners), a box for each object of a multiple selection, the box of the hovered object, the name with its parent levels (a click on a parent selects it) and the size. While it draws, the box and the hover box of the `PickingPlugin` are off.
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
