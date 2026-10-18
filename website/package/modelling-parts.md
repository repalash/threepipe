---
prev:
    text: '@threepipe/plugin-modelling'
    link: './plugin-modelling'

next:
    text: '@threepipe/plugin-procedural'
    link: './plugin-procedural'

aside: false
---

# @threepipe/modelling-parts

Parametric parts for threepipe modelling: knurled rings, dials, buttons, rockers, eyecups, strap lugs, lens
barrels and pads, built as editable n-gon meshes (`MeshData` from [`@threepipe/mesh-kernel`](./mesh-kernel)), plus
SVG layouts for printed markings. Ribs and knurls are real geometry, not a texture.

The package depends on `@threepipe/mesh-kernel` only and runs in Node and the browser. Most of the time you reach
it through the `part` command of [`@threepipe/plugin-modelling`](./plugin-modelling).

[Source Code](https://github.com/repalash/threepipe/blob/master/plugins/modelling-parts/src/index.ts)

```bash
npm i @threepipe/modelling-parts
```

## The `part` command

```js
// a list of every part and its parameter schema
await modelling.run({op: 'part', list: true})

// build one; parts are built along +y with the base at the origin, then placed
await modelling.run({op: 'part', type: 'product/knurled-ring', name: 'focus',
    params: {radius: 38, length: 14, ribs: 72}, position: [0, 0, 10], rotation: [Math.PI / 2, 0, 0]})
// data: {name, type, params, verts, faces, groups: {knurl: {faces: 288, edges: 0}}, anchors: {base, top, side}}

// rebuild it with new numbers: the other parameters and the placement are kept
await modelling.run({op: 'part', name: 'focus', params: {length: 20}})
```

The object remembers its `{type, params}`, so `part {name, params}` regenerates it in place. That holds only until
another command edits it: after, say, a `bevel` it is plain topology (like an applied modifier in Blender) and
`part {name, ...}` fails with "was edited after it was built ... build a new part instead". A missing required
parameter fails (``product/dial needs `height` ``), an unknown one with the list of parameters the part has.

| `part` parameter | |
| --- | --- |
| `type` | Part id (below). Required for a new part |
| `name` | Object name; default the id's last segment (`knurled-ring`). Required to regenerate |
| `params` | The part's parameters |
| `position` | World position |
| `rotation` | Euler XYZ, radians |
| `list` | Return the parts and their schemas instead of building one |

Each part is shaded smooth by angle as it is designed (35 degrees for the round parts).

## Parts

Units are the caller's (the camera demo uses mm). Defaults are the ones the schemas give.

### `product/knurled-ring`

A ring with a bore and ribs round it: lens focus and zoom rings, the sides of a dial. Group `knurl` is the
ribbed faces.

| Parameter | |
| --- | --- |
| `radius` (required) | Outer radius at the rib tops |
| `length` (required) | Length along the axis (+y) |
| `innerRadius` | Bore radius. Default `radius - 2 x ribDepth - 1` |
| `ribs` | Number of ribs round. Default 60 |
| `ribDepth` | Groove depth. Default 0.6 |
| `ribWidth` | Rib top as a fraction of the pitch, 0.1 to 0.9. Default 0.45 |
| `chamfer` | Chamfer on both outer rims, along the axis. Default `ribDepth` |

### `product/dial`

A knurled dial with an optional centre lock button. Groups `knurl` and `top`.

| Parameter | |
| --- | --- |
| `radius` (required) | Radius at the knurl tops |
| `height` (required) | Height of the knurled body above its base (+y) |
| `ribs` | Knurl ribs round. Default 48 |
| `ribDepth` | Knurl groove depth. Default 0.35 |
| `topChamfer` | Chamfer from the knurl to the top face. Default 0.6 |
| `lockRadius` | Centre lock button radius; 0 for none. Default 0 |
| `lockHeight` | Lock button height above the top. Default 0.8 |
| `skirt` | Plain band below the knurl. Default 0.6 |

### `product/button`

A round button with a rounded rim, seated 0.3 below the surface so it sits on a slightly curved body.

| Parameter | |
| --- | --- |
| `radius` (required) | Cap radius |
| `height` (required) | Height above the surface (+y), to the cap edge |
| `chamfer` | Edge round of the cap. Default `radius x 0.15` |
| `dome` | Extra rise at the cap centre; negative is a dish. Default 0 |
| `collar` | Width of a raised collar ring round the button; 0 for none. Default 0 |
| `segments` | Segments round, at least 8. Default 40 |

### `product/lens-barrel`

A section of barrel revolved from stations along the axis.

| Parameter | |
| --- | --- |
| `stations` (required) | `[[radius, y], ...]` along the axis, outer surface, in order (at least two) |
| `bore` | Inner radius; 0 closes the ends instead. Default 0 |
| `segments` | Segments round, at least 8. Default 96 |

### `product/rocker`

A rocker, lever or slide knob: a rounded rectangle in plan with a chamfered top.

| Parameter | |
| --- | --- |
| `length` (required) | Size along x |
| `width` (required) | Size along z |
| `height` (required) | Height above the surface (+y) |
| `radius` | Corner radius in plan. Default `min(length, width) x 0.3` |
| `chamfer` | Top edge chamfer. Default `height x 0.3` |

### `product/eyecup`

A rounded-rectangle rubber frame with a window, rolled over at the rim.

| Parameter | |
| --- | --- |
| `width` (required) | Outer width (x) |
| `height` (required) | Outer height (z of the part) |
| `depth` (required) | How far it stands out (+y) |
| `radius` | Outer corner radius. Default `height x 0.3` |
| `windowWidth` | Window width. Default `width x 0.55` |
| `windowHeight` | Window height. Default `height x 0.5` |
| `windowRadius` | Window corner radius. Default 1.5 |
| `windowDepth` | How deep the window goes in. Default `depth x 0.9` |
| `flare` | Outward flare of the rim at the front. Default 1 |

### `product/strap-lug`

A wire loop, D-shaped, standing out along +x. Anchors `base` and `tip`.

| Parameter | |
| --- | --- |
| `width` (required) | Outer width of the loop (z) |
| `height` (required) | How far the loop stands out (+x) |
| `wire` | Wire radius. Default 1 |
| `segments` | Samples round the loop, at least 8. Default 24 |

### `product/pad`

A raised panel with a rounded top edge, from a few outline points (thumb rests, grip panels).

| Parameter | |
| --- | --- |
| `outline` (required) | Closed outline points `[a, b]`: `a` along x, `b` along -z, seen from +y. It is smoothed |
| `thickness` (required) | Height above the surface (+y) |
| `round` | Radius of the rounded top edge. Default `thickness x 0.6` |
| `smooth` | Chaikin smoothing passes on the outline, 0 to 6. Default 3 |
| `samples` | Points round the outline after smoothing. Default 120 |

## Without the command

```typescript
import {PARTS, knurledRing} from '@threepipe/modelling-parts'

const ring = PARTS.get('product/knurled-ring')!.build({radius: 38, length: 14, ribs: 72})
ring.mesh                     // MeshData: closed, wound outwards
ring.groups.knurl.faces       // 288 faces: 4 per rib
ring.anchors.top              // {position, normal} in part space
ring.smoothAngle              // degrees

knurledRing.params            // the JSON Schema `part {list: true}` returns
```

A `PartDefinition` is `{id, title, tags, params, build(params) => {mesh, groups, anchors, smoothAngle}}`;
`PRODUCT_PARTS` is the list and `PARTS` the map by id. The builders under them are exported too: `revolve` (a
surface of revolution about +y with per-ring radius modulation, which the round parts share), `ribAngles`,
`roundedRect` and `chaikinClosed`.

## Print layouts

SVG strings for the `decal` command's `content.svg`. Fonts are generic families; no logotype is reproduced.

| Function | Draws |
| --- | --- |
| `ringLabels({size, labels, radius?, start?, step?, color?, fontScale?, fontFamily?, fontWeight?})` | Labels round a circle, each upright towards the outside (a mode dial's top). `color` may be a list |
| `ringText({size, text, radius?, at?, color?, fontScale?, fontFamily?, letterSpacing?})` | Text running round a circle (the front ring of a lens) |
| `scaleLabels({width, height, marks, minor?, color?, fontScale?, fontFamily?})` | A row of ticks with labels: `marks` is `[[position 0..1, label], ...]` (distance and focal-length scales) |
| `wordmark({width, height, text, color?, family?, weight?, italic?, sub?})` | A word mark stretched to the box; `sub` adds a smaller second line (a model badge) |

```js
import {ringLabels} from '@threepipe/modelling-parts'

await modelling.run({op: 'decal', name: 'decal-dial-mode', mode: 'plane', at: [56, 96.95, 23],
    normal: [0, 1, 0], up: [0, 0, 1], size: [21.5, 21.5], offset: 0.03,
    content: {svg: ringLabels({size: 860, labels: ['M', 'B', 'C1', 'C2', 'C3', 'A+', 'P', 'Tv', 'Av'],
        radius: 0.8, fontScale: 0.085})}})
```

Decals are rasterised by the browser: a Node session builds the decal geometry and warns that the print is
missing. [`@threepipe/modelling-cli`](./modelling-cli) re-exports `PARTS`, `PRODUCT_PARTS` and these layouts for build scripts;
[`demos/benchmark/scripts/camera-dress.mjs`](https://github.com/repalash/threepipe/blob/master/demos/benchmark/scripts/camera-dress.mjs) dresses the camera demo with seven of the parts and
all four layouts.
