// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 17/03/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Vector3} from 'three';
import type {Face} from './Face';
import {Halfedge} from './Halfedge';

const _u = new Vector3();
let _idCount = 0;

export class Vertex {
  /** Vertex position */
  readonly position: Vector3 = new Vector3();

  /** Reference to one halfedge starting from the vertex */
  halfedge: Halfedge | null = null;

  id: number;

  constructor() {
    this.id = _idCount;
    _idCount++;
  }

  /**
   * Returns a generator of free halfedges starting from this vertex.
   * @param start The halfedge to start, default is vertex halfedge
   */
  *freeHalfedgesOutLoop(start = this.halfedge) {
    for (const halfedge of this.loopCW(start)) {
      if (halfedge.isFree()) {
        yield halfedge;
      }
    }
    return null;
  }

  /**
   * Returns a generator of free halfedges arriving to this vertex.
   * @param start The halfedge to start, default is vertex halfedge
  */
  *freeHalfedgesInLoop(start = this.halfedge) {
    for (const halfedge of this.loopCW(start)) {
      if (halfedge.twin.isFree()) {
        yield halfedge.twin;
      }
    }
    return null;
  }

  /**
   * Returns a generator of boundary halfedges starting from this vertex.
   * @param start The halfedge to start, default is vertex halfedge
   */
  *boundaryHalfedgesOutLoop(start = this.halfedge) {
    for (const halfedge of this.loopCW(start)) {
      if (halfedge.isBoundary()) {
        yield halfedge;
      }
    }
    return null;
  }

  /**
   * Returns a generator of boundary halfedges arriving to this vertex.
   * @param start The halfedge to start, default is vertex halfedge
  */
  *boundaryHalfedgesInLoop(start = this.halfedge) {
    for (const halfedge of this.loopCW(start)) {
      if (halfedge.twin.isBoundary()) {
        yield halfedge.twin;
      }
    }
    return null;
  }

  /**
   * Returns whether the vertex is free, i.e. on of its ongoing halfedge has no
   * face.
   *
   * @ref https://kaba.hilvi.org/homepage/blog/halfedge/halfedge.htm
   *
   * @returns `true` if free, `false` otherwise
   */
  isFree() {
    if (this.isIsolated()) {
      return true;
    }
    for (const halfEdge of this.loopCW()) {
      if (halfEdge.isFree()) {
        return true;
      }
    }
    return false;
  }

  isIsolated() {
    return this.halfedge === null;
  }

  commonFacesWithVertex(other: Vertex) {
    const faces = new Array<Face>();
    for (const halfedge of this.loopCW()) {
      if (halfedge.face && halfedge.face.hasVertex(other)) {
        faces.push(halfedge.face);
      }
    }
    return faces;
  }

  /**
   * Checkes whether the vertex matches the given position
   *
   * @param      {Vector3}  position           The position
   * @param      {number}   [tolerance=1e-10]  The tolerance
   * @return     {boolean}
   */
  matchesPosition(position: Vector3, tolerance = 1e-10): boolean {
    _u.subVectors(position, this.position);
    return _u.length() < tolerance;
  }

  /**
   * Returns the halfedge going from *this* vertex to *other* vertex if any.
   * @param other The other vertex
   * @returns `HalfEdge` if found, `null` otherwise.
   */
  getHalfedgeToVertex(other: Vertex): Halfedge | null {
    for (const halfEdge of this.loopCW()) {
      if (halfEdge.twin.vertex === other) {
        return halfEdge;
      }
    }
    return null;
  }

  isConnectedToVertex(other: Vertex) {
    return this.getHalfedgeToVertex(other) !== null;
  }

  static MAX_LOOP = Infinity;
  /**
   * Returns a generator of halfedges starting from this vertex in CW order.
   * @param start The halfedge to start looping, default is vertex halfedge
   */
  *loopCW(start = this.halfedge, maxLoop?: number) {
    let i = 0
    if (start && start.vertex === this) {
      let curr: Halfedge = start;
      do {
        yield curr;
        curr = curr.twin.next;
        i++;
        if(i>(maxLoop||Vertex.MAX_LOOP)){
          break;
        }
      } while(curr != start);
    }
    return null;
  }

  /**
   * Returns a generator of halfedges starting from this vertex in CCW order.
   * @param start The halfedge to start, default is vertex halfedge
   */
  *loopCCW(start = this.halfedge, maxLoop?: number) {
    let i = 0
    if (start && start.vertex === this) {
      let curr: Halfedge = start;
      do {
        yield curr;
        curr = curr.prev.twin;
        i++;
        if(i>(maxLoop||Vertex.MAX_LOOP)){
          break;
        }
      } while(curr != start);
    }
    return null;
  }
}


