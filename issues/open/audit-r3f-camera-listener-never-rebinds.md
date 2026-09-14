# r3f ViewerCanvas: cameraUpdate listener keyed on `viewerRef.current`, never re-binds on active-camera change

**Severity:** medium
**Found:** 2026-06-13 code audit

## Bug
The effect that wires r3f's `controls` state depends on `[viewerRef.current]` — a mutable ref's current value, which React does not track for changes (and the viewer object is stable across its lifetime). So the effect effectively runs once. The `cameraUpdate` listener it registers stays bound to the *original* `mainCamera` object and is never moved to the new camera on an active-camera change.

## Root Cause
```ts
useEffect(() => {
    if (!viewerRef.current) return
    // ...
    const s = ()=>{ set({controls: viewerRef.current?.scene.mainCamera?.controls ?? null}) }
    const l = (e: {change?: string})=>{ if (e.change === 'controls') s() }
    viewerRef.current.scene.mainCamera?.addEventListener('cameraUpdate', l)   // bound to initial camera
    viewerRef.current.scene.addEventListener('mainCameraChange', s)

    return () => {
        viewerRef.current?.scene.mainCamera?.removeEventListener('cameraUpdate', l)  // reads current (new) camera at teardown
        viewerRef.current?.scene.removeEventListener('mainCameraChange', s)
        set({controls: old})
    }
}, [viewerRef.current])
```
`RootScene` swaps `mainCamera` to a new object on active-camera change. Because the effect never re-runs, `l` stays attached to the old camera and is never added to the new one. The `s`/`mainCameraChange` handler updates controls only at the swap instant, so subsequent `cameraUpdate` events on the new camera are missed. At teardown the cleanup reads the *current* (new) camera, so if the camera changed, it removes `l` from the wrong (new) camera — leaving `l` leaked on the old camera.

## Impact
After an active-camera change, r3f's `controls` state stops tracking the new camera's `cameraUpdate` events, and the old-camera listener leaks. Using a live `.current` value as an effect dependency is the root cause.

## Fix
Drop `viewerRef.current` from the deps; instead listen to `mainCameraChange` to move the `cameraUpdate` listener from `event.lastCamera` to the new camera, mirroring the `controls` swap.

## Files
- `plugins/r3f/src/ViewerCanvas.tsx:96-117` — effect with `[viewerRef.current]` dep; `cameraUpdate` listener never re-bound
