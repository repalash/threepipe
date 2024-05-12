/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Fri Nov 04 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {Face} from "../core/Face";
import {Halfedge} from "../core/Halfedge";
import {HalfedgeDS} from "../core/HalfedgeDS";

export function addFace(struct: HalfedgeDS, halfedges: Halfedge[]) {

  const size = halfedges.length;
  if (size < 2) {
    throw new Error("At least 3 halfedges required to build a face.");
  }

  // Make some checks before changing topology
  for (let i=0; i<size; i++) {

    const curr = halfedges[i];
    const next = halfedges[(i+1) % size];

    if (curr.face) {
      throw new Error("Halfedge already has a face");
    }

    if (curr.twin.vertex !== next.vertex) {
      throw new Error("Halfedges do not form a chain");
    }
  }

  // Add the face
  for (let i = 0; i<size; i++) {

    const curr = halfedges[i];
    const next = halfedges[(i+1) % size];

    if (!makeHalfedgesAdjacent(curr, next)) {
      throw new Error('Face cannot be created: mesh would be non manifold.');
    }
  }

  const face = new Face(halfedges[0]);
  for (const halfedge of halfedges) {
    halfedge.face = face;
  }

  struct.faces.push(face);
  return face;
}

/**
 *
 *
 * @see https://kaba.hilvi.org/homepage/blog/halfedge/halfedge.htm
 *
 * @param
 * @param out
 * @returns
 */
function makeHalfedgesAdjacent(
    halfIn: Halfedge,
    halfOut: Halfedge): boolean {

  if (halfIn.next === halfOut) {
    // Adjacency is alrady correct
    return true;
  }

  // Find a boundary halfedge different from out.twin and in
  let g: Halfedge | null = null;
  const loop = halfOut.vertex.freeHalfedgesInLoop(halfOut);
  let he = loop.next();
  while (!g && !he.done) {
    if (he.value !== halfIn) {
      g = he.value;
    }
    he = loop.next();
  }

  if (!g) {
    return false;
  }

  const b = halfIn.next;
  const d = halfOut.prev;
  const h = g.next;

  halfIn.next = halfOut;
  halfOut.prev = halfIn;

  g.next = b;
  b.prev = g;

  d.next = h;
  h.prev = d;

  return true;
}
