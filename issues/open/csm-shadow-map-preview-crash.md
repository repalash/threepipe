# CascadedShadowsPlugin: Shadow map preview crashes when lights array changes

## Bug
The `cascaded-shadows-plugin-basic` example adds shadow map preview panels via:
```ts
targetPreview.addTarget(() => csmPlugin.lights[0].shadow.map, 'csmShadowMap0', ...)
```

When the CSM plugin is disabled/re-enabled or cascade count changes, `csmPlugin.lights` may be empty or have fewer entries than expected. The lambda callbacks crash with:
```
TypeError: Cannot read properties of undefined (reading 'shadow')
```

## Root Cause
The `addTarget` callbacks capture the index directly (`lights[0]`, `lights[1]`, etc.) without null-checking. When CSM is reconfigured, the lights array is rebuilt and may temporarily have fewer entries.

## Fix Options
1. Add null-check in the lambda: `() => csmPlugin.lights[0]?.shadow?.map`
2. Have CascadedShadowsPlugin fire an event when lights change so preview can re-bind

## Files
- `examples/cascaded-shadows-plugin-basic/script.ts:113-116` — vulnerable lambda callbacks
