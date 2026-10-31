# Changelog for @threepipe/plugin-tweakpane-editor

All notable changes to this plugin will be documented in this file.

[//]: # (The format is based on [Keep a Changelog]&#40;https://keepachangelog.com/en/1.1.0/&#41;, and this project adheres to [Semantic Versioning]&#40;https://semver.org/spec/v2.0.0.html&#41;.)

## [Unreleased]

### Added

- Add `EditorSplash`: the start screen of the editor, a dialog like the splash of a desktop app. Start has "New empty scene" (`onNew`) and "Open file…" (`onFiles`; Ctrl+O or Cmd+O in the open splash); Recent has the samples opened last (`recent`, `EditorSplash.MaxRecent`); Samples has a card per sample of the app (`EditorSplashSample`: `title`, `text`, `icon`, `load`). A file dropped anywhere on it opens. A sample or a file shows that it loads, then the splash closes; a failed load keeps it open with a message. Escape, × (with a tooltip) or a click outside the card closes it; it takes the focus, Tab stays in it, and the keys do not reach the editor behind it. Ctrl+O (Cmd+O) opens it again (`shortcut`). The "Show at startup" box (`showAtStartup`) and the recent samples are kept in `localStorage` (`storageKey`, default `tpEditorSplash`). It follows the Tweakpane theme (`--tp-*`), with z-index 5000 (popups layer). The tweakpane-editor example opens it at the page load with four samples (skip it with `?nosplash`, the box, or a model in the URL).
- `NotesPlugin`: a list of notes, each kept in a store: `file` (serialized, so saved in the viewer config and in an exported .glb), `browser` (`localStorage`, `BrowserNotesStore`), or a store of the app (`NotesStore`, `addStore`; `HttpNotesStore` for a server). Changes are saved per store 600 ms after the last one; notes made while a store loads are kept. Events `notesChange` (with the note, or the notes that `clear` or a replaced store removed), `storeStatusChange` and `defaultStoreChange`; `contextLine()` gives the time, the context and the selected names. Its UI folder, `Notes`, has the settings.
- `StickyNotesUiPlugin`: the notes as post-its over the canvas, in the `board` layout (a post-it per note; new ones, and "Arrange", inside the canvas and above the dock, also on a phone) or the `stack` layout (a pile that goes to the left and up; a click brings a post-it up), or `minimized` (off the canvas; one button with the number of notes brings back the layout from before). The post-its start minimized on each page load (the second constructor argument, `startMinimized`, default `true`). The buttons are icon buttons with tooltips (the `editor` theme): add a note at once; the store of new notes (its icon; a click opens a menu of the stores); the icon of a note's store (the same menu moves the note); add the time and the selection, copy the text (a check and "Copied" for a moment) and delete per note (the text is 16 px on a touch screen, so a phone does not zoom in on it); post-its are dragged by their bar and sized from their corner, and glide between layouts. The layout, the colour, the places, the sizes and the order are kept in `localStorage`. Its UI folder, `Sticky Notes`, has the settings; `dock` holds its buttons. The post-its show above the loading screen, and their menus with the popups of the page. The `notes-plugin` example and the Extras mode of the tweakpane editor example show both.
- Add `TweakpaneEditorPlugin.layout`: the page layout, `titlebar`, `statusbar`, `floating` or `classic`. The first three put the editor in a page frame (class `EditorFrame`) with the modes as coloured icons on the right (`EditorModeBar`; its bottom button and Ctrl+\\ / Cmd+\\ step through the names and the panel, the icons and the panel, the icons only (`EditorModeBar.cycle()`); a click on the open mode hides the panel) and Shift+T for a light or dark theme. `classic` is the old page, with the mode tabs at the bottom. The layout picked in the frame's layout menu or in the plugin's UI is kept in `localStorage` (`TweakpaneEditorPlugin.LayoutStorageKey`; a layout set from code is not); `TweakpaneEditorPlugin.DefaultLayout` sets the layout when none is stored (set both before the plugin is made), and `frameOptions` the app name and theme pairs. `TweakpaneEditorPlugin.documentName` is the name in the bar (the open file or project), set by the app; a click on it in the bar renames it, and each change sends `documentNameChange`. The tweakpane-editor example sets it from the first loaded model or viewer config file, and names the exported file with it. The names setting that the person picks in the mode bar is kept too (`EditorModeBar.StorageKey`; one set from code is not); `EditorModeBar.onExpandedChange` is called when it changes. In the tweakpane-editor example: `?layout=titlebar|statusbar|floating|classic`.
- The page frame on a phone: a window under 920 px wide keeps the chosen layout (its bars and the mode bar; floating has no gap there) instead of the classic page, so the Page layout menu and dropdown show the layout on screen. In portrait, the canvas is on top at full width (`--lay-split`, 0.45 of the height), and the panel and the mode bar are below it, side by side with the same height; a mode bar taller than its room scrolls. When the panel is hidden, the mode bar is a row at the bottom and the canvas takes the rest. In landscape, they are side by side as on a desktop. The mode names are hidden at the first visit in a narrow window (`EditorModeBar.WideQuery`).
- `TweakpaneEditorPlugin` has a UI (`Editor` folder: Page layout, Mode names), shown in the Viewer mode of the tweakpane-editor example, also in the classic layout.
- Add `EditorCameraPlugin`: the editor's own camera (Edit, 1:1 with the pointer, no limits, never saved) and the scene's start view (View, through `previewCamera`, a copy of the default camera with the visitor's controls). `syncStartView` (on by default) saves each move in View as it happens (one undo step per move; with orbit controls, only a user gesture is a move, not a clamp of the orbit limits or a camera animation of another plugin); with it off, a move in View is a preview: `saveStartView()` keeps it, `resetStartView()` goes back; an export in View always has the saved start view. `setStartViewFromEditor()` (the view that is seen: the editor view in Edit, the preview in View) with undo, `smooth`. The C key switches Edit and View (`hotkey`). Events `editingChange`, `startViewMovedChange` (`startViewMoved`), `startViewChange`, `syncStartViewChange` and `hotkeyChange`; `showsStartView`. In the `TweakpaneEditorPlugin`, while the plugin is added: a pill on the canvas in the style of the perf pill names the camera ("Editor camera" or "Scene camera", with a grey, blue or green camera icon and the key of `hotkey`; a frame in View; hidden while the plugin is disabled) and opens a card with a picture of the saved start view, a Sync toggle, an Edit / View toggle and the start view actions (Set as start view; Save and Reset after a move in View); `setupEditorCameraUi()` for other apps (it returns a function that removes the UI). Example `editor-camera-plugin`; also in the `tweakpane-editor` example (Viewer tab).

### Changed

- Breaking: `TweakpaneEditorPlugin` opens the editor in the title bar frame by default (`TweakpaneEditorPlugin.DefaultLayout = 'titlebar'`), with the modes as icons on the right instead of the tabs at the bottom. Apps keep the old page with `TweakpaneEditorPlugin.DefaultLayout = 'classic'` (before the plugin is made; a layout that the person picks is still kept) or `editor.layout = 'classic'`.
- On a phone, the bottom tool bar fits in one row (smaller gaps and side padding; a narrower canvas scrolls it sideways instead of wrapping). In the page frame, the tool bar has icon buttons with the hover and on states of the frame's bars and mode bar, and no dividers: 28 px buttons with 16 px icons, as in the title bar (the status bar buttons are 22 px, the mode icons 20 px). The tooltip of the layout button hides while its menu is open, so it does not cover the first item (also in the mode bar of the floating layout). The perf pill (`PerfPanelPlugin`, bottom left) sits at the bottom left in the frame, in the middle of the tool bar's height (its own size, 22 px, in a window 920 px wide or more; 32 px like the tool bar in a narrower one); the tool bar leaves room for it in every layout. On a touch screen, the editor's tooltips show on a long press only (a tap no longer leaves one open until the next tap). The panel scrolls with a finger (it takes the touches: iOS does not scroll a container with `pointer-events: none`) and stops at its ends without moving the page; in the classic layout it is as tall as its content, up to the room above the tool bar.
- The editor's tooltips (the bottom button bar, the fullscreen button, the mode bar, the frame buttons, the camera pill and the sticky notes) share one tippy theme, `editor`: a small dark chip with its arrow, lighter in the dark themes. Before, the button bar tooltips took the panel colours, with a dark arrow in the light themes. The camera pill and the sticky notes add the tippy.js CSS and the theme themselves (once per page), so they also work without `TweakpaneEditorPlugin`.
- treejs comes from npm, `@repalash/treejs` 2.0.0 (the same code), instead of a git URL, which npm 12 refuses by default. `HierarchyUiPlugin.treeView` is typed `any`: treejs is bundled, so its type could not resolve in consumer declarations.

### Removed

- The webgi logo at the bottom left of the canvas (`#webgi-logo`, added by `TweakpaneEditorPlugin`): the image https://static.webgi.xyz/logo.svg with the tooltip "Powered by Threepipe SDK", that opened https://webgi.dev in a new tab, and its URL parameters `logo-img` (another image) and `logo-link` (another link). The perf pill and the post-its dock are at the bottom left now.

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
