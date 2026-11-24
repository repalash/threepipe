---
prev:
  text: 'Frame Updates: last, debounce, throttle'
  link: './frame-updates'

aside: false
---

# Shadows: shadow side and bias

A light with shadows first renders the depth of the shadow casters from the light into a shadow map. Then each pixel on
screen compares its own depth from the light with the stored one: farther means something is in between, so it is in
shadow. Two settings decide most shadow artifacts: which faces go into the map, and how much bias the comparison gets.

## Which faces cast: `shadowSide`

`material.shadowSide` is `null` by default, and three.js then draws the side opposite to `material.side`:

| `material.side` | Faces in the shadow map |
|---|---|
| `FrontSide` (default) | back faces |
| `BackSide` | front faces |
| `DoubleSide` | both |

With back faces, a lit surface is compared against the far side of its own object, so it does not shadow itself
(no acne) even with no bias. The cost:

- **Contact points leak light.** Where an object touches the floor, its back faces are at the floor's depth, so a thin
  lit line shows round the contact (under a sphere on the ground).
- **Thin and open geometry casts no shadow.** A single-sided plane facing the light has no back face towards it.

`FrontSide` stores the surfaces the light hits: contacts and planes are right, and a small bias keeps the lit faces
clean.

## Bias

| Light setting | What it does | Unit | Default |
|---|---|---|---|
| `shadowBias` | moves the compared depth towards the light | the shadow camera's depth range: for a directional light, `bias × (far − near)` in world units | 0 |
| `shadowNormalBias` | moves the lookup point along the surface normal | world units | 0 |

Too little bias gives **acne** (stripes or dots on lit faces, worst at grazing angles). Too much lifts the shadow off its
object (**peter-panning**: the object floats, light shows at its contact). Size the normal bias to about half a
shadow-map texel: the shadow frustum divided by the map size.

## Which to use

| Scene | Shadow side | Bias |
|---|---|---|
| Closed, thick objects that touch nothing (a product in the air) | Auto (back faces) | 0 |
| Objects on a floor or touching each other, thin walls, planes | Front | small: a few mm of normal bias, about −0.00005 bias |
| Single-sided planes or leaves that cast from both sides | Double | small |

```typescript
material.shadowSide = FrontSide
light.shadowNormalBias = 0.004 // half a texel of a 4096 map over a 35 m frustum
light.shadowBias = -0.00005
```

## In threepipe

- `DirectionalLight2` keeps the three.js defaults (no bias, 512 × 512 map) with a 10 m `shadowFrustum`; the renderer
  uses `PCFShadowMap`.
- The editor has **Shadow Side** (Auto, Front, Back, Double) in the material panel and **Shadow Bias** and **Shadow Normal
  Bias** on lights. A change of Side or Shadow Side draws the shadow maps again.
- Both are saved in glTF: `shadowSide` in `WEBGI_material_extras`, the bias in `WEBGI_light_extras`
  (see [Three.js properties in glTF](./gltf-three-extras-ext)).
