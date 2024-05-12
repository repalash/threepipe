/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Fri Dec 09 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {Vector2, Vector3} from "three";
import {Vertex} from "../../../three-mesh-halfedge";
import {vectors2Equal, vectors3Equal} from "../../utils";
import {ViewEdge} from "./ViewEdge";

export enum ViewVertexSingularity {
  None = "None",
  ImageIntersection = "ImageIntersection",
  MeshIntersection = "MeshIntersection",
  CurtainFold = "CurtainFold",
  Bifurcation = "Bifurcation",
}

export class ViewVertex {

  hash3d = "";
  hash2d = "";

  singularity = ViewVertexSingularity.None;

  readonly vertices = new Set<Vertex>();

  readonly pos3d = new Vector3();
  readonly pos2d = new Vector2();

  readonly viewEdges = new Array<ViewEdge>();

  visible = false;


  commonViewEdgeWith(other: ViewVertex) {
    for (const viewEdge of this.viewEdges) {
      if (other.viewEdges.includes(viewEdge)) {
        return viewEdge;
      }
    }
    return null;
  }

  isConnectedTo(other: ViewVertex) {
    return this.commonViewEdgeWith(other) != null;
  }

  matches3dPosition(position: Vector3, tolerance = 1e-4) {
    return vectors3Equal(this.pos3d, position, tolerance);
  }

  matches2dPosition(position: Vector2, tolerance = 1e-4) {
    return vectors2Equal(this.pos2d, position, tolerance);
  }

  get x() {
    return this.pos2d.x;
  }

  get y() {
    return this.pos2d.y;
  }

}
