---
name: interactive-test-writing
description: >
  Guide for writing interactive e2e tests for threepipe examples.
---

# Writing Interactive E2E Tests

Read `tests/interactive.spec.ts` for real examples of every pattern.

## Setup

```typescript
import {test, expect} from '@playwright/test'
import {setupTestHooks, screenshotMatch, downloadFileMatch, btnClick, btn} from './helpers'
setupTestHooks()  // top level, NOT inside test()
```

`beforeEach` handles: navigation, `_testFinish` wait, `initial` screenshot, animation pause.

## API

```typescript
btnClick(page, 'Exact Button Text')           // click button
screenshotMatch(page, testInfo, 'desc-name')  // named screenshot
downloadFileMatch(page, 'file.ext', trigger)  // verify download
downloadFileMatch(page, 'file.ext', trigger, 'custom-label')  // disambiguate same-name downloads
```

## Research Phase — CRITICAL

Before writing ANY test code, you MUST thoroughly research:

1. **Read the example script** — understand every plugin loaded, every button created, every feature enabled
2. **Read each plugin's source code** — search for:
   - `static PluginType` — needed for `getPlugin()`
   - `contextmenu`, `oncontextmenu`, `CustomContextMenu` — right-click menus
   - `enableEdit`, `editable`, `enableEditContextMenus` — editing/CRUD features
   - `@uiToggle`, `@uiSlider`, `@uiDropdown`, `@uiColor`, `@uiInput` — UI controls
   - Any public methods that create, modify, or delete items
3. **Identify ALL interactive entry points:**
   - Buttons at the bottom of the page (from `createSimpleButtons`)
   - TweakpaneUiPlugin panels (folders, sliders, toggles, dropdowns, color pickers)
   - Context menus (right-click on objects, panels, or specific elements)
   - Viewport interactions (clicking objects, dragging, transform gizmos)
   - Download triggers (both button-based and context-menu-based)
4. **Check what plugins are loaded but never directly exposed via buttons** — they still need testing

## Interaction Priority

Tests should prefer ACTUAL UI interactions over programmatic manipulation:

1. **Click buttons** in the page — the primary interaction method
2. **Interact with TweakpaneUI controls** — open folders, click toggles, fill textboxes, use dropdowns
3. **Right-click for context menus** — test create/edit/delete workflows
4. **Use `page.evaluate()` ONLY** for properties that have no UI control, or to set up specific test states quickly

Do NOT use `page.evaluate()` when a working UI control exists for the same property. The test should verify the UI → render pipeline, not just the programmatic API.

## What to Cover

- **Every button** the example creates — no exceptions
- **Every download button** — verify the download completes
- **Every context menu workflow** — right-click, test each option (create, edit, delete, download)
- **TweakpaneUI interactions** — at minimum: open the plugin folder, toggle a checkbox, change a slider value via textbox
- **Plugin enable/disable** — at least one disable → re-enable cycle
- **Edge cases** — extreme values, rapid state changes
- **Keep screenshot count moderate** (5-12) — combine multiple changes into single screenshots

## Verification — MANDATORY

You MUST run and verify before reporting done:
```bash
npx playwright test tests/interactive.spec.ts -g "test-name" --retries 0 --update-snapshots
npx playwright test tests/interactive.spec.ts -g "test-name" --retries 0
```
Both must pass. Fix failures before reporting.

## Handling Dialogs

There are TWO dialog systems in threepipe:

### 1. Native browser dialogs (`window.alert`, `window.confirm`, `window.prompt`)
Used when TweakpaneUiPlugin is NOT loaded. Intercept with Playwright's `page.waitForEvent('dialog')`:
```typescript
const dialogPromise = page.waitForEvent('dialog')
await page.getByText('Some Action', {exact: true}).click()
const dialog = await dialogPromise
await dialog.accept('value')  // or dialog.dismiss()
```

### 2. HTML dialogs (TweakpaneUiPlugin replaces native dialogs)
When TweakpaneUiPlugin IS loaded, it replaces `viewer.dialog` with HTML `<div class="dialog-container">`
elements. These are NOT native dialogs — `page.waitForEvent('dialog')` will NOT work.
Instead, interact with them as regular DOM elements:
```typescript
// After clicking a context menu item that triggers a prompt:
await page.locator('.dialog-input').fill('New Value')
await page.locator('.dialog-ok').click()

// For confirm dialogs:
await page.locator('.dialog-ok').click()   // accept
// or: await page.locator('.dialog-cancel').click()  // dismiss
```

Check the example source to determine which system is used — if TweakpaneUiPlugin is loaded, use HTML dialog pattern.

## Rules

1. **Non-deterministic output is a bug**. Never weaken assertions.
2. Prefer `getByRole`, `getByText({exact: true})` over CSS selectors.
3. Call `setDirty()` after evaluate, then `waitForTimeout(300)` before screenshot.
4. `getPlugin('PluginType')` — check `static PluginType` in source, not class name.
5. Context menus: right-click element, then `page.getByText('Option', {exact: true}).click()`.
6. Test CRUD workflows end-to-end via the UI: right-click → create → verify → rename → verify → delete → verify gone. Do NOT bypass the UI with `page.evaluate()` for CRUD operations.
7. When a plugin has `enableEditContextMenus` or editing features, test the full editing workflow through actual clicks and dialog interactions — these are the most regression-prone features.
8. `downloadFileMatch(page, name, trigger, snapshotLabel?)` — use `snapshotLabel` when names clash.
9. `page.evaluate()` is for setup/verification ONLY when no UI exists. If a context menu item triggers `window.prompt()`, use the dialog interception pattern above, not `page.evaluate()`.
