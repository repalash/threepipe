// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 23/02/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

import { Line3, Vector3 } from 'three';
import { Face } from './Face';
import { Vertex } from './Vertex';
import { frontSide } from '../utils/geometry';

const _u = new Vector3();
const _v = new Vector3();
const _line = new Line3();

export class Halfedge {

  vertex: Vertex;

  // Set during the stucture build phase

  face: Face | null = null;
  declare twin: Halfedge;
  declare prev: Halfedge;
  declare next: Halfedge;

  constructor(vertex: Vertex) {
    this.vertex = vertex;
  }

  get id() {
    return this.vertex.id + '-'+ this.twin.vertex.id;
  }

  containsPoint(point: Vector3, tolerance = 1e-10): boolean {
    _u.subVectors(this.vertex.position, point)
    _v.subVectors(this.next.vertex.position, point)
    _line.set(this.vertex.position, this.next.vertex.position);
    _line.closestPointToPoint(point, true, _u);
    return _u.distanceTo(point) < tolerance;
  }

  /**
   * Indicates whether the halfedge is free (i.e. no connected face)
   *
   * @type       {boolean}
   */
  isFree() {
    return this.face === null;
  }

  /**
   * Indicated wetcher the halfedge is a boundary (i.e. no connected face but
   * twin has a face)
   */
  isBoundary() {
    return this.face === null && this.twin.face !== null;
  }

  /**
   * Returns true if the halfedge is concave, false if convexe.
   * IMPORTANT: Returns false if halfedge has no twin.
   *
   * @type       {boolean}
   */
  get isConcave() {
    if (this.twin) {
      return frontSide(
        this.vertex.position,
        this.next.vertex.position,
        this.prev.vertex.position,
        this.twin.prev.vertex.position) > 0;
    }
    return false;
  }

  /**
   * Returns a generator looping over all the next halfedges
   */
  *nextLoop() {
    const start: Halfedge = this;
    let curr: Halfedge = start;
    do {
      yield curr;
      curr = curr.next;
    } while(curr !== start);
    return null;
  }

  /**
   * Returns a generator looping over all the previous halfedges
   */
  *prevLoop() {
    const start: Halfedge = this;
    let curr: Halfedge = start;
    do {
      yield curr;
      curr = curr.next;
    } while(curr !== start);
    return null;
  }

}
