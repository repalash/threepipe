# @threepipe/plugin-mesh-edit Changelog

## 0.1.0

- Initial package. Edit mode with vertex/edge/face element selection, overlays, screen-space element
  picking with Blender's priority and cycling rules, mode switching, select all/none/invert/linked,
  and keyed suspension of the object-mode interaction plugins.
- Edge slide and vertex slide as transform modes (`G G`, `transform_mode_edge_slide.cc`,
  `transform_mode_vert_slide.cc`), and Loop Cut and Slide (`startLoopCut`, the ring preview, `loopCutBy` for
  redo, `editmesh_loopcut.cc`).
