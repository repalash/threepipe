# `scripts/modelling-session.mjs`: the 90 s wait for the plugin is really 30 s

`page.waitForFunction(() => !!window.modelling, {timeout: 90000})` passes the options object as
Playwright's *argument* (the second parameter is `arg`; options are the third). The wait therefore
uses the default 30 s timeout. On a loaded machine (load average 60-110 on 6 cores, eight SwiftShader
sessions at once) the example page takes longer than that to load, and every session dies before the
build starts:

```
page.waitForFunction: Timeout 30000ms exceeded.
    at scripts/modelling-session.mjs:120:12
```

## Status: fixed on `demo-haussmann`

`page.waitForFunction(() => !!window.modelling, undefined, {timeout: 180000})`, and the `goto`
timeout raised to match. Found while running `demos/haussmann/build.mjs`.
