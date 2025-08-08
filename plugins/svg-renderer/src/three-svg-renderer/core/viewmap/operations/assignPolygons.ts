/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Tue Nov 22 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { Color, ColorRepresentation, Mesh, Raycaster, Vector2 } from "three";
import { imagePointToNDC } from "../../../utils";
import { SVGMesh } from "../../SVGMesh";
import { Viewmap } from "../Viewmap";


export interface AssignPolygonOptions {
  defaultMeshColor: ColorRepresentation;
}

export class AssignPolygonInfo {
  assigned = Infinity;
  nonAssigned = Infinity;
}

const _color = new Color();
const _raycaster = new Raycaster();
const _vec2 = new Vector2();

export function assignPolygons(
    viewmap: Viewmap,
    options?: AssignPolygonOptions,
    info = new AssignPolygonInfo()) {

  options = {
    defaultMeshColor: 0x333333,
    ...options,
  }

  _color.set(options.defaultMeshColor);

  info.assigned = 0;
  info.nonAssigned = 0;

  const {meshes, renderSize, camera, polygons} = viewmap;

  const svgMeshesMap = new Map<Mesh, SVGMesh>();
  const threeMeshes = new Array<Mesh>();

  for (const mesh of meshes) {
    svgMeshesMap.set(mesh.threeMesh, mesh);
    threeMeshes.push(mesh.threeMesh);
  }

  for (const polygon of polygons) {

    imagePointToNDC(polygon.insidePoint, _vec2, renderSize);
    _raycaster.setFromCamera(_vec2, camera);
    // _raycaster.firstHitOnly = true; // todo?
    const intersections = _raycaster.intersectObjects(threeMeshes, false);

    if (intersections.length > 0) {
      const intersection = intersections[0];
      const faceIndex = intersection.faceIndex;
      if (faceIndex !== undefined) {
        const intersectionMesh = intersection.object as Mesh;
        polygon.mesh = svgMeshesMap.get(intersectionMesh);
        if (polygon.mesh) {
          polygon.color.copy(polygon.mesh.colorForFaceIndex(faceIndex) || _color);
          info.assigned += 1;
        } else {
          console.error(`Could not associate SVG mesh to polygon ${polygon.id}`);
        }
      } else {
        console.error(`Polygon ${polygon.id} intersection has no face index`,intersection);
      }
    }
  }

  info.nonAssigned = polygons.length - info.assigned;
}
