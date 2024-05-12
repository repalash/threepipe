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

import {ViewEdge, VisibilityIndicatingNatures} from "../ViewEdge";
import {bush} from 'isect';
import {Vector2} from "three";
import {Viewmap} from "../Viewmap";
import {splitViewEdge2d} from "./splitEdge";
import {ViewVertexSingularity} from "../ViewVertex";
import {hashVector2} from "../../../utils";

const _vec = new Vector2();


/**
 * Finds the 2d singularities in the viewmap and mark them.
 * (Computes the intersection of ViewEdges in the image plane)
 *
 * @param viewmap
 */
export function find2dSingularities(viewmap: Viewmap) {

  const {viewEdges} = viewmap;

  const interAlgorithm = bush([...viewEdges]);
  let intersections = interAlgorithm.run() as Array<{
    segments: ViewEdge[],
    point: {x: number, y: number}
  }>;

  // Keep intersections of non connected edges with at least one visibility
  // indicating ViewEdgeNature
  intersections = intersections.filter(({segments: [a,b]}) => {
    return !(a).isConnectedTo(b) &&
      (VisibilityIndicatingNatures.has(a.nature) ||
      VisibilityIndicatingNatures.has(b.nature));
  });

  // As we will cut viewEdge recursively in small viewEdge, we store the current
  // cuts in a map
  const cutMap = new Map<ViewEdge, ViewEdge[]>();

  for (const intersection of intersections) {

    const splitViewVertices = [];

    _vec.set(intersection.point.x, intersection.point.y);
    const hash = hashVector2(_vec);

    for (const viewEdge of intersection.segments) {

      // Setup edge cuts if needed
      let cuts = cutMap.get(viewEdge);
      if (!cuts) {
        cuts = [viewEdge];
        cutMap.set(viewEdge, cuts);
      }

      // Test the cuts to find the intersection point
      let i = 0;
      let splitResult = null;
      while(i < cuts.length && splitResult === null) {
        splitResult = splitViewEdge2d(viewmap, cuts[i], _vec);
        i += 1;
      }

      if (splitResult) {
        splitViewVertices.push(splitResult.viewVertex);

        /*
         * Overwrite position and hash so we are sure the vertices have the
         * exact same 2D position from the camera which is CRUCIAL for the
         * CGAL step
         */
        splitResult.viewVertex.pos2d.copy(_vec);
        splitResult.viewVertex.hash2d = hash;

        if (splitResult.viewEdge) {
          cuts.push(splitResult.viewEdge);
        }

      } else {
        // console.error("Image intersection -- Edge could not be splitted", cuts, _vec);
      }
    }

    if (splitViewVertices.length === 0) {
      // console.error("Image intersection -- Should have 2 split vertices");
    } else if (splitViewVertices.length === 1) {
      const v = splitViewVertices[0];
      v.singularity = ViewVertexSingularity.ImageIntersection;
    } else {
      const v1 = splitViewVertices[0];
      const v2 = splitViewVertices[1];

      // Compute the distance between the vertices and the camera.
      // We only need to insert a singularity point at the farest vertex
      // If equal, both vertices get a singularity
      // See https://hal.inria.fr/hal-02189483, image intersections of type T-cusp

      const d1 = v1.pos3d.distanceTo(viewmap.camera.position);
      const d2 = v2.pos3d.distanceTo(viewmap.camera.position);

      if (d1 > d2 + 1e-10) {
        v1.singularity = ViewVertexSingularity.ImageIntersection;
      } else if (d2 > d1 + 1e-10) {
        v2.singularity = ViewVertexSingularity.ImageIntersection;
      } else {
        v1.singularity = ViewVertexSingularity.ImageIntersection;
        v2.singularity = ViewVertexSingularity.ImageIntersection;
      }
    }
  }
}

