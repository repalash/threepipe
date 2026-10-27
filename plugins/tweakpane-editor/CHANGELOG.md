# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

- Add `SelectionOutlinePlugin`: the outline of the selected and hovered objects in the render pipeline (a mask pass and a screen pass extension), with lines between parts, a dashed x-ray outline, fill and dim; follows the `PickingPlugin` or takes `selected` and `hovered`; the mask follows the material alpha. A selection or hover change renders one frame, without a progressive restart. Also `SelectionMaskPass`. Example `selection-outline-plugin`.
- `HierarchyUiPlugin.treeView` is typed `any`: treejs is bundled from a git repository and not on npm, so its type could not resolve in consumer declarations.

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
