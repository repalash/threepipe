---
prev:
  text: 'Material Previews'
  link: './material-previews'

aside: false
---

# Frame updates: last, debounce and throttle

A slider sends a change on every pointer move, often more than 60 times a second. threepipe has no `debounce` or
`throttle` helper. It limits the work of fast changes in three ways: the `last` flag of a change, work in the next frame
of the viewer, and the refresh queue of uiconfig. This page shows each one and where threepipe uses it.

## The `last` flag: a drag or its end

Each change event of [uiconfig](https://github.com/repalash/uiconfig.js) has `last`. It is `false` while a slider moves
or while text is typed, and `true` when the slider is released or the text is committed. `setDirty` takes the same
flag (`ISetDirtyCommonOptions.last`), and the materials pass the change event on (`uiChangeEvent`).

Do the cheap part of the work on every change, and the expensive part only when `last` is not `false`:

- The materials update the shader (`needsUpdate`) and refresh their UI only when `ev.last` is true
  (`setDirty({uiChangeEvent: ev, needsUpdate: !!ev.last, refreshUi: !!ev.last})` in `PhysicalMaterial` and the other
  materials). The uniforms change on every move; a recompile happens once, on release.
- Objects refresh their UI, and the scene when a name changes, only on `last`.
- The undo commands of uiconfig (`setValueUndoCommand` in ts-browser-helpers) keep `last` as `final`, so the undo
  manager merges the changes of a drag into one undo step.
- `MaterialPreviewQueue` renders a preview at most every `dragInterval` ms while `last` is `false`, and in the next frame
  for the change that ends the drag (see [Material Previews](./material-previews)).

From your own inputs, send `last: false` while the value moves and a normal change at the end:

```typescript
slider.oninput = () => {
    material.roughness = parseFloat(slider.value)
    material.setDirty({last: false}) // a drag
}
slider.onchange = () => material.setDirty() // the end of the drag: last is not false
```

## Work in the next frame

The viewer runs its frame loop with `requestAnimationFrame` and fires `preFrame`, `preRender`, `postRender` and
`postFrame`. Work done in these events is merged per frame, without timers:

- `viewer.setDirty()` only sets a flag. Any number of calls in one frame reset the render once, in the next frame.
- `viewer.doOnce('postFrame', fn)` runs `fn` once, in the next frame.
- `MaterialPreviewQueue` renders in `preFrame`, at most `maxPerFrame` previews per frame.

When the viewer is disabled, these events do not fire, so work queued there waits too.

## The refresh queue of uiconfig

`config.uiRefresh(deep, mode, delay)` refreshes the UI of a config. It does not refresh at once: the renderer of the UI
queues the config and refreshes it in the frame event `mode` (`'postFrame'` by default, or `'preFrame'`,
`'preRender'`, `'postRender'`). `'immediate'` refreshes after a timer of `delay` ms instead. A config is in the queue
once: a second call for the same config is merged with the first. A `delay` in ms waits that long, checked at each frame event, and a repeated call pushes the
delay back (`UiConfigRendererBase`). The materials call `uiRefresh(true, 'postFrame', 1)`: many changes in one frame
give one refresh.

## Which one to use

| Case | Use |
|---|---|
| Expensive work for a value that a user drags (shader update, preview, rebuild) | Do it when `last` is not `false`; during the drag, do the cheap part, or limit it to an interval |
| Many changes in one frame (several properties set in a row) | Do the work in the next frame event: `setDirty`, `doOnce`, or your own `preFrame` listener |
| UI refresh after a change | `uiRefresh(deep, 'postFrame')` |
| Feedback while a user drags | A limit per interval during the drag, as `MaterialPreviewQueue.dragInterval`; not a debounce, which shows nothing until the drag stops |

`OrbitControls3.throttleUpdate` (60) is set in threepipe, but it has no effect now: the throttle in `OrbitControls.update`
of the three.js fork never sets the time of the last update (the line is commented out), so every update runs.
