# Sample asset catalog scripts

They fill threepipe cloud's asset catalog (`threepipe_assets` and `threepipe_asset_links` in `services/cloud/teenybase.ts`).
Each script's header lists its options.

1. `npm run assets:catalog` reads the sources (Khronos, gltf-research-scenes, the samples bucket, Poly Haven) and writes
   `<out>/catalog.json`, the model files in `<out>/samples/` and the source screenshots in `<out>/p/samples/`.
2. `npm run assets:render` renders the previews on a GPU browser through `examples/_render-model`: stills at 512 and
   1024, turntables on black (`#000000`) and white (`#ffffff`), and with alpha (WebM; HEVC on a Mac).
3. Upload: `npm run cloud:upload -- <out>/samples samples/` (models, write-once) and
   `npm run cloud:upload -- <out>/p/samples p/samples/` (previews, can be redone).
4. `npm run assets:insert -- --out <out> --token-file <.prod.vars> --apply` writes the rows (a dry run without `--apply`).
