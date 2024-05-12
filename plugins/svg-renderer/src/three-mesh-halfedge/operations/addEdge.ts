/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Tue Oct 25 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {Halfedge} from "../core/Halfedge";
import {HalfedgeDS} from "../core/HalfedgeDS";
import {Vertex} from "../core/Vertex";

export function addEdge(
    struct: HalfedgeDS,
    v1: Vertex,
    v2: Vertex,
    allowParallels = false) {

  if (v1 === v2) {
    throw new Error('Vertices v1 and v2 should be different');
  }

  if (!allowParallels) {
    // Check if v1 and v2 are already connected
    const currentHalfEdge = v1.getHalfedgeToVertex(v2);
    if (currentHalfEdge) {
      return currentHalfEdge;
    }
  }

  if (!v1.isFree() || !v2.isFree()) {
    throw new Error('Vertices v1 and v2 are not free');
  }

  // Create new halfedges, by default twin halfedges are connected together
  // as prev/next in case vertices are isolated
  const h1 = new Halfedge(v1);
  const h2 = new Halfedge(v2);
  h1.twin = h2;
  h1.next = h2;
  h1.prev = h2;
  h2.twin = h1;
  h2.next = h1;
  h2.prev = h1;

  /*
   *        ↖       ↙
   *   out2   ↖   ↙   in2
   *            v2
   *            ⇅
   *            ⇅
   *        h1  ⇅  h2
   *            ⇅
   *            ⇅
   *            v1
   *    in1  ↗     ↘  out1
   *       ↗         ↘
   *
   */


  // Update refs around v1 if not isolated
  const in1 = v1.freeHalfedgesInLoop().next().value;
  if (in1) {
    const out1 = in1.next;
    h1.prev = in1;
    in1.next = h1;

    h2.next = out1;
    out1.prev = h2;
  } else {
    v1.halfedge = h1;
  }

  // Update refs around v2 if not isolated
  const in2 = v2.freeHalfedgesInLoop().next().value;
  if (in2) {

    const out2 = in2.next;
    h2.prev = in2;
    in2.next = h2;

    h1.next = out2;
    out2.prev = h1;
  } else {
    v2.halfedge = h2;
  }

  struct.halfedges.push(h1);
  struct.halfedges.push(h2);

  return h1;
}

