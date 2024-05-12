/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Tue Nov 29 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {Line3, Vector3} from "three";
import {Face} from "../../../../three-mesh-halfedge";
import {intersectLines} from "../../../utils";
import {SVGMesh} from "../../SVGMesh";
import {ViewEdge, ViewEdgeNature} from "../ViewEdge";
import {Viewmap} from "../Viewmap";
import {createViewVertex} from "./createViewVertex";
import {meshIntersectionCb, TriIntersectionInfo} from "./meshIntersectionCb";
import {splitViewEdge3d} from "./splitEdge";


const _line = new Line3();
const _inter = new Vector3();
const _lineDir = new Vector3();
const _dir = new Vector3();

export class MeshIntersectionInfo {
  details = new Array<TriIntersectionInfo>();
  nbTests = Infinity;
  nbIntersections = Infinity;
  nbMeshesTested = Infinity;
  nbEdgesAdded = Infinity;
}

export function computeMeshIntersections(
    viewmap: Viewmap,
    info = new MeshIntersectionInfo()) {

  const {meshes} = viewmap;

  info.nbMeshesTested = 0;
  info.nbIntersections = 0;
  info.nbTests = 0;
  info.nbEdgesAdded = 0;


  const intersectCallback = (
      meshA: SVGMesh, meshB: SVGMesh, line: Line3,
      faceA: Face, faceB: Face) => {
    if(!faceA || !faceB) {
        // console.error("No face found", faceA, faceB);
        return;
    }

    // Create vertices for line ends
    const v1 = createViewVertex(viewmap, line.start);
    const v2 = createViewVertex(viewmap, line.end);
    const intersectionViewVertices = [v1, v2];

    // Gather all the viewEdges that lie on faceA and faceB and check if
    // they intersect with the line
    const faceViewEdges = new Set([...faceA.viewEdges, ...faceB.viewEdges]);

    for (const e of faceViewEdges) {

      _line.set(e.a.pos3d, e.b.pos3d);

      if (intersectLines(_line, line, _inter)) {
        const splitResult = splitViewEdge3d(viewmap, e, _inter);

        if (splitResult) {
          if (!intersectionViewVertices.includes(splitResult.viewVertex)) {
            intersectionViewVertices.push(splitResult.viewVertex);
          }
        } else {
          console.error("Intersection but split failed");
        }
      }
    }

    // Sort point along the line
    _dir.subVectors(line.end, line.start);
    intersectionViewVertices.sort((a,b) => {
      _dir.subVectors(b.pos3d, a.pos3d);
      return _dir.dot(_lineDir)
    });

    // Create new edges
    for (let i = 0; i<intersectionViewVertices.length-1; i++) {

      const v1 = intersectionViewVertices[i];
      const v2 = intersectionViewVertices[i+1];

      const viewEdge = new ViewEdge(v1, v2, ViewEdgeNature.MeshIntersection);
      viewEdge.meshes.push(meshA, meshB);
      viewEdge.faces.push(faceA, faceB);

      v1.viewEdges.push(viewEdge);
      v2.viewEdges.push(viewEdge);

      faceA.viewEdges.push(viewEdge);
      faceB.viewEdges.push(viewEdge);

      viewmap.viewEdges.push(viewEdge);
    }
  }

  // Apply the callback for every pair of meshes
  // TODO: Need to run that for self-intersections as well
  for (let i=0; i<meshes.length-1; i++) {
    for (let j=i+1; j<meshes.length; j++) {

      const meshA = meshes[i];
      const meshB = meshes[j];

      const triInfo = new TriIntersectionInfo();
      meshIntersectionCb(meshA, meshB, intersectCallback, triInfo);

      info.nbIntersections += triInfo.nbIntersections;
      info.nbTests += triInfo.nbTests;
      info.nbMeshesTested += 1;
      info.details.push(triInfo);
    }
  }
}
