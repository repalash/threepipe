# `inspect` reports the master mesh's bounds, not what is drawn

Found building `examples/modelling-api/builds/eiffel-tower.mjs`.

## Repro

```js
await run({op: 'primitive', type: 'cube', name: 'c', size: 1})
await run({op: 'array', object: 'c', count: 4, step: [2, 0, 0], live: true})
const r = await run({op: 'inspect', object: 'c'})
// r.data.bounds.size -> [1, 1, 1]: the master. The object drawn is 7 wide.
```

Same for a live `mirror` or `wireframe`. `inspect` with no object (the document summary) and
`measure {mode: 'bounds'}` use world boxes of the scene objects, so they do report the evaluated
extent. The per-object `inspect` is the odd one out (`commands/session.ts`, `bounds: meshBounds(entry.mesh)`).

## Why it matters

An agent checks its work with `inspect`. A live modifier makes the answer silently describe a
different shape from the one on screen. In the Eiffel build, testing that a live wireframe followed
an edited cage needed `page.evaluate` on `entry.evaluated`; the e2e test has to do the same.

## Suggested fix (needs a decision)

Report both: `bounds` (master, which is what vertex indices address) and `evaluatedBounds` when the
stack is non-empty, or document clearly which one `bounds` is.
