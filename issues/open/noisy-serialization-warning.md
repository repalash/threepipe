# ts-browser-helpers: Serialization warning dumps full class source

**Created:** 2026-03-27
**Status:** Open
**Upstream:** ts-browser-helpers
**Discovered via:** E2E test console log analysis (anisotropy-plugin)

## Problem

The `Serialization` class in `ts-browser-helpers` logs a warning when data might already be deserialized, but stringifies the entire class constructor in the warning message:

```
[warning] Serialization: Data might already be deserialized class Iu extends xi { constructor(...) { ... } ... }
```

This dumps thousands of characters of minified source code into the console, making logs unreadable.

## Impact

- Console logs are polluted with minified code
- Hard to spot real issues in test console output
- Affects at least `anisotropy-plugin` example

## Fix

In `ts-browser-helpers/src/serialization.ts`, the warning should log only the class name or type identifier, not the full class object. E.g.:

```ts
// Instead of:
console.warn('Serialization: Data might already be deserialized', cls)
// Use:
console.warn('Serialization: Data might already be deserialized:', cls.name || cls.TYPE || typeof cls)
```
