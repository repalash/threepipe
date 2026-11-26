# The Eiffel Tower, to scale, by modelling command

`eiffel-tower.mjs` builds the Eiffel Tower in metres through `@threepipe/plugin-modelling` commands only:
`primitive`, `extrude`, `transform`, `vertices`, `inset`, `solidify`, `poke`, `wireframe`, `sweep`,
`lathe`, `array`, `modifier`, `weld` and `deleteElements`. No mesh is imported and no coordinates
are typed in: the two places that use `vertices` compute the positions from the measured profile.
The dimensions come from Eiffel's own drawings, and the build checks them against the finished
model before it finishes.

```bash
npm run modelling:session -- examples/modelling-api/builds/eiffel-tower.mjs \
    --out tmp/eiffel/build --port 9351 --width 1000 --height 1500
```

The build loads one reference image from
`tmp/eiffel/references/eiffel-diagram-elevation-1to1200-exterior-widths-monod-1890.jpg`. See
[References](#references) for how to get it.

## How it is built

The tower is a wrought-iron lattice, so almost nothing in it is solid.

- **Cages.** Each pier, the shaft and the floor girders start as a polygon cage with one quad per
  panel face. The panels are the ones Eiffel numbered 1 to 29. A cage is a square `plane` pushed up
  one panel at a time with `extrude`. Each extrude moves the cap along the measured centreline and
  scales it to the measured width, so every ring sits exactly on a panel line of the drawing.
- **Bracing.** `poke` puts both diagonals in every panel, a St Andrew's cross with a node where they
  meet. A live `wireframe` modifier turns every edge of the cage into a strut, so editing the cage
  moves the lattice with it.
- **Symmetry.** One pier is modelled; live `mirror` modifiers on x and z make the other three. Members
  that repeat round the shaft (corner columns, face columns, arches, consoles, brackets) use a live
  radial `array`.
- **Columns.** The four corner members (arbalétriers) of each pier are solid tapered boxes. They are
  four squares extruded as one region through the same panel lines as the cage, because on the real
  tower they are plated box girders.
- **Shaft above the second floor.** For panels 12 to 17, each face is a 3×3-grid cage whose inner
  vertices are moved onto the two converging face columns. Those columns meet at line 18, where they
  are welded. Panels 18 to 29 are a 2×2-grid cage, so each face is split by the merged column.
- **Arches.** Each arch is a 74 m semicircle springing at the bearings. It is swept along the
  sloping outer face of the piers, then poked and wireframed into openwork. The row of openings
  above each arch is a grid strip with one edge on the arch's extrados and the other on the girder.
  Each bay is inset, its middle deleted, and the strip solidified.
- **Floors.** The first and second floors are each built from these parts:
  - a lattice girder band in the plane of the faces;
  - a frieze or fascia with inset bays;
  - a deck (a square inset with its middle deleted, then solidified);
  - railings (a wireframed band);
  - pavilions.

  The third floor is a closed box with eight inset windows a side, on eight curved consoles.
- **Summit.** Above the third floor are the enclosed top level, a tapering lattice, stepped
  equipment decks, and a lathed mast to 330 m.

Axes: Y up. The origin is on the ground at the centre of the tower; ground is cote +33.50.

## Dimensions

These are the numbers the model is built from. The "model" column was measured from the finished
model by the build's own checks, which throw if any is off by more than the stated tolerance. It is
not the input restated. The full sourced table, with conflicts between sources, is in the research
notes summarised under [References](#references).

| Quantity | Source value | Source | Model (measured) |
| --- | --- | --- | --- |
| Height to the antenna tip (since 2022) | 330 m | toureiffel.paris key figures; Reuters 2022-03-15 | 330.000 |
| Lantern terrace (1889 top platform) | 300.51 m | Eiffel, *La tour de trois cents mètres* (1900) §II; Monod cote 334.015 − 33.50 | 300.510 |
| First / second / third floor | 57.63 / 115.73 / 276.13 m | Eiffel §II; Pl. I cotes 91.13 / 149.23 / 309.63 | 57.630 / 115.730 / 276.130 |
| Base square, outer edges of the piers | 124.90 m | FR-Wikipedia; Pl. I (2 × 25.33 + 74.24) | 124.900 |
| Clear gap between the piers | 74.24 m | FR-Wikipedia; Pl. I | 74.240 |
| Pier centres | corners of a 101.40 m square | Eiffel §II; Pl. III | 101.400 (2 × 50.700) |
| Pier box (between corner-member axes) | 15.00 m up to the first floor; 10.41 m at the second | Eiffel §II; Pl. III | 15.000; 10.410 |
| Outer-axis width at the bearings (z = 2.50) | 116.40 m (101.40 + 15.00) | Eiffel; checks Monod by extrapolation | 116.400 |
| Outer-axis width at all 31 panel lines | Monod 1890 (lines 1–12), Weidman & Pinelis 2004 (13–29) | see the table in `eiffel-tower.mjs` | worst deviation 0.000 |
| Width at line 6, under the first floor | 62.195 m | face-plane angle converted to elevation (Monod digits illegible) | 62.195 |
| Shaft at the second / third floor | 31.70 / 10.00 m | Eiffel §II | 31.700 / 10.000 |
| Panel heights (29 panels) | 11, 11, 11, 11, 7, 11, 11, 11, 10.2, 10, 4.9, 11.3, … 11.28 m | Weidman & Pinelis 2004 Table 1, checked on Monod | built from them; line 29 lands on the third floor (276.13) |
| Decorative arches | 74 m across, crown ≈ 39.4 m | Eiffel §II; Monod | semicircle r = 37.0 from z = 2.50; underside of the struts at the crown 39.14 |
| First floor platform | 70.69 m square | FR-Wikipedia; Pl. I "70m.685" | 70.690 |
| Second floor platform | 40.96 m square (modern) | FR-Wikipedia (Pl. I 1889 reads about 36.5) | 40.960 |
| Third floor | 18.65 m square (modern) | FR-Wikipedia (Pl. I 1889 reads about 16.5) | 18.65 (cabin) |
| Leg inclination | 54°35′26″ in the diagonal plane, 63.31° in front elevation | Eiffel §II; elevation angle derived and checked with Monod | slope 0.5017 m/m in elevation, bearings to line 1 |

Why the profile is a polyline: Eiffel built the outline from 29 straight panels, not a smooth curve.
Weidman & Pinelis list the widths and fit them with two exponentials. The model uses the table.
Monod's widths measure the axes of the outer corner members, not the outside of the steel. The
model's cage sits on those axes, with the columns and struts built around them.

## Counts

39 objects, about 88,000 rendered triangles (counted from the baked geometry in the viewer). The
editable masters total 7,586 vertices and 9,066 faces; the four piers, the four arches and every
repeated member are evaluated from one master by live modifiers. The build is about 380 commands.

## Comparisons

Captures are written to `--out`. These are the ones to look at, each against its reference:

| Capture | Reference |
| --- | --- |
| `010-ortho-over-monod.png`: orthographic, registered to the drawing | Monod's elevation, as the reference plane behind the model |
| `012-ortho-front-whole.png` | `photo-front-face-from-champ-de-mars.jpg` |
| `013-front-from-the-champ-de-mars.png` | the same photograph, perspective from the Champ de Mars axis |
| `014-three-quarter-from-pont-de-bir-hakeim.png` | `photo-diagonal-corner-view-from-pont-bir-hakeim.jpg` |
| `015-from-below-through-the-centre.png` | `photo-below-looking-up-through-centre.jpg` |
| `016-first-floor-and-arch.png` | `photo-first-floor-arch-frieze-front.jpg` |
| `017-second-floor.png` | `photo-second-level-platform.jpg` |
| `018-summit.png` | `photo-top-campanile-antennas.jpg` |

## What is approximate, and what is missing

Approximate (shape right, dimension or detail not from a drawing):

- **Corner-member sections.** These are 2.2 m at the bearings, tapering with the pier, and 1.5 → 0.9 m
  on the shaft. Pl. XXXI has the real built-up sections, but they are not legible in the available
  scan. The size was chosen to match the silhouette on Pl. I.
- **Pier width between the first and second floors.** It is a straight taper from 15.00 to 10.41 m.
  The book gives only the two ends.
- **Bracing.** There is one St Andrew's cross per panel face, with struts of diamond section (0.6–1.1 m).
  - Pl. VII shows that the lower panels also have secondary diagonals.
  - Every member on the real tower is itself a lattice girder.
  - Neither of these is modelled.
- **The arch.**
  - It is a semicircle in elevation lying on the sloping face. Pl. VII gives two radii in the plane
    of the face that were not legible.
  - Its scrollwork is represented by the poked lattice.
  - The openings above the arch are rectangular frames, where the real ones are arched.
- **First-floor void.** It is a 30 m square. The real one is a cushion shape about 28.6 m across
  at mid-side (Pl. XVIII), and today it is ringed by a glass floor. The view from below shows it
  noticeably smaller than the photograph.
- **Frieze, fascia, pavilions and canopy.**
  - Their heights are read from photographs and proportioned against the panel lines.
  - The 72 engraved names are not modelled.
  - The pavilions are opaque blocks rather than glazing.
- **The intermediate platform (z ≈ 194.5).** It is a plain balcony ring.
- **Everything above the third-floor cabin.** No modern drawing was found, so the enclosed top level,
  the equipment decks and the mast diameters are massing from photographs. The total height (330 m)
  and the 300.51 m terrace are sourced.

Not modelled: lifts and their inclined tracks, stairs, the machinery in the piers, lighting, people,
the Champ de Mars.

## References

The build itself loads only Monod's diagram. The others were used to read dimensions and to compare
captures. They live in `tmp/eiffel/references/`, which is gitignored. **None of the images are
committed:** the plates are large (up to 6 MB each), and three of the photographs carry
attribution or share-alike terms.

| File | Commons page | Licence |
| --- | --- | --- |
| `eiffel-diagram-elevation-1to1200-exterior-widths-monod-1890.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_plan.jpg | Public domain |
| `eiffel-pl01-elevation-diagrams-1to1000.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_01.jpg | Public domain |
| `eiffel-pl03-foundations-plan-pier-layout.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_03.jpg | Public domain |
| `eiffel-pl07-ossature-rabattement-legs-arch-campanile.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_07.jpg | Public domain |
| `eiffel-pl11-decorative-arches-first-floor-girders.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_11.jpg | Public domain |
| `eiffel-pl18-plans-ground-floor-piers-first-floor.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_20.jpg | Public domain |
| `eiffel-pl19-platform-elevations-upper-part.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_21.jpg | Public domain |
| `eiffel-pl20-vertical-section-diagonal-pile1-pile3.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_22.jpg | Public domain |
| `eiffel-pl31-elevation-diagram-panels-sections.jpg` | https://commons.wikimedia.org/wiki/File:Eiffel_Tower_plans_37.jpg | Public domain |
| `eiffel-summit-section-rouillard-1889.jpg` | https://commons.wikimedia.org/wiki/File:Le_sommet_de_la_Tour_Eiffel._Coupe_dessin%C3%A9ee_par_M._Rouillard.jpg | Public domain |
| `photo-front-face-from-champ-de-mars.jpg` | https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons.jpg (Benh LIEU SONG) | Public domain |
| `photo-diagonal-corner-view-from-pont-bir-hakeim.jpg` | https://commons.wikimedia.org/wiki/File:Tour_Eiffel_vue_depuis_pont_Bir_Hakeim_Paris_1.jpg (Chabe01) | CC0 |
| `photo-first-floor-arch-frieze-front.jpg` | https://commons.wikimedia.org/wiki/File:Tour_Eiffel_1er_%C3%A9tage_vu_du_Champ_de_Mars.jpg (Jebulon) | CC0 |
| `photo-below-looking-up-through-centre.jpg` | https://commons.wikimedia.org/wiki/File:The_Eiffel_Tower_looking_up.jpg (RedenimCrafts) | CC BY 4.0 |
| `photo-second-level-platform.jpg` | https://commons.wikimedia.org/wiki/File:Paris_Eiffel_Tower_second_floor_20150817.jpg (Ketounette) | CC BY-SA 4.0 |
| `photo-top-campanile-antennas.jpg` | https://commons.wikimedia.org/wiki/File:Top_of_the_Eiffel_Tower.jpg (Eutouring) | CC BY-SA 4.0 |

Monod's diagram is the original file:

```bash
mkdir -p tmp/eiffel/references && curl -L -A "threepipe-eiffel/1.0" \
  -o tmp/eiffel/references/eiffel-diagram-elevation-1to1200-exterior-widths-monod-1890.jpg \
  https://upload.wikimedia.org/wikipedia/commons/3/3c/Eiffel_plan.jpg
```

The build calibrates it on the tower axis, from line 1 (pixel row 2460, z = 6.40) to the third floor
(pixel row 369, z = 276.13), which gives 7.752 px/m. A different scan needs those two rows re-read.

Text sources:
- G. Eiffel, *La tour de trois cents mètres*, Paris, 1900, Tome I §II "Esquisse générale" and the plates
  (Gallica `bpt6k106381w`; archive.org `n-0106381-pdf-1-400`).
- E. Monod, *L'Exposition universelle de 1889* (1890), the elevation diagram above.
- P. Weidman & I. Pinelis, "Model equations for the Eiffel Tower profile", *C. R. Mécanique* 332
  (2004) 571–584, doi:10.1016/j.crme.2004.02.021. Table 1 gives the panel heights and widths.
- SETE key figures, https://www.toureiffel.paris/fr/le-monument/chiffres-cle (Wayback snapshot
  2024-12-09).
- FR-Wikipedia, "Tour Eiffel" and "Données techniques de la tour Eiffel", for the platform sides.
  These have no inline sources and conflict with the 1889 plate, as noted above.
