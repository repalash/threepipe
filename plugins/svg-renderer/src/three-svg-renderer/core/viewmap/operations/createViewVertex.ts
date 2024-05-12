/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Mon Dec 12 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189 
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { Vector3 } from "three";
import { hashVector2, hashVector3, projectPoint } from "../../../utils";
import { Viewmap } from "../Viewmap";
import { ViewVertex } from "../ViewVertex";

/**
 * Creates a ViewVertex at the given position if no one already exist
 * @param viewmap 
 * @param pos3d 
 * @returns 
 */
export function createViewVertex(viewmap: Viewmap, pos3d: Vector3) {

  const {camera, viewVertexMap, renderSize} = viewmap;

  const hash3d = hashVector3(pos3d);
  let viewVertex = viewVertexMap.get(hash3d);
  if (!viewVertex) {
    viewVertex = new ViewVertex();
    viewVertex.pos3d.copy(pos3d);
    projectPoint(pos3d, viewVertex.pos2d, camera, renderSize);
    viewVertex.hash2d = hashVector2(viewVertex.pos2d);
    viewVertex.hash3d = hash3d;
    viewVertexMap.set(hash3d, viewVertex);
  }
  return viewVertex;

}