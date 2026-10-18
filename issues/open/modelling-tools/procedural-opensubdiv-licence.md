# plugin-procedural: OpenSubdiv port needs a licence decision

**Found by**: track2-procedural, 2026-10-18. Plan: [15b-opensubdiv-port](./15b-opensubdiv-port.md).

Blender 5.2.2's Subdivide Mesh and Subdivision Surface nodes run `bke::subdiv` on top of OpenSubdiv 3.7.0
(`build_files/build_environment/cmake/versions.cmake:232`). A bit-exact port has to port OpenSubdiv's Sdc/Vtr/Far/Osd
code (~30k lines in scope). OpenSubdiv is licensed under the **Tomorrow Open Source Technology License 1.0** (Apache-2.0
with a different trademark section), not plain Apache-2.0 like the package.

Being done on `track2-procedural`: the port keeps the TOST-1.0 notice in every ported file and the licence/notice text
in `plugins/procedural/porting/opensubdiv-LICENSE.txt`.

**Decision needed before merging**: accept TOST-1.0-derived files in `@threepipe/plugin-procedural` (with the notices),
or keep them in a separately licensed sub-package. Same question as `procedural-eigen-port-licence.md` (MPL-2.0).
Without the port, Subdivide Mesh / Subdivision Surface stay unported (Buildify `building_base`, candy bounce floor and
the rose asset are blocked on them).
