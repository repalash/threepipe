---
prev:
    text: '@threepipe Packages'
    link: './threepipe-packages'

next:
    text: '3D Assets'
    link: './3d-assets'
---

# FAQ

## How do I install a prerelease? {#prereleases}

Versions that are not released yet are published under their own npm dist-tag: `next` for the upcoming release (`npm install threepipe@next`), `three-rNNN` for a three.js upgrade (`npm install threepipe@three-r172`). The `latest` version does not change.

npm does not count a prerelease (`0.7.0-next.0`) as matching a plugin's peer range on `threepipe` (`>=0.6.0`), so `npm install` with any `@threepipe/` plugin fails with `ERESOLVE`. Add an override to your `package.json`, so the plugins use the `threepipe` your project installs:

```json
{
  "dependencies": {
    "threepipe": "^0.7.0-next.0",
    "@threepipe/plugin-tweakpane": "^0.10.1"
  },
  "overrides": {
    "threepipe": "$threepipe"
  }
}
```

pnpm and yarn install a prerelease with the plugins without the override.
