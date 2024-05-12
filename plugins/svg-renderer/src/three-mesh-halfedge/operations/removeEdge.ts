/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Thu Nov 03 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189 
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { Halfedge } from "../core/Halfedge";
import { HalfedgeDS } from "../core/HalfedgeDS";
import { removeFace } from "./removeFace";

export function removeEdge(
    struct: HalfedgeDS,
    halfedge: Halfedge,
    mergeFaces = true) {
  
  /*
   *      ↖           ↙
   *        ↖       ↙
   *          ↖   ↙
   *            v2           
   *            ⇅        
   *            ⇅   
   *        he  ⇅  twin
   *            ⇅  
   *            v1
   *         ↗     ↘ 
   *       ↗         ↘
   *     ↗             ↘
   *                
   */

  const twin = halfedge.twin;

  if (mergeFaces && halfedge.face && twin.face) {
    // Keep only one face in both faces for halfedge and twin exist, and update
    // ref
    removeFace(struct, twin.face);
    halfedge.face.halfedge = halfedge.prev;
  } else {
    // Remove both faces
    if (halfedge.face) {
      removeFace(struct, halfedge.face);
    }

    if (twin.face) {
      removeFace(struct, twin.face);
    }
  }

  // Update topology around v1
  const v1 = halfedge.vertex;
  if (twin.next === halfedge) {
    // v1 is now isolated
    v1.halfedge = null;
  } else {
    v1.halfedge = twin.next;
    halfedge.prev.next = twin.next;
    twin.next.prev = halfedge.prev;
  }

  // Update topology around v2
  const v2 = twin.vertex;
  if (halfedge.next === twin) {
    // v2 is now isolated
    v2.halfedge = null;
  } else {
    v2.halfedge = halfedge.next;
    halfedge.next.prev = twin.prev;
    twin.prev.next = halfedge.next
  }

  // Remove halfedges from struct
  struct.halfedges.remove(halfedge);
  struct.halfedges.remove(twin);

}