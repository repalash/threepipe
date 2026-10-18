# `export {objects}` is declared but ignored

`exportCommand` (`plugins/modelling/src/commands/session.ts`) declares `objects: "Export only these
objects. Default the whole scene."` but `run` always calls `viewer.exportScene(...)`. An agent that asks
for one part gets the whole scene, silently.

Found by Track 1 (2026-10-16) while making replays byte-comparable. The command now warns when
`objects` is passed, instead of ignoring it without a word.

## Fix (needs a decision)

threepipe exports one object per call (`viewer.export(obj)` → `AssetExporter.exportObject`). Exporting a
subset means either a temporary parent (reparenting has side effects: events, undo listeners) or an
exporter option to filter the scene root's children (`excludeFromExport` is per object and persisted, so
toggling it is a workaround, not a fix). The second is a core change; ask before doing it.
