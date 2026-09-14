# TweakpaneUiPlugin: "plugin not found" warning dumps minified class source

**Created:** 2026-03-27
**Status:** Fixed locally, needs plugin rebuild
**Package:** @threepipe/plugin-tweakpane

## Problem

`TweakpaneUiPlugin.setupPluginUi()` logs the plugin class constructor directly when the plugin isn't found:

```ts
// plugins/tweakpane/src/TweakpaneUiPlugin.ts:106
console.warn('plugin not found:', plugin)
```

When `plugin` is a class constructor, `console.warn` stringifies it, dumping thousands of characters of minified source into the console.

## Fix Applied

```ts
console.warn('plugin not found:', (plugin as any).PluginType || (plugin as any).name || plugin)
```

This logs `"PickingPlugin"` instead of the entire minified class body.

## Impact

- Affects 3 examples: `fat-line-spiral`, `temporalaa-plugin`, `velocity-buffer-plugin`
- Each warning dumps ~2-3KB of minified code into console.log
- Fix is in source, needs `npm run build-plugins` or plugin rebuild to take effect in dist
