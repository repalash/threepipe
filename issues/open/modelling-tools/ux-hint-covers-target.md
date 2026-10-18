# The first hint, "Click to select", covers the cube it points at

Found by the `house-walkthrough` demo, 2026-10-16. Rank: **minor** (first ten seconds of the first run).

## What happens

After the welcome, hint 1 is anchored at the projected *centre* of the object's bounding box with its
card to the right (`plugins/modelling-editor/src/ui/Hints.tsx:135-144`, `side: 'right'` from
`box.getCenter(v).project(...)`), so the card's arrow sits in the middle of the cube and the card hides its
right half, including the pulsing target (`demos/house-walkthrough/findings/hint-covers-cube.jpg`). At
1280x720 the card covers about 40% of the cube.

## Expected

A coach mark points at its target from outside it (Figma's onboarding tooltips, Spline's first-run
pointers): the arrow touches the target's edge.

## Suggested fix

Project the eight corners of the box and anchor at the right edge of their screen rectangle (vertical
centre), falling back to the left side when that is off-screen.
