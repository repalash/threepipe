# The Node modelling session carries its own copy of the threepipe Node polyfill

`plugins/modelling-cli/src/node/polyfill.ts` is a copy (tidied, typed) of
`plugins/procedural-generation/src/utils/node-polyfill.ts` from the unpublished `proc` branch, including
`DummyRenderManager`. Two copies of the same shim will drift.

`issues/open/threepipe-nodejs-support.md` already lists the fix: move `DummyRenderManager` and the DOM
stubs into threepipe core behind `ThreeViewer.createHeadless()`. That is a core change and was not made
in Track 1. When it lands, `NodeSession` should use it and the copy should be deleted.

Also noted while porting: the `proc` copy stubs a whole WebGL2 context with a `Proxy`; the modelling
session does not need it (a viewer on `DummyRenderManager` never asks for one), so the copy returns
`null` for `getContext('webgl2')` and anything that tries to render fails loudly instead.
