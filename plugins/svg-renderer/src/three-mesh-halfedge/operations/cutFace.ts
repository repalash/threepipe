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

import { Face } from "../core/Face";
import { Halfedge } from "../core/Halfedge";
import { HalfedgeDS } from "../core/HalfedgeDS";
import { Vertex } from "../core/Vertex";

export function cutFace(
    struct: HalfedgeDS,
    face: Face,
    v1: Vertex,
    v2: Vertex,
    createNewFace = true){
  
  if (v1 === v2) {
    throw new Error('Vertices v1 and v2 should be different');
  }

  let out1 = face.halfedgeFromVertex(v1);
  if (!out1 && !v1.isFree()) {
    throw new Error('Vertices v1 does not belong to face nor is free');
  }

  let out2 = face.halfedgeFromVertex(v2);
  if (!out2 && !v2.isFree()) {
    throw new Error('Vertices v2 does not belong to face nor is free');
  }

  // Check if v1 is already connected to v2 in the face
  if ((out1 && out1.next.vertex === v2) || (out2 && out2.next.vertex === v1)) {
    throw new Error("Vertices v1 and v2 are already connected");
  }

  /*
   *          From                    To
   *
   *    o → → → v1 → → → o       o → → → v1 → → → o              
   *      ↖            ↙           ↖  f  ↓↑  f' ↙       
   *        ↖    f   ↙               ↖   ↓↑   ↙    
   *          ↖    ↙                   ↖ ↓↑ ↙  
   *            v2                       v2
   * 
   *                        or
   *
   *    o → → → o → → → o        o → → → v1 → → → o              
   *      ↖   f ↓↑     ↙           ↖  f  ↓↑  f' ↙       
   *        ↖   v1   ↙               ↖   ↓↑   ↙    
   *          ↖    ↙                   ↖ ↓↑ ↙  
   *            v2                       v2
   * 
   *  --------------------------------------
   * 
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

  // Create new halfedges
  const h1 = new Halfedge(v1);
  const h2 = new Halfedge(v2);
  h1.face = face;
  h2.face = face;
  h1.twin = h2;
  h1.next = h2;
  h1.prev = h2;
  h2.twin = h1;
  h2.next = h1;
  h2.prev = h1;

  // If v1 is not part of face, get any outgoing halfedge
  out1 = out1 ?? v1.freeHalfedgesOutLoop().next().value;

  // Update refs around v1 if not isolated
  if (out1) {
    const in1 = out1.prev;
    h1.prev = in1;
    in1.next = h1;

    h2.next = out1;
    out1.prev = h2;
  } else {
    v1.halfedge = h1;
  }

  // If v2 is not part of face, get any outgoing halfedge
  out2 = out2 ?? v2.freeHalfedgesOutLoop().next().value;

  // Update refs around v2 if not isolated
  if (out2) {

    const in2 = out2.prev;
    h2.prev = in2;
    in2.next = h2;

    h1.next = out2;
    out2.prev = h1;  
  } else {
    v2.halfedge = h2;
  }

  struct.halfedges.push(h1);
  struct.halfedges.push(h2);

  // In the case where we connect isolated halfedge (without face) to this face, 
  // We update face ref loop
  for (const he of face.halfedge.nextLoop()){
    he.face = face;
  }

  // Check if h1 and h2 (twin halfedges) are on the same loop, if there aren't,
  // it means we created a new halfedges loop, i.e. new face
  let found = false;
  const loop = h1.nextLoop();
  let h = loop.next();
  while(!found && !h.done) {
    found = h.value === h2;
    h = loop.next();
  }

  if (!found) {
    // h2 is on a different loop than h1

    // Update initial face halfedge reference in case it changed loop 
    face.halfedge = h1;

    let newFace = null;

    if (createNewFace) {
      newFace = new Face(h2);
      struct.faces.push(newFace);
    }

    // Update the face ref for each halfedge of the new loop either a new face
    // or null
    for (const h of h2.nextLoop()) {
      h.face = newFace;
    }
  }

  return h1;
}