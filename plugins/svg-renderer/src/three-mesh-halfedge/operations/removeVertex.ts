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

import { HalfedgeDS } from "../core/HalfedgeDS";
import { Vertex } from "../core/Vertex";
import { removeEdge } from "./removeEdge";

/*
 *         From                            To    
 * 
 * 
 *            o                              o          
 *          ↙ ⇅ ↖                          ↙   ↖        
 *        ↙   ⇅   ↖                      ↙       ↖      
 *      ↙ f1  ⇅  f4 ↖                  ↙           ↖    
 *    ↙       ⇅       ↖              ↙               ↖  
 *  o ⇄ ⇄ ⇄ ⇄ v ⇄ ⇄ ⇄ ⇄ o          o         f         o
 *    ↘       ⇅       ↗              ↘               ↗  
 *      ↘ f2  ⇅  f3 ↗                  ↘           ↗    
 *        ↘   ⇅   ↗                      ↘       ↗      
 *          ↘ ⇅ ↗                          ↘   ↗        
 *            o                              o  
 * 
 * If all halfedges starting from vertex v to delete are connected to a face, 
 * then we create a new face v. 
 * If some of the halfedges starting from v are boundaries (i.e. no face), 
 * then we can't create a new face.
 *         
 */  


export function removeVertex(
    struct: HalfedgeDS,
    vertex: Vertex,
    mergeFaces = true) {

  for (const halfedge of vertex.loopCW()) {
    removeEdge(struct, halfedge, mergeFaces);
  }

  struct.vertices.remove(vertex);
}