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

import { Vector3 } from "three";
import { Halfedge } from "../core/Halfedge";
import { HalfedgeDS } from "../core/HalfedgeDS";
import { Vertex } from "../core/Vertex";

export function splitEdge(
    struct: HalfedgeDS,
    halfedge: Halfedge,
    position: Vector3, 
    tolerance = 1e-10) {

  /**
   * From
   *            A -------------- he -------------> B 
   *            A <------------ twin ------------- B 
   * To         
   *            A ---- he ----> v ---- newhe ----> B
   *            A <--- twin --- v <--- newtwin --- B
   */

  const twin = halfedge.twin;
  const A = halfedge.vertex;
  const B = twin.vertex;

  // No need to split if position matches A or B
  if (A.matchesPosition(position, tolerance)) {
    return A;
  }
  if (B.matchesPosition(position, tolerance)) {
    return B;
  }

  const newVertex = new Vertex();
  newVertex.position.copy(position);

  // Create the new halfegdes
  const newHalfedge = new Halfedge(newVertex);
  const newTwin = new Halfedge(B);
  newHalfedge.twin = newTwin;
  newTwin.twin = newHalfedge;

  // Update vertices halfedge refs
  A.halfedge = halfedge;
  newVertex.halfedge = newHalfedge;
  B.halfedge = newTwin;


  // Copy the face refs
  newHalfedge.face = halfedge.face;
  newTwin.face = twin.face;
  
  // Update next and prev refs
  newHalfedge.next = halfedge.next;
  newHalfedge.prev = halfedge;
  halfedge.next = newHalfedge;
  newTwin.next = twin;
  newTwin.prev = twin.prev;
  twin.prev = newTwin;

  // Update structure
  struct.vertices.push(newVertex);
  struct.halfedges.push(newHalfedge);
  struct.halfedges.push(newTwin);

  return newVertex;
}
