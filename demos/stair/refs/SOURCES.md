# References for `demos/stair`

Nothing here was uploaded anywhere. The public-domain drawings are committed; the dealer's photographs
are kept locally for the report page and are **not committed** (all rights reserved; see
`.gitignore`). To fetch them again, use the URLs below.

## The spiral staircase: Safety Stairways Ltd cast-iron spiral

| File | Source | Author / rights |
| --- | --- | --- |
| `ukaa-24019-safety-stairways-*.jpg` (6 photos: top, elevation, three-quarter, tread casting, parts, landing) | UK Architectural Antiques, "Reclaimed Safety Stairways Cast Iron Spiral Staircase", ref 10118, <https://ukaa.com/reclaimed-safety-stairways-cast-iron-spiral-staircase-24019> (images `cdn.ukaa.com/products/182/24019/...`) | UK Architectural Antiques. All rights reserved. Used locally as a modelling reference only; not committed. |

The catalogue text (quoted in `build.mjs`): "13 steps including the top landing plate. Floor to floor
measures: 104". [...] The distance from the centre of the pole to the outside of the step is 26 ½".
This gives an overall maximum diameter of 53". The centre pole measures: 105 ½" Tall plus additional
37". The balcony spindles on the top landing measure 33 ½" Tall." The casting is marked
"SAFETY STAIRWAYS LTD" (tread-casting photo).

| Quantity | Catalogue | How it is used |
| --- | --- | --- |
| Diameter | 53" (1.3462 m); pole centre to tread edge 26.5" | tread outer radius |
| Rise | 104" / 13 rises = 8" (0.2032 m) | rise at 12 treads a turn; floor-to-landing for two turns is 24 x 8" = 192" (4.8768 m), kept fixed when the tread count changes |
| Treads per turn | 12 (30 degrees each), counted on the top-down photograph | default `STAIR_TREADS` |
| Newel above the landing | 37" (0.9398 m) | column above the landing |
| Spindle height | 33.5" (0.8509 m), balcony spindles | balusters and balcony spindles; the handrail sits on the baluster tops |
| Pole 3", collar 4.8", tread casting 5/8", nosing 1", rail 1.5" x 0.5" bar | read from the photographs against the 53" diameter | details, not checked |

Two full turns is the demo's brief, not the listing (13 rises is one turn and a tread).

## The arcade: Church of the Ascension, New York (HABS)

| File | Source | Author / rights |
| --- | --- | --- |
| `habs-ny-ascension-sheet8-interior-elevation.png` (+ the crop `habs-ascension-nave-bay-elevation.png`) | Historic American Buildings Survey, "Church of the Ascension, Fifth Avenue and Tenth Street, New York, New York County, NY", sheet 8 of 12, via Wikimedia Commons <https://commons.wikimedia.org/wiki/File:Church_of_the_Ascension,_Fifth_Avenue_and_Tenth_Street,_New_York,_New_York_County,_NY_HABS_NY,31-NEYO,95-_(sheet_8_of_12).png> | Columbia University for HABS, 1968. Public domain (US government work, HABS). |
| `habs-ny-ascension-sheet3-main-floor-plan.png` | same survey, sheet 3 of 12, <https://commons.wikimedia.org/wiki/File:Church_of_the_Ascension,_Fifth_Avenue_and_Tenth_Street,_New_York,_New_York_County,_NY_HABS_NY,31-NEYO,95-_(sheet_3_of_12).png> | Public domain (HABS). |
| `habs-ny-ascension-sheet7-transverse-section.png` | same survey, sheet 7 of 12, <https://commons.wikimedia.org/wiki/File:Church_of_the_Ascension,_Fifth_Avenue_and_Tenth_Street,_New_York,_New_York_County,_NY_HABS_NY,31-NEYO,95-_(sheet_7_of_12).png> | Public domain (HABS). |

The church is Richard Upjohn's (1840-41): a nave arcade of pointed arches on quatrefoil clustered
piers with moulded capitals and octagonal bases.

Readings. Sheet 8 is drawn with a scale bar "0 1 2 ... 10 FEET"; on the 3840 px wide download the
bar's 0 and 10 ticks are at x = 1770.7 and 2168.0 px, so 39.7 px/ft (the 5 ft tick gives 39.5; 39.6
used, about 1 % uncertainty). Positions were found by scanning pixel rows and columns of the scan.

| Quantity | Reading on sheet 8 | Value | Cross-check |
| --- | --- | --- | --- |
| Bay, pier centre to pier centre | 564.5 px | 14.25 ft (4.343 m) | plan, sheet 3: pier pitch 282.6 px at 19.9 px/ft (from its 11'-10" dimension) = 14.2 ft |
| Springing (top of the abacus) above the floor | 845 px | 21.34 ft (6.504 m) | |
| Intrados at the crown above the floor | 1205 px | 30.43 ft (9.275 m) | below the aisle ceiling, 31'-9" on sheet 7 |
| Intrados span at the springing | 447 px | 11.29 ft (3.441 m) | |
| Arch moulding, intrados to extrados at the crown | 67 px | 1.69 ft (0.516 m) | |
| Quatrefoil pier across the shafts | 106 px | 2.68 ft (0.817 m) | plan C-C on sheet 8 |
| Abacus across / capital height | 155 / 71 px | 3.91 / 1.79 ft | |
| Clerestory sill (string course under it) | 1339 px | 33.8 ft (10.30 m) | |
| Aisle ceiling (vault crown) | dimensioned on sheet 7 | 31'-9" (9.677 m) | |
| Aisle, pier centre to aisle wall | sheet 3, 301 px at 19.9 px/ft | 15.1 ft (4.603 m) | |

From span 3.441 m and rise 2.771 m the arch is two arcs of radius 3.091 m whose centres lie on the
springing line 1.370 m past the middle: a drop arch, a little blunter than equilateral.

What the model adds that the drawings do not show: the arcade is mirrored across the aisle (a
cloister-like walk rather than a nave with a wall), and the aisle has quadripartite rib vaults
(two pointed barrels meeting in groins, crowned at the 31'-9" ceiling). The church's real aisle
ceiling is the plaster ceiling drawn on sheet 7.
