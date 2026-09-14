# Deterministic injection: Date.now=0 crashes fflate ZIP

## Bug
The deterministic injection script froze `Date.now()` to return `frameId * 16`, which starts at 0 (epoch 1970). The `fflate` ZIP library requires dates in the 1980-2099 range, so creating ZIP files (e.g., CanvasSnapshotPlugin tiled export) crashes with:
```
Error: date not in range 1980-2099
```

## Fix
Changed base time to 2024-01-01T00:00:00Z (1704067200000) in `tests/deterministic-injection.js`.
Still deterministic (frame-based offset), but within ZIP-valid date range.
