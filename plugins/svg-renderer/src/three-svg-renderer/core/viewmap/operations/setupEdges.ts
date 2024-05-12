/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Wed Nov 16 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {Halfedge} from "../../../../three-mesh-halfedge";
import {frontSide} from "../../../utils";
import {ViewEdge, ViewEdgeNature} from "../ViewEdge";
import {Viewmap} from "../Viewmap";
import {PerspectiveCamera, Vector3} from "three";
import {createViewVertex} from "./createViewVertex";

export interface ViewEdgeNatureOptions {
  creaseAngle?: {min: number, max: number};
}

const _u = new Vector3();
const _v = new Vector3();

/**
 * Returns the list
 * @param meshes
 * @param camera
 * @param options
 * @returns
 */
export function setupEdges(
    viewmap: Viewmap,
    options: ViewEdgeNatureOptions) {

  const {viewEdges, camera, meshes} = viewmap;
  const handledHalfedges = new Set<Halfedge>();

  for (const mesh of meshes) {

    for (const face of mesh.hes.faces) {
      face.viewEdges = new Array<ViewEdge>();
    }

    for (const halfedge of mesh.hes.halfedges) {

      if (!handledHalfedges.has(halfedge.twin)) {

        handledHalfedges.add(halfedge);

        const props = propsForViewEdge(halfedge, camera, options);

        if (props) {

          const meshv1 = halfedge.vertex;
          const meshv2 = halfedge.twin.vertex;

          // Get the viewmap points from the vertices or create them
          const v1 = createViewVertex(viewmap, meshv1.position);
          const v2 = createViewVertex(viewmap, meshv2.position);

          meshv1.viewVertex = v1;
          meshv2.viewVertex = v2;

          // Point stores a set of vertices, so unicity is guaranted
          v1.vertices.add(meshv1);
          v2.vertices.add(meshv2);

          const viewEdge = new ViewEdge(v1, v2, props.nature, halfedge);
          viewEdge.faceAngle = props.faceAngle;
          viewEdge.isConcave = props.isConcave;
          viewEdge.isBack = props.isBack;
          viewEdge.meshes.push(mesh);

          v1.viewEdges.push(viewEdge);
          v2.viewEdges.push(viewEdge);

          if (halfedge.face) {
            halfedge.face.viewEdges.push(viewEdge);
            viewEdge.faces.push(halfedge.face);
          }

          if (halfedge.twin.face) {
            halfedge.twin.face.viewEdges.push(viewEdge);
            viewEdge.faces.push(halfedge.twin.face);
          }

          viewEdges.push(viewEdge);
        }
      }
    }
  }
}
export function propsForViewEdge(
    halfedge: Halfedge,
    camera: PerspectiveCamera,
    options?: ViewEdgeNatureOptions) {

  const props = {
    nature: ViewEdgeNature.Silhouette,
    faceAngle: 0,
    isConcave: false,
    isBack: false,
  }

  const opt = {
    creaseAngle: {min: 80, max: 100},
    ...options
  }

  // If halfedge only has one connected face, then it is a boundary
  if (!halfedge.face || !halfedge.twin.face) {
    props.nature = ViewEdgeNature.Boundary;
    return props;
  } else {
    const faceAFront = halfedge.face.isFront(camera.position);
    const faceBFront = halfedge.twin.face.isFront(camera.position);

    // If edge is between two back faces, then it is a back edge
    props.isBack = !faceAFront && !faceBFront;

    // Compute the angle between the 2 connected face
    halfedge.face.getNormal(_u);
    halfedge.twin.face.getNormal(_v);
    props.faceAngle = Math.acos(_u.dot(_v)) * 180 / Math.PI;

    // Concavity is determined by an orientation test
    props.isConcave = frontSide(
      halfedge.prev.vertex.position,
      halfedge.vertex.position,
      halfedge.next.vertex.position,
      halfedge.twin.prev.vertex.position);

    // If edge is between front and back face, then it is a silhouette edge
    if (faceAFront !== faceBFront) {

      props.nature = ViewEdgeNature.Silhouette;
      return props;

    } else if(opt.creaseAngle.min <= props.faceAngle &&
              props.faceAngle <= opt.creaseAngle.max) {
      props.nature = ViewEdgeNature.Crease;
      return props;
    }
  }

  return null;
}
