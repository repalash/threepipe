// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 17/03/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

import { Vector3, Triangle } from 'three';
import { Vertex } from './Vertex';
import { Halfedge } from './Halfedge';

const _viewVector = new Vector3();
const _normal = new Vector3();
const _triangle = new Triangle();
const _vec = new Vector3();

export class Face {

  halfedge: Halfedge;

  constructor(halfEdge: Halfedge) {
    this.halfedge = halfEdge;
  }

  getNormal(target: Vector3) {
    _triangle.set(
      this.halfedge.prev.vertex.position,
      this.halfedge.vertex.position,
      this.halfedge.next.vertex.position
    );
    _triangle.getNormal(target);
  }

  getMidpoint(target: Vector3) {
    _triangle.set(
      this.halfedge.prev.vertex.position,
      this.halfedge.vertex.position,
      this.halfedge.next.vertex.position
    );
    _triangle.getNormal(target);
  }

  /**
   * Returns wether the face facing the given position
   *
   * @param position  The position
   * @return `true` if face is front facing, `false` otherwise.
   */
  isFront(position: Vector3) {
    this.getNormal(_normal);
    return _viewVector
      .subVectors(position, this.halfedge.vertex.position)
      .normalize()
      .dot(_normal) >= 0;
  }

  /**
   * Returns the face halfedge containing the given position.
   * @param position Target position
   * @param tolerance Tolerance
   * @returns `HalfEdge` if found, `null` otherwise
   */
  halfedgeFromPosition(position: Vector3, tolerance = 1e-10): Halfedge | null {

    for (const he of this.halfedge.nextLoop()) {
      if (he.containsPoint(position, tolerance)) {
        return he;
      }
    }
    return null;
  }

  /**
   * Returns the face vertex that matches the given position within the tolerance
   * @param position 
   * @param tolerance 
   * @returns 
   */
  vertexFromPosition(position: Vector3, tolerance = 1e-10): Vertex | null {

    for (const he of this.halfedge.nextLoop()) {
      // Check if position is close enough to the vertex position within the
      // provided tolerance
      _vec.subVectors(he.vertex.position, position);

      if (_vec.length() < tolerance) {
        return he.vertex;
      }
    }
    return null;
  }

  /**
   * Returns the face halfedge starting from the given vertex

   * @param vertex 
   * @returns 
   */
  halfedgeFromVertex(vertex: Vertex) {
    
    for (const he of this.halfedge.nextLoop()) {
      if (he.vertex === vertex) {
        return he;
      }
    }
    return null;
  }

  hasVertex(vertex: Vertex) {
    for (const he of this.halfedge.nextLoop()) {
      if (he.vertex === vertex) {
        return true;
      }
    }
    return false;
  }
}
