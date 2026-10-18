# uiconfig-blueprint: `BPComponent.refreshConfigState` drops calls made while one is in flight

**Found**: 2026-10-03, modelling editor onboarding track (`p4-onboarding`).

`uiconfig-blueprint` `lib/esm/bpComponents/BPComponent.js` (0.1.0-dev.15):

```js
refreshConfigState(state) {
    if (!this.props.config) return;
    if (this._refreshing) return;          // <- the later call is lost
    this._refreshing = true;
    const s = this.getUpdatedState(state || this.state);
    yield this.setStatePromise(s);
    this._refreshing = false;
}
```

A second refresh requested while the first one's `setState` has not settled is ignored, not deferred.
The first one computed its state *before* the change that caused the second request, so the component
stays one change behind until something else refreshes it.

**Repro** (modelling editor): two objects in the scene, File > New. Each removal fires a scene event,
the outliner refreshes on the first (one object still there), the rest are dropped: the outliner keeps
showing the removed object while the header says "0 objects".

**Workaround in place**: `plugins/modelling-editor/src/ui/Outliner.tsx` drains refresh requests
(`_drainRefresh`), calling `refreshConfigState` again until none is pending. Covered by the
`modelling-editor` e2e test (File > New empties the outliner).

**Suggested fix upstream**: remember a pending request while `_refreshing` and run one more refresh
after the `await` (coalescing), instead of returning.
