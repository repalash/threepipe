# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

- Add `TweakpaneEditorPlugin.layout`: the page layout, `titlebar` (the default), `statusbar`, `floating` or `classic`. The first three put the editor in a page frame (class `EditorFrame`) with the modes as coloured icons on the right (`EditorModeBar`, names shown or hidden, a click on the open mode hides the panel) and Shift+T for a light or dark theme. `classic` is the old page, with the mode tabs at the bottom. The layout picked in the frame's layout menu or in the plugin's UI is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`); `TweakpaneEditorPlugin.DefaultLayout` sets the layout when none is stored, and `frameOptions` the app name and theme pairs. The names setting of the mode bar is kept too (`EditorModeBar.StorageKey`); `EditorModeBar.onExpandedChange` is called when it changes. In the tweakpane-editor example: `?layout=titlebar|statusbar|floating|classic`.
- The page frame on a phone: a window under 920 px wide keeps the chosen layout (its bars or cards and the mode bar) instead of the classic page, so the Page layout menu and dropdown show the layout on screen. In portrait, the canvas is on top at full width (`--lay-split`, 0.45 of the height), and the panel and the mode bar are below it, side by side with the same height; a mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom and the canvas takes the rest. In landscape, they are side by side as on a desktop. The mode names are hidden at the first visit in a narrow window (`EditorModeBar.WideQuery`).
- On a phone, the bottom tool bar fits in one row (smaller gaps and side padding; a narrower canvas scrolls it sideways instead of wrapping), and the logo is above it. The panel scrolls with a finger (it takes the touches: iOS does not scroll a container with `pointer-events: none`) and stops at its ends without moving the page; in the classic layout it is as tall as its content, up to the room above the tool bar.
- `TweakpaneEditorPlugin` has a UI (`Editor` folder: Page layout, Mode names), shown in the Viewer mode of the tweakpane-editor example, also in the classic layout.
- The editor's tooltips (the bottom button bar, the fullscreen button, the mode bar and the frame buttons) share one tippy theme, `editor`: a small dark chip with its arrow, lighter in the dark themes. Before, the button bar tooltips took the panel colours, with a dark arrow in the light themes.
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
