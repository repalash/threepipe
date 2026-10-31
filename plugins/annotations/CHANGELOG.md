# Changelog for @threepipe/plugin-annotations

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- First version. `AnnotationsPlugin`: numbered markers on objects with a title, a text and a saved camera view, like Sketchfab annotations. A click on a marker flies the camera to its view and opens a card. Editable mode: add (click a surface), edit, move (drag) and delete, undoable with `UndoManagerPlugin`. Saved in the viewer config and in the exported .glb. Tour (`next`, `prev`, `playTour`) and events for an outside list. `renderAnnotationText` formats the text (bold, italic, links, bullets)

[unreleased]: https://github.com/repalash/threepipe/tree/dev/plugins/annotations
