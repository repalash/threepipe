# modelling-workspace example: import map lacks `@threepipe/plugin-modelling`

**Status**: fixed on `modelling-editor` - the import map now lists `@threepipe/plugin-modelling`.

**Found**: 2026-10-03, while running the modelling e2e tests on `p4-onboarding` (not caused by it).

`examples/modelling-workspace/script.ts` imports `ModellingPlugin` from `@threepipe/plugin-modelling`,
but `examples/modelling-workspace/index.html`'s import map has no entry for it (only tweakpane,
mesh-kernel and mesh-edit). The page throws `Failed to resolve module specifier
"@threepipe/plugin-modelling"` and the `modelling-workspace` e2e test times out waiting for
`_testFinish`.

Fix: add `"@threepipe/plugin-modelling": "./../../plugins/modelling/dist/index.mjs"` to the import map
(as `examples/modelling-editor/index.html` has). Left to the track that owns the workspace example.
