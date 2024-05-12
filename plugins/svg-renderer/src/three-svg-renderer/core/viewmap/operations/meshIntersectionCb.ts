/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Wed Nov 30 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {trianglesIntersect} from "fast-triangle-triangle-intersection";
import {Line3, Matrix4, Triangle, Vector3} from "three";
import {Face} from "../../../../three-mesh-halfedge";
import {SVGMesh} from "../../SVGMesh";

const _matrix = new Matrix4();
const _line = new Line3();
const _points = new Array<Vector3>();

export class TriIntersectionInfo {
  name = "";
  nbTests = Infinity;
  nbIntersections = Infinity;
  time = Infinity;
}

/**
 * Run the specify callback for all
 * @param meshA
 * @param meshB
 * @param callback
 * @param info
 */
export function meshIntersectionCb(
    meshA: SVGMesh,
    meshB: SVGMesh,
    callback: (meshA: SVGMesh, meshB: SVGMesh, line: Line3, faceA: Face, faceB: Face) => void,
    info = new TriIntersectionInfo()) {

  const startTime = Date.now();

  info.name = meshA.name + ' ∩ ' + meshB.name;
  info.nbTests = 0;
  info.nbIntersections = 0;

  _matrix.copy(meshA.matrixWorld).invert().multiply(meshB.matrixWorld);

  meshA.bvh.bvhcast(meshB.bvh, _matrix, {

    intersectsTriangles: (t1: Triangle, t2: Triangle, idx1: number, idx2: number) => {

      info.nbTests += 1;

      if (trianglesIntersect(t1, t2, _points) !== null) {

        info.nbIntersections += 1;

        // Ignore intersection on a single point
        if (_points.length === 1) {
          return false;
        }
        else if (_points.length > 2) {
          _points.push(_points[0]);
        }

        for (let i=0; i<_points.length-1; i++) {

          _line.start.copy(_points[i]);
          _line.end.copy(_points[i+1]);

          if (_line.distance() > 1e-10) {
            _line.applyMatrix4(meshA.matrixWorld);
            callback(meshA, meshB, _line, meshA.hes.faces[idx1], meshB.hes.faces[idx2]);
          }
        }
      }
      return false;
    }
  });

  info.time = Date.now() - startTime;
}
